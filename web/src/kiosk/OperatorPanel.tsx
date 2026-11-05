import { equalTo, limitToLast, onValue, orderByChild, query, ref } from 'firebase/database';
import { useEffect, useMemo, useState } from 'react';
import { MEDIA_ROLLS, PRINT_SIZES } from '../render';
import type { BoothData } from '../shared/booth';
import { db } from '../shared/firebase';
import { bridgeOnline, ORDER_STATUS_LABEL, PAYMENT_LABEL, rupees, type Order } from '../shared/model';
import type { SourcedTemplate } from '../shared/templates';
import { useToast, type PinRole } from '../shared/ui';
import { consumePaper, createOrder, newRollLoaded, nextOrderId, readJob, removeJob, updateOrder, withTimeout } from './boothOps';
import { isUsbCamera, listCameras, pinCamera, pinnedCamera } from './camera';
import { getPrint, savePrint } from './printStore';

/** Staff panel on the tablet: resume or reprint paid orders, paper roll, printer status. */
export function OperatorPanel({
  boothId,
  data,
  role,
  onClose,
  onResume,
}: {
  boothId: string;
  data: BoothData;
  role: PinRole;
  onClose: () => void;
  onResume: (order: Order, template: SourcedTemplate | undefined, blob: Blob | null) => void;
}) {
  const toast = useToast();
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [open, setOpen] = useState<Record<string, Order[]>>({});
  const [prints, setPrints] = useState<Record<string, boolean>>({});
  const s = data.settings;
  const roll = MEDIA_ROLLS[s.loadedRoll];
  const online = bridgeOnline(data.bridge);

  useEffect(() => {
    const ordersRef = ref(db, `booths/${boothId}/orders`);
    const collect = (snap: { forEach: (cb: (c: { val: () => unknown }) => void) => void }) => {
      const list: Order[] = [];
      snap.forEach((c) => {
        list.push(c.val() as Order);
      });
      return list;
    };
    // Paid orders that still need printing are fetched by status, so they never drop off the list
    // however many orders came after them.
    const unsubs = (['paid', 'printing', 'failed'] as const).map((st) =>
      onValue(query(ordersRef, orderByChild('status'), equalTo(st)), (snap) => setOpen((o) => ({ ...o, [st]: collect(snap) }))),
    );
    unsubs.push(onValue(query(ordersRef, orderByChild('createdAt'), limitToLast(40)), (snap) => setRecentOrders(collect(snap).reverse())));
    return () => unsubs.forEach((u) => u());
  }, [boothId]);
  // Memoised: the print lookup below runs only when the orders actually change.
  const orders = useMemo(
    () => [...Object.values(open).flat(), ...recentOrders].filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i),
    [open, recentOrders],
  );

  useEffect(() => {
    void Promise.all(orders.map(async (o) => [o.id, !!(await getPrint(o.id).catch(() => undefined))] as const)).then((r) =>
      setPrints(Object.fromEntries(r)),
    );
  }, [orders]);

  const templateOf = (o: Order) => data.templates.find((t) => t.id === o.templateId);
  const attention = Object.values(open)
    .flat()
    .filter((o) => !o.refundedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
  const recent = recentOrders.filter((o) => o.status === 'printed').slice(0, 15);

  const resume = async (o: Order) => {
    // An order sent to the printer before a reload: check what happened to that job first.
    if (o.jobId && o.status === 'printing') {
      const job = await readJob(boothId, o.jobId).catch(() => null);
      if (job?.status === 'done') {
        await updateOrder(boothId, o.id, { status: 'printed', error: null }).catch(() => undefined);
        void consumePaper(boothId, o.copies * (PRINT_SIZES[o.size]?.sheets ?? 1)).catch(() => undefined);
        void removeJob(boothId, o.jobId);
        return toast(`${o.id} had already printed. It is now marked as printed.`);
      }
      if (job && (job.status === 'queued' || job.status === 'printing')) {
        return toast(`${o.id} is still ${job.status === 'queued' ? 'waiting for' : 'on'} the printer. Check the printer before printing again.`, true);
      }
      if (!confirm(`${o.id} may already have printed. Check the printer tray. Print it again?`)) return;
      if (job) void removeJob(boothId, o.jobId);
    } else if (o.status === 'failed' && /may still print/i.test(o.error ?? '') && !confirm(`${o.id} may still print by itself. Check the printer tray. Print it again?`)) {
      return;
    }
    const p = await getPrint(o.id).catch(() => undefined);
    // The saved print file is enough; the design is only needed to take the photos again.
    if (!p?.blob && !templateOf(o)) return toast('The design for this order is no longer available and its photos were deleted.', true);
    onResume(o, templateOf(o), p?.blob ?? null);
  };

  const reprint = async (o: Order) => {
    const p = await getPrint(o.id).catch(() => undefined);
    if (!p) return toast('The photos of this order were already deleted for privacy.', true);
    const rest: Order = { ...o };
    delete rest.refundedAt;
    const id = await nextOrderId(boothId);
    const copy = await createOrder(boothId, {
      ...rest,
      id,
      amount: 0,
      status: 'paid',
      paymentMethod: 'reprint',
      paymentId: null,
      payerVpa: null,
      jobId: null,
      error: null,
      reprintOf: o.id,
    });
    // Kept under the new order too, so a failed reprint can be printed again.
    await savePrint(copy.id, p.blob).catch(() => undefined);
    onResume(copy, templateOf(o), p.blob);
  };

  const newRoll = async () => {
    if (!confirm(`Reset the paper counter to a full ${roll.label} roll (${roll.capacity} prints)?`)) return;
    try {
      await withTimeout(newRollLoaded(boothId, s, roll.capacity), 10_000, 'offline');
      toast(`Paper counter reset to ${roll.capacity} prints.`);
    } catch {
      toast('Could not reset the paper counter. Check the internet connection.', true);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Operator panel">
      <div className="operator card">
        <header className="operator-head">
          <h2>{role === 'admin' ? 'Admin' : 'Operator'} panel</h2>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Back to booth</button>
        </header>

        <section className="op-status">
          <div>
            <span className="dim">Print PC</span>
            <strong className={online ? 'ok' : 'bad'}>{s.printMode === 'demo' ? 'Demo printing' : online ? 'Online' : 'Offline'}</strong>
            {online && <small className="dim">{data.bridge?.printer?.message || data.bridge?.printer?.state}</small>}
          </div>
          <div>
            <span className="dim">Payments</span>
            <strong>{s.paymentMode === 'demo' ? 'Demo' : data.bridge?.payments?.ready ? 'UPI ready' : 'Not ready'}</strong>
          </div>
          <div>
            <span className="dim">Paper ({roll.label})</span>
            <strong className={(data.state?.printsRemaining ?? 0) <= s.lowPaperThreshold ? 'bad' : 'ok'}>
              {data.state?.printsRemaining ?? 0} left
            </strong>
            <button className="btn btn-soft btn-sm" onClick={() => void newRoll()}>New roll loaded</button>
          </div>
        </section>

        <CameraPicker source={s.cameraSource} />

        <h3>Needs attention</h3>
        {attention.length === 0 && <p className="dim">All paid orders are printed. 🎉</p>}
        {attention.map((o) => (
          <OrderRow key={o.id} o={o}>
            <button className="btn btn-primary btn-sm" onClick={() => void resume(o)}>
              {prints[o.id] ? 'Print now' : 'Resume (take photos)'}
            </button>
          </OrderRow>
        ))}

        <h3>Recent prints</h3>
        <p className="dim small">Reprints are logged separately and are not counted as revenue.</p>
        {recent.map((o) => (
          <OrderRow key={o.id} o={o}>
            {prints[o.id] ? (
              <button className="btn btn-soft btn-sm" onClick={() => void reprint(o).catch(() => toast('Could not start the reprint. Check the internet connection.', true))}>Reprint</button>
            ) : (
              <span className="dim small">Photos deleted</span>
            )}
          </OrderRow>
        ))}

        <footer className="row-gap">
          <a className="btn btn-ghost btn-sm" href="/admin" target="_blank" rel="noreferrer">Open admin dashboard</a>
          <button className="btn btn-ghost btn-sm" onClick={() => location.reload()}>Reload app</button>
          <button className="btn btn-ghost btn-sm" onClick={() => void document.exitFullscreen?.().catch(() => undefined)}>Exit full screen</button>
        </footer>
      </div>
    </div>
  );
}

const SOURCE_LABEL = {
  auto: 'USB camera (Canon R50) when connected, otherwise the tablet camera',
  usb: 'USB camera (Canon R50) only',
  front: 'Tablet front camera',
  back: 'Tablet back camera',
} as const;

/** Which camera this tablet uses; staff can pin one here (the dashboard sets the booth default). */
function CameraPicker({ source }: { source: keyof typeof SOURCE_LABEL }) {
  const toast = useToast();
  const [cams, setCams] = useState<MediaDeviceInfo[] | null>(null);
  const [pinned, setPinned] = useState(pinnedCamera());
  const load = () =>
    void listCameras()
      .then(setCams)
      .catch(() => setCams([]));
  useEffect(() => {
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  const choose = (id: string) => {
    pinCamera(id || null);
    setPinned(id || null);
    toast(id ? 'This tablet now uses the chosen camera.' : 'This tablet follows the booth camera setting.');
  };
  return (
    <section className="op-camera">
      <h3>Camera</h3>
      <label className="dim small">
        Booth setting: {SOURCE_LABEL[source]}
        <select value={pinned ?? ''} onChange={(e) => choose(e.target.value)}>
          <option value="">Follow the booth setting</option>
          {pinned && cams && !cams.some((c) => c.deviceId === pinned) && <option value={pinned}>Chosen camera (not connected)</option>}
          {(cams ?? []).map((c, i) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label || `Camera ${i + 1}`}{isUsbCamera(c, cams ?? []) ? ' · USB' : ''}
            </option>
          ))}
        </select>
      </label>
      {cams && !cams.some((c) => isUsbCamera(c, cams)) && (
        <p className="dim small">No USB camera found. Connect the Canon R50 with its USB-C cable and switch it to streaming (webcam) mode.</p>
      )}
    </section>
  );
}

function OrderRow({ o, children }: { o: Order; children: React.ReactNode }) {
  return (
    <div className={`order-row status-${o.status}`}>
      <div>
        <strong>{o.id}</strong> · {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {ORDER_STATUS_LABEL[o.status]}
        <div className="dim small">
          {PRINT_SIZES[o.size]?.shortLabel} · {o.templateName} · {o.bw ? 'B&W' : 'Colour'} · ×{o.copies} · {rupees(o.amount)} {PAYMENT_LABEL[o.paymentMethod]}
          {o.error ? ` · ${o.error}` : ''}
        </div>
      </div>
      {children}
    </div>
  );
}
