import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { PRINT_SIZES } from '../../render';
import { DEFAULT_ADMIN_PIN, DEFAULT_OPERATOR_PIN, hashPin } from '../../shared/crypto';
import { bridgeOnline, printerReady, rupees, type Order, type PaymentMethod, type PaymentRequest } from '../../shared/model';
import { PinPad, useToast } from '../../shared/ui';
import {
  cancelPayment,
  clearPayment,
  createOrder,
  nextOrderId,
  readPayment,
  requestPayment,
  setActivePaymentOrder,
  updateOrder,
  watchPayment,
  withTimeout,
} from '../boothOps';
import { sessionTotal, type StepProps } from '../Flow';
import { StepHeader } from './Choose';

type View =
  | { kind: 'preparing' }
  | { kind: 'qr'; qrUrl: string; amount: number; demo: boolean }
  | { kind: 'paid' }
  | { kind: 'problem'; message: string; allowCash: boolean };

/** How long the customer waits for the print PC to create the UPI QR. */
const QR_WAIT_MS = 30_000;
/** A problem screen nobody acts on returns to the start screen. */
const PROBLEM_IDLE_MS = 90_000;

/** Step 5 · Pay by UPI: a QR for the exact amount, confirmed automatically. */
export function PaymentScreen({ boothId, data, session, go, reset }: StepProps) {
  const s = data.settings;
  const toast = useToast();
  const [view, setView] = useState<View>({ kind: 'preparing' });
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [askCash, setAskCash] = useState(false);
  const [pins, setPins] = useState({ admin: '', operator: '' });
  const order = useRef<Order | null>(null);
  /** The customer's outcome (paid or left) is decided; nothing else may change it. */
  const finished = useRef(false);
  /** A cancel is in progress; timers and taps must not start another one. */
  const closing = useRef(false);
  /** A payment request was written for the print PC, so leaving must close it. */
  const requested = useRef(false);
  const unwatch = useRef<(() => void) | null>(null);
  const viewKind = useRef(view.kind);
  viewKind.current = view.kind;
  const bridgeMode = s.paymentMode === 'bridge';
  const description = `Picok Booth ${PRINT_SIZES[session.size!].shortLabel} ${session.template!.name} ×${session.copies}`;

  useEffect(() => {
    void Promise.all([hashPin(DEFAULT_ADMIN_PIN), hashPin(DEFAULT_OPERATOR_PIN)]).then(([a, o]) =>
      setPins({ admin: data.pins.adminHash || a, operator: data.pins.operatorHash || o }),
    );
  }, [data.pins]);

  const markPaid = (method: PaymentMethod, paymentId: string | null = null, payerVpa: string | null = null) => {
    const o = order.current;
    if (finished.current || !o) return;
    finished.current = true;
    unwatch.current?.();
    const patch: Partial<Order> = { status: 'paid', paymentMethod: method, paymentId, payerVpa, error: null };
    if (method === 'free' || method === 'demo') patch.paymentId = null;
    Object.assign(o, patch);
    session.order = o;
    setView({ kind: 'paid' });
    setTimeout(() => go('capture'), method === 'free' ? 300 : 1600);
    // The customer moves on at once; the write syncs even if the connection drops for a moment.
    // The UPI request is removed only once the order holds the payment ID.
    void updateOrder(boothId, o.id, patch)
      .then(() => (method === 'upi' ? clearPayment(boothId, o.id) : undefined))
      .catch(() => undefined);
  };

  /** Marks an unpaid order as cancelled (a later UPI payment is still recovered by the safety net). */
  const cancelOrder = async (note: string | null) => {
    const o = order.current;
    if (o && o.status === 'awaiting_payment') {
      o.status = 'cancelled';
      await updateOrder(boothId, o.id, { status: 'cancelled', error: note }).catch(() => undefined);
    }
  };

  /**
   * Closes a live UPI request. `paid` if money arrived in the meantime, `closed` when the print PC
   * confirmed, `unknown` when it did not answer (the request is kept so a late payment is recovered).
   */
  const closeBridgeRequest = (): Promise<'paid' | 'closed' | 'unknown'> => {
    const o = order.current;
    if (!bridgeMode || !o || !requested.current) return Promise.resolve('closed');
    return new Promise((resolve) => {
      let settled = false;
      let stop: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (result: 'paid' | 'closed' | 'unknown', p?: PaymentRequest | null) => {
        if (settled) return;
        settled = true;
        stop?.();
        if (timer) clearTimeout(timer);
        if (result === 'paid') markPaid('upi', p?.paymentId ?? null, p?.payerVpa ?? null);
        else if (result === 'closed') void clearPayment(boothId, o.id);
        resolve(result);
      };
      const check = (p: PaymentRequest | null) => {
        if (p?.state === 'paid') done('paid', p);
        else if (!p || p.state === 'closed' || p.state === 'expired') done('closed');
      };
      timer = setTimeout(() => done('unknown'), 10_000);
      stop = watchPayment(boothId, o.id, check);
      // Refused by the rules once the payment is already `paid`: read it back and take the money path.
      void cancelPayment(boothId, o.id).catch(() =>
        readPayment(boothId, o.id).then(
          (p) => (p?.state === 'paid' ? done('paid', p) : undefined),
          () => undefined,
        ),
      );
    });
  };

  const leave = async (to: 'options' | 'reset', message?: string) => {
    if (finished.current || closing.current) return;
    closing.current = true;
    const result = await closeBridgeRequest();
    if (result === 'paid' || finished.current) return;
    finished.current = true;
    unwatch.current?.();
    await cancelOrder(result === 'unknown' ? 'Customer left; the print PC did not confirm the QR was closed.' : null);
    if (message) toast(message);
    if (to === 'reset') reset();
    else go('options');
  };

  // Created once per visit, even when React re-runs effects (StrictMode), so no duplicate orders.
  const mounted = useRef(true);
  const started = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      unwatch.current?.();
      setActivePaymentOrder(null);
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const amount = sessionTotal(session, data);

      // Never take money if the booth cannot print.
      if (s.printMode === 'bridge') {
        const paper = data.state?.printsRemaining ?? 0;
        const problem = !bridgeOnline(data.bridge)
          ? 'The print PC is offline.'
          : !printerReady(data.bridge)
            ? `Printer: ${data.bridge?.printer?.message || data.bridge?.printer?.state || 'not ready'}`
            : paper < session.copies
              ? 'The printer is out of paper.'
              : null;
        if (problem) {
          setView({ kind: 'problem', message: `Sorry, the booth can’t print right now.\n${problem}`, allowCash: false });
          return;
        }
      }

      const t = session.template!;
      const id = await nextOrderId(boothId);
      const o = await withTimeout(
        createOrder(boothId, {
          id,
          size: session.size!,
          templateId: t.id,
          templateName: t.name,
          photos: t.slots.length,
          bw: session.bw,
          copies: session.copies,
          amount,
          status: 'awaiting_payment',
          paymentMethod: 'none',
          paymentId: null,
          payerVpa: null,
          jobId: null,
          error: null,
          eventName: s.eventName,
          reprintOf: null,
        }),
        10_000,
        'offline',
      );
      if (!mounted.current) return;
      order.current = o;
      session.order = o;
      setActivePaymentOrder(o.id);

      if (s.freeMode || amount === 0) {
        markPaid('free');
        return;
      }

      const limit = Date.now() + s.paymentTimeoutSeconds * 1000;
      if (!bridgeMode) {
        const qrUrl = await QRCode.toDataURL(
          `upi://pay?pa=demo@picok&pn=Picok%20Booth%20DEMO&am=${(amount / 100).toFixed(2)}&tn=${encodeURIComponent(description)}`,
          { width: 760, margin: 1 },
        );
        if (!mounted.current) return;
        setDeadline(limit);
        setView({ kind: 'qr', qrUrl, amount, demo: true });
        return;
      }

      if (!bridgeOnline(data.bridge) || data.bridge?.payments?.ready === false) {
        setView({ kind: 'problem', message: 'UPI payment is not available right now.', allowCash: true });
        return;
      }
      await withTimeout(requestPayment(boothId, o.id, amount, description), 10_000, 'offline');
      requested.current = true;
      if (!mounted.current) return;
      unwatch.current = watchPayment(boothId, o.id, (p) => {
        if (!p || finished.current || closing.current) return;
        if (p.state === 'pending' && (p.upiString || p.imagePng)) {
          const show = async () => {
            const qrUrl = p.upiString ? await QRCode.toDataURL(p.upiString, { width: 760, margin: 1 }) : `data:image/png;base64,${p.imagePng}`;
            if (finished.current || closing.current) return;
            setDeadline(p.expiresAt ? Math.min(p.expiresAt, limit) : limit);
            setView({ kind: 'qr', qrUrl, amount: p.amount, demo: false });
          };
          void show();
        } else if (p.state === 'paid') {
          markPaid('upi', p.paymentId ?? null, p.payerVpa ?? null);
        } else if (p.state === 'error' && viewKind.current !== 'qr') {
          setView({ kind: 'problem', message: p.message || 'UPI payment is not available right now.', allowCash: true });
        } else if (p.state === 'expired' || p.state === 'closed') {
          void leave('reset', 'Payment time ran out. Please start again.');
        }
      });
      // The print PC normally answers within a few seconds.
      setTimeout(() => {
        if (mounted.current && !finished.current && viewKind.current === 'preparing') {
          setView({ kind: 'problem', message: 'The print PC did not create the UPI QR.', allowCash: true });
        }
      }, QR_WAIT_MS);
    })().catch(() => {
      if (mounted.current && !finished.current) {
        setView({ kind: 'problem', message: 'Could not start the payment. Check the internet connection.', allowCash: !!order.current });
      }
    });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Demo payments confirm themselves after a few seconds.
  useEffect(() => {
    if (view.kind !== 'qr' || !view.demo) return;
    const t = setTimeout(() => markPaid('demo'), 6000);
    return () => clearTimeout(t);
  }, [view.kind]);

  // A customer who walks away from a problem screen: back to the start screen.
  useEffect(() => {
    if (view.kind !== 'problem' || askCash) return;
    const t = setTimeout(() => void leave('reset'), PROBLEM_IDLE_MS);
    return () => clearTimeout(t);
  }, [view, askCash]);

  useEffect(() => {
    if (deadline && now > deadline && view.kind === 'qr') void leave('reset', 'Payment time ran out. Please start again.');
  }, [now, deadline]);

  const secs = Math.max(0, Math.round((deadline - now) / 1000));

  return (
    <div className="screen">
      <StepHeader step={5} title="Scan & pay with UPI" subtitle={description} />
      <div className="pay-layout">
        {view.kind === 'preparing' && (
          <div className="center-col"><div className="spinner" /><p>Getting your payment QR ready…</p></div>
        )}
        {view.kind === 'paid' && (
          <div className="center-col pop">
            <div className="big-check">✓</div>
            <h1>Payment received!</h1>
            <p className="dim">Get ready to smile…</p>
          </div>
        )}
        {view.kind === 'problem' && (
          <div className="center-col" role="alert">
            <div className="big-warn">!</div>
            <p className="problem-text">{view.message}</p>
            <p className="dim">Please call the booth operator.</p>
            <div className="row-gap">
              <button className="btn btn-ghost" onClick={() => void leave('options')}>← Back</button>
              {view.allowCash && <button className="btn btn-primary" onClick={() => setAskCash(true)}>Pay cash at counter</button>}
            </div>
          </div>
        )}
        {view.kind === 'qr' && (
          <>
            <div className="qr-card">
              {view.demo && <div className="demo-ribbon">DEMO — no money is taken</div>}
              <img src={view.qrUrl} alt="UPI payment QR code" />
              <strong>Pay {rupees(view.amount)}</strong>
              <span>GPay · PhonePe · Paytm · BHIM · any UPI app</span>
            </div>
            <div className="pay-side">
              <ol className="pay-steps">
                <li>Open any UPI app</li>
                <li>Scan this QR code</li>
                <li>Pay — we’ll confirm automatically</li>
              </ol>
              <div className="timer">
                <svg viewBox="0 0 36 36" aria-hidden>
                  <circle cx="18" cy="18" r="15" className="track" />
                  <circle
                    cx="18" cy="18" r="15" className={`bar ${secs < 30 ? 'low' : ''}`}
                    strokeDasharray={`${Math.min(1, secs / s.paymentTimeoutSeconds) * 94.2} 94.2`}
                  />
                </svg>
                <span>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} left</span>
              </div>
              <p className="dim waiting"><span className="spinner small" /> Waiting for payment…</p>
              <div className="row-gap">
                <button className="btn btn-ghost" onClick={() => void leave('options')}>✕ Cancel</button>
                <button className="btn btn-soft" onClick={() => setAskCash(true)}>Pay cash at counter</button>
                {view.demo && <button className="btn btn-success" onClick={() => markPaid('demo')}>Simulate payment</button>}
              </div>
            </div>
          </>
        )}
      </div>
      {askCash && pins.admin && (
        <PinPad
          title="Operator PIN · cash received"
          adminHash={pins.admin}
          operatorHash={pins.operator}
          onDone={async (role) => {
            setAskCash(false);
            if (!role || finished.current || closing.current || !order.current) return;
            closing.current = true;
            if ((await closeBridgeRequest()) === 'paid') return;
            closing.current = false;
            markPaid('cash');
          }}
        />
      )}
    </div>
  );
}
