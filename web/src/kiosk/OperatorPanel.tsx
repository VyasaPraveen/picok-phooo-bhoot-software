import { limitToLast, onValue, orderByChild, query, ref } from 'firebase/database';
import { useEffect, useState } from 'react';
import { MEDIA_ROLLS, PRINT_SIZES } from '../render';
import type { BoothData } from '../shared/booth';
import { db } from '../shared/firebase';
import { bridgeOnline, ORDER_STATUS_LABEL, PAYMENT_LABEL, rupees, type Order } from '../shared/model';
import type { SourcedTemplate } from '../shared/templates';
import { useToast, type PinRole } from '../shared/ui';
import { createOrder, newRollLoaded, nextOrderId, withTimeout } from './boothOps';
import { getPrint } from './printStore';

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
  const [orders, setOrders] = useState<Order[]>([]);
  const [prints, setPrints] = useState<Record<string, boolean>>({});
  const s = data.settings;
  const roll = MEDIA_ROLLS[s.loadedRoll];
  const online = bridgeOnline(data.bridge);

  useEffect(
    () =>
      onValue(query(ref(db, `booths/${boothId}/orders`), orderByChild('createdAt'), limitToLast(60)), (snap) => {
        const list: Order[] = [];
        snap.forEach((c) => {
          list.push(c.val() as Order);
        });
        setOrders(list.reverse());
      }),
    [boothId],
  );

  useEffect(() => {
    void Promise.all(orders.map(async (o) => [o.id, !!(await getPrint(o.id).catch(() => undefined))] as const)).then((r) =>
      setPrints(Object.fromEntries(r)),
    );
  }, [orders]);

  const templateOf = (o: Order) => data.templates.find((t) => t.id === o.templateId);
  const attention = orders.filter((o) => o.status === 'paid' || o.status === 'printing' || o.status === 'failed');
  const recent = orders.filter((o) => o.status === 'printed').slice(0, 15);

  const resume = async (o: Order) => {
    const p = await getPrint(o.id).catch(() => undefined);
    if (!templateOf(o)) return toast('The template for this order is no longer available.', true);
    onResume(o, templateOf(o), p?.blob ?? null);
  };

  const reprint = async (o: Order) => {
    const p = await getPrint(o.id).catch(() => undefined);
    if (!p) return toast('The photos of this order were already deleted for privacy.', true);
    if (!templateOf(o)) return toast('The template for this order is no longer available.', true);
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
