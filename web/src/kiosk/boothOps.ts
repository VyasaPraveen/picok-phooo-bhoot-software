import { equalTo, get, onValue, orderByChild, push, query, ref, remove, runTransaction, serverTimestamp, set, update } from 'firebase/database';
import type { PrintSizeKey } from '../render';
import { encryptForBridge } from '../shared/crypto';
import { auth, db, serverNow } from '../shared/firebase';
import {
  dayKey,
  type BoothSettings,
  type JobStatus,
  type Order,
  type PaymentRequest,
  type PrintJob,
} from '../shared/model';

const base = (b: string) => `booths/${b}`;

/**
 * Firebase queues writes while offline instead of failing, so a customer could wait forever.
 * Steps that a customer is waiting on give up after `ms` (the write still syncs later).
 */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Next order number for today (`yyyymmdd-NNNN`), shared by all devices of the booth. */
export async function nextOrderId(boothId: string): Promise<string> {
  const day = dayKey();
  try {
    const res = await withTimeout(
      runTransaction(ref(db, `${base(boothId)}/counters/${day}`), (n: number | null) => (n ?? 0) + 1),
      8000,
      'offline',
    );
    return `${day}-${String(res.snapshot.val() as number).padStart(4, '0')}`;
  } catch {
    // Offline fallback keeps orders unique even without the counter.
    return `${day}-T${Date.now().toString().slice(-6)}`;
  }
}

export async function createOrder(boothId: string, o: Omit<Order, 'createdAt' | 'updatedAt' | 'deviceUid'>): Promise<Order> {
  const now = Date.now();
  const order: Order = { ...o, createdAt: now, updatedAt: now, deviceUid: auth.currentUser?.uid ?? '' };
  await set(ref(db, `${base(boothId)}/orders/${o.id}`), order);
  return order;
}

export const updateOrder = (boothId: string, id: string, patch: Partial<Order>) =>
  update(ref(db, `${base(boothId)}/orders/${id}`), { ...patch, updatedAt: Date.now() });

// ---- payments through the Print Bridge (Spark plan: no Cloud Functions) ----

export async function requestPayment(boothId: string, orderId: string, amount: number, description: string) {
  const req: Omit<PaymentRequest, 'createdAt' | 'updatedAt'> & { createdAt: object; updatedAt: object } = {
    amount,
    description,
    state: 'requested',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await set(ref(db, `${base(boothId)}/payments/${orderId}`), req);
}

export const watchPayment = (boothId: string, orderId: string, cb: (p: PaymentRequest | null) => void) =>
  onValue(ref(db, `${base(boothId)}/payments/${orderId}`), (s) => cb(s.val() as PaymentRequest | null));

/** Finished requests are removed so the print PC never re-downloads old traffic. */
export const clearPayment = (boothId: string, orderId: string) =>
  remove(ref(db, `${base(boothId)}/payments/${orderId}`)).catch(() => undefined);

/** Asks the print PC to close the QR. Rejected by the rules once the payment is already `paid`. */
export const cancelPayment = (boothId: string, orderId: string) =>
  update(ref(db, `${base(boothId)}/payments/${orderId}`), { state: 'cancel', updatedAt: serverTimestamp() });

export const readPayment = async (boothId: string, orderId: string) =>
  (await get(ref(db, `${base(boothId)}/payments/${orderId}`))).val() as PaymentRequest | null;

/** The order the payment screen is handling right now (the safety net below leaves it alone). */
let activePaymentOrder: string | null = null;
export const setActivePaymentOrder = (id: string | null) => {
  activePaymentOrder = id;
};

/**
 * Safety net: a UPI payment that completed after the customer left (or while the tablet was
 * offline) is never lost. The order is marked paid with a note so staff can print it from the
 * operator panel, and the finished payment request is removed.
 */
export function watchLatePayments(boothId: string) {
  return onValue(query(ref(db, `${base(boothId)}/payments`), orderByChild('state'), equalTo('paid')), (snap) => {
    snap.forEach((c) => {
      const orderId = c.key!;
      if (orderId === activePaymentOrder) return;
      const p = c.val() as PaymentRequest;
      void (async () => {
        const o = (await get(ref(db, `${base(boothId)}/orders/${orderId}`))).val() as Order | null;
        if (o && !o.refundedAt && (o.status === 'awaiting_payment' || o.status === 'cancelled')) {
          await updateOrder(boothId, orderId, {
            status: 'paid',
            paymentMethod: 'upi',
            paymentId: p.paymentId ?? null,
            payerVpa: p.payerVpa ?? null,
            error: 'Paid after the customer left. Print it from the staff menu.',
          });
        }
        await clearPayment(boothId, orderId);
      })().catch(() => undefined);
    });
  });
}

// ---- printing through the Print Bridge ----

export async function submitPrintJob(
  boothId: string,
  args: { orderId: string; media: PrintSizeKey; finish: 'gloss' | 'matte'; copies: number; reprint: boolean; file: Blob; publicKey: string },
): Promise<string> {
  const { enc, data } = await encryptForBridge(args.file, args.publicKey);
  const jobRef = push(ref(db, `${base(boothId)}/jobs`));
  // Server time: the print PC expires jobs by Firebase's clock, not the tablet's.
  const now = serverNow();
  const job: PrintJob = {
    orderId: args.orderId,
    media: args.media,
    finish: args.finish,
    copies: args.copies,
    reprint: args.reprint,
    status: 'queued',
    message: '',
    createdAt: now,
    updatedAt: now,
    enc,
    mime: args.file.type || 'image/jpeg',
    data,
  };
  await withTimeout(set(jobRef, job), 60_000, 'Could not send the print. Check the internet connection.');
  return jobRef.key!;
}

/**
 * Follows a job until it is done. `error` is not final while the printer waits for staff
 * (e.g. paper out), so an error only ends the wait after two minutes.
 */
export function followJob(
  boothId: string,
  jobId: string,
  onUpdate: (status: JobStatus, message: string) => void,
): Promise<{ status: 'done' | 'error'; message: string; claimed: boolean }> {
  return new Promise((resolve) => {
    let errorSince = 0;
    let claimed = false;
    let last = { status: 'error' as JobStatus, message: 'The print PC did not respond.' };
    const deadline = setTimeout(() => finish({ status: 'error', message: last.status === 'error' ? last.message : 'The printer took too long.' }), 4 * 60_000);
    let errorTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onValue(ref(db, `${base(boothId)}/jobs/${jobId}`), (s) => {
      const j = s.val() as PrintJob | null;
      if (!j) return;
      last = { status: j.status, message: j.message ?? '' };
      if (j.status === 'printing') claimed = true;
      onUpdate(j.status, j.message ?? '');
      if (j.status === 'done') finish({ status: 'done', message: j.message ?? '' });
      else if (j.status === 'error') {
        if (!errorSince) {
          errorSince = Date.now();
          errorTimer = setTimeout(() => finish({ status: 'error', message: last.message }), 2 * 60_000);
        }
      } else if (errorSince) {
        errorSince = 0;
        if (errorTimer) clearTimeout(errorTimer);
      }
    });
    let done = false;
    function finish(r: { status: 'done' | 'error'; message: string }) {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      if (errorTimer) clearTimeout(errorTimer);
      unsub();
      // The order keeps the outcome; the job record (and any leftover ciphertext) is removed.
      void remove(ref(db, `${base(boothId)}/jobs/${jobId}`)).catch(() => undefined);
      resolve({ ...r, claimed });
    }
  });
}

/** Paper counter: subtract printed sheets (never below zero). */
export const consumePaper = (boothId: string, sheets: number) =>
  runTransaction(ref(db, `${base(boothId)}/state/printsRemaining`), (n: number | null) => Math.max(0, (n ?? 0) - sheets));

export async function newRollLoaded(boothId: string, s: BoothSettings, capacity: number) {
  await update(ref(db, `${base(boothId)}/state`), { printsRemaining: capacity, loadedRoll: s.loadedRoll, updatedAt: Date.now() });
}
