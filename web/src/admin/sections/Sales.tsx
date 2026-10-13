import { endAt, limitToLast, onValue, orderByChild, query, ref, startAt, update } from 'firebase/database';
import { useEffect, useMemo, useState } from 'react';
import { MEDIA_ROLLS, PRINT_SIZES } from '../../render';
import { DEFAULT_ADMIN_PIN, DEFAULT_OPERATOR_PIN, hashPin } from '../../shared/crypto';
import { db } from '../../shared/firebase';
import {
  bridgeOnline,
  countsAsRevenue,
  dayKey,
  isPaidStatus,
  ORDER_STATUS_LABEL,
  PAYMENT_LABEL,
  rupees,
  type Order,
} from '../../shared/model';
import { useToast } from '../../shared/ui';
import { fmtDateTime, Panel, type SectionProps } from '../fields';

function useOrders(boothId: string, from: number, to: number) {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    setOrders(null);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    return onValue(
      query(ref(db, `booths/${boothId}/orders`), orderByChild('createdAt'), startAt(from), endAt(to - 1)),
      (s) => {
        const list: Order[] = [];
        s.forEach((c) => {
          list.push(c.val() as Order);
        });
        setOrders(list);
      },
      () => {
        setOrders([]);
        toast('Could not load orders. Check your connection.', true);
      },
    );
  }, [boothId, from, to, toast]);
  return orders;
}

/** Midnight of a yyyy-mm-dd input value, or of today when the field is empty or invalid. */
const dayFromInput = (v: string) => {
  const t = startOfDay(new Date(`${v}T00:00`));
  return Number.isFinite(t) ? t : startOfDay();
};

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;

interface Bucket {
  orders: number;
  sheets: number;
  revenue: number;
}

function summarise(orders: Order[]) {
  const r = { revenue: 0, upi: 0, cash: 0, paid: 0, sheets: 0, reprints: 0, free: 0, demo: 0, pending: 0 };
  const byDay: Record<string, Bucket> = {};
  const bySize: Record<string, Bucket> = {};
  const byColour: Record<string, Bucket> = {};
  for (const o of orders) {
    if (!isPaidStatus(o.status)) continue;
    const sheets = o.status === 'printed' ? o.copies : 0;
    // Paper used counts every print (free, demo and reprints included); revenue only real money.
    r.sheets += sheets;
    if (o.reprintOf) {
      r.reprints++;
      continue;
    }
    if (o.status === 'paid' || o.status === 'failed') r.pending++;
    if (o.paymentMethod === 'free') r.free++;
    if (o.paymentMethod === 'demo') r.demo++;
    if (!countsAsRevenue(o)) continue;
    r.paid++;
    r.revenue += o.amount;
    if (o.paymentMethod === 'upi') r.upi += o.amount;
    if (o.paymentMethod === 'cash') r.cash += o.amount;
    const day = new Date(o.createdAt).toLocaleDateString('en-CA');
    for (const [map, k] of [
      [byDay, day],
      [bySize, PRINT_SIZES[o.size]?.shortLabel ?? o.size],
      [byColour, o.bw ? 'Black & white' : 'Colour'],
    ] as const) {
      const b = (map[k] ??= { orders: 0, sheets: 0, revenue: 0 });
      b.orders++;
      b.sheets += sheets;
      b.revenue += o.amount;
    }
  }
  return { ...r, byDay, bySize, byColour };
}

// ---- Overview ----

/** True while a booth PIN is still one of the published defaults. */
function useDefaultPins(adminHash?: string, operatorHash?: string) {
  const [weak, setWeak] = useState(false);
  useEffect(() => {
    void Promise.all([hashPin(DEFAULT_ADMIN_PIN), hashPin(DEFAULT_OPERATOR_PIN)]).then(([a, o]) =>
      setWeak(!adminHash || !operatorHash || adminHash === a || operatorHash === o),
    );
  }, [adminHash, operatorHash]);
  return weak;
}

export function OverviewSection({ boothId, data }: SectionProps) {
  const weakPins = useDefaultPins(data.pins.adminHash, data.pins.operatorHash);
  const today = startOfDay();
  const orders = useOrders(boothId, today, today + DAY);
  const sum = useMemo(() => summarise(orders ?? []), [orders]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const s = data.settings;
  const online = bridgeOnline(data.bridge);
  const roll = MEDIA_ROLLS[s.loadedRoll];
  const paper = data.state?.printsRemaining ?? 0;
  const pct = Math.max(0, Math.min(100, (paper / roll.capacity) * 100));

  return (
    <>
      {weakPins && (
        <p className="error-text" role="alert">
          The booth still uses a default PIN (2580 / 1470), so anyone who knows it can mark cash payments and reprint for free.
          Change both under <b>Booth settings → Booth PINs</b>.
        </p>
      )}
      <div className="stats">
        <Stat label="Revenue today" value={rupees(sum.revenue)} color="var(--yellow)" />
        <Stat label="Paid orders today" value={String(sum.paid)} color="var(--cyan)" />
        <Stat label="Prints today" value={String(sum.sheets)} color="var(--pink)" />
        {sum.pending > 0 && <Stat label="Paid, not printed" value={String(sum.pending)} color="var(--danger)" />}
        {sum.demo > 0 && <Stat label="Demo orders" value={String(sum.demo)} color="var(--orange)" />}
      </div>
      <div className="grid-2">
        <Panel title="Booth status" subtitle={s.eventName || 'No event name set'}>
          <ul className="status-list">
            <li>
              <span>Print PC</span>
              <strong className={s.printMode === 'demo' ? 'warn' : online ? 'ok' : 'bad'}>
                {s.printMode === 'demo' ? 'Demo printing (no printer)' : online ? `Online · ${data.bridge?.name ?? ''}` : 'Offline'}
              </strong>
            </li>
            <li>
              <span>Printer</span>
              <strong>{online ? data.bridge?.printer?.message || data.bridge?.printer?.state : '—'}</strong>
            </li>
            <li>
              <span>Payments</span>
              <strong className={s.paymentMode === 'demo' ? 'warn' : data.bridge?.payments?.ready ? 'ok' : 'bad'}>
                {s.paymentMode === 'demo' ? 'Demo payments' : data.bridge?.payments?.ready ? `UPI ready (${data.bridge.payments.provider})` : 'Not ready'}
              </strong>
            </li>
            <li>
              <span>Paper · {roll.label}</span>
              <strong className={paper <= s.lowPaperThreshold ? 'bad' : 'ok'}>{paper} of {roll.capacity}</strong>
            </li>
          </ul>
          <div className="meter" aria-label={`Paper ${Math.round(pct)}%`}><span style={{ width: `${pct}%` }} /></div>
        </Panel>
        <Panel title="Latest orders today">
          {!orders ? <div className="spinner" /> : orders.length === 0 ? <p className="dim">No orders yet today.</p> : null}
          {orders && [...orders].reverse().slice(0, 8).map((o) => <OrderLine key={o.id} o={o} />)}
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="stat card" style={{ borderLeftColor: color }}>
      <span className="dim">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OrderLine({ o, actions }: { o: Order; actions?: React.ReactNode }) {
  return (
    <div className={`order-line status-${o.status}`}>
      <div>
        <strong>{o.id}</strong> <span className="dim">· {fmtDateTime(o.createdAt)} · {ORDER_STATUS_LABEL[o.status]}{o.reprintOf ? ` · reprint of ${o.reprintOf}` : ''}</span>
        <div className="dim small">
          {PRINT_SIZES[o.size]?.shortLabel} · {o.templateName} · {o.bw ? 'B&W' : 'Colour'} · ×{o.copies} · {rupees(o.amount)} {PAYMENT_LABEL[o.paymentMethod]}
          {o.paymentId ? ` · ${o.paymentId}` : ''}
          {o.error ? ` · ${o.error}` : ''}
        </div>
      </div>
      {actions}
    </div>
  );
}

// ---- Orders ----

export function OrdersSection({ boothId }: SectionProps) {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'attention' | 'printed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  useEffect(
    () =>
      onValue(
        query(ref(db, `booths/${boothId}/orders`), orderByChild('createdAt'), limitToLast(300)),
        (s) => {
          const list: Order[] = [];
          s.forEach((c) => {
            list.push(c.val() as Order);
          });
          setOrders(list.reverse());
        },
        () => {
          setOrders([]);
          toast('Could not load orders. Check your connection.', true);
        },
      ),
    [boothId, toast],
  );

  const refund = async (o: Order) => {
    if (!confirm(`Mark ${o.id} as refunded?\n\nDo this only after refunding the customer from your Razorpay dashboard. The order is removed from revenue.`)) return;
    try {
      // refundedAt also stops the booth from changing the order afterwards (database rules).
      await update(ref(db, `booths/${boothId}/orders/${o.id}`), { status: 'cancelled', error: 'Refunded by admin', refundedAt: Date.now(), updatedAt: Date.now() });
      toast(`${o.id} marked as refunded.`);
    } catch {
      toast('Could not mark the order as refunded. Check your connection.', true);
    }
  };

  const shown = (orders ?? []).filter((o) => {
    if (search && !o.id.includes(search.trim()) && !(o.paymentId ?? '').includes(search.trim())) return false;
    if (filter === 'attention') return o.status === 'paid' || o.status === 'printing' || o.status === 'failed';
    if (filter === 'printed') return o.status === 'printed';
    if (filter === 'cancelled') return o.status === 'cancelled' || o.status === 'awaiting_payment';
    return true;
  });

  return (
    <Panel
      title="Orders"
      subtitle="Paid orders that still need printing can be resumed or reprinted from the booth tablet (operator PIN)."
      actions={<input type="text" placeholder="Search order or payment ID" value={search} onChange={(e) => setSearch(e.target.value)} />}
    >
      <div className="chip-row">
        {(['all', 'attention', 'printed', 'cancelled'] as const).map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {{ all: 'All', attention: 'Needs attention', printed: 'Printed', cancelled: 'Cancelled / unpaid' }[f]}
          </button>
        ))}
      </div>
      {!orders && <div className="spinner" />}
      {orders && shown.length === 0 && <p className="dim">No orders match.</p>}
      {shown.map((o) => (
        <OrderLine
          key={o.id}
          o={o}
          actions={
            isPaidStatus(o.status) && !o.reprintOf && (o.paymentMethod === 'upi' || o.paymentMethod === 'cash') ? (
              <button className="btn btn-ghost btn-sm" onClick={() => void refund(o)}>Refunded</button>
            ) : undefined
          }
        />
      ))}
    </Panel>
  );
}

// ---- Sales report ----

const RANGES = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'Last 30 days',
  thisMonth: 'This month',
  custom: 'Custom',
} as const;
type RangeKey = keyof typeof RANGES;

export function SalesSection({ boothId }: SectionProps) {
  const toast = useToast();
  const [range, setRange] = useState<RangeKey>('today');
  const [customFrom, setCustomFrom] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [customTo, setCustomTo] = useState(() => new Date().toLocaleDateString('en-CA'));
  const today = dayKey();
  const [from, to] = useMemo(() => {
    const t = startOfDay();
    switch (range) {
      case 'today':
        return [t, t + DAY];
      case 'yesterday':
        return [t - DAY, t];
      case 'week':
        return [t - 6 * DAY, t + DAY];
      case 'month':
        return [t - 29 * DAY, t + DAY];
      case 'thisMonth': {
        const d = new Date();
        return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), t + DAY];
      }
      case 'custom': {
        const a = dayFromInput(customFrom);
        const b = dayFromInput(customTo);
        return [Math.min(a, b), Math.max(a, b) + DAY];
      }
    }
  }, [range, customFrom, customTo, today]);
  const orders = useOrders(boothId, from, to);
  const sum = useMemo(() => summarise(orders ?? []), [orders]);

  const exportExcel = async () => {
    if (!orders) return;
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const d = (ms: number) => new Date(ms).toLocaleDateString('en-IN');
    const header = (cells: string[]) => cells.map((value) => ({ value, fontWeight: 'bold' as const }));
    const bucketRows = (title: string, b: Record<string, Bucket>) => [
      header([title, 'Orders', 'Prints', 'Revenue (₹)']),
      ...Object.keys(b).sort().map((k) => [k, b[k].orders, b[k].sheets, b[k].revenue / 100]),
    ];
    try {
      await writeXlsxFile([
        {
          sheet: 'Summary',
          data: [
            [{ value: 'Picok Photo Booth – Sales report', fontWeight: 'bold' as const }],
            ['Period', `${d(from)} to ${d(to - 1)}`],
            ['Generated', new Date().toLocaleString('en-IN')],
            [],
            ['Paid orders', sum.paid],
            ['Prints (sheets)', sum.sheets],
            ['Revenue (₹)', sum.revenue / 100],
            ['UPI (₹)', sum.upi / 100],
            ['Cash (₹)', sum.cash / 100],
            ['Free-event orders', sum.free],
            ['Demo orders (not revenue)', sum.demo],
            ['Reprints', sum.reprints],
            ['Paid but not printed', sum.pending],
          ],
        },
        { sheet: 'By day', data: bucketRows('Date', sum.byDay) },
        { sheet: 'By size', data: bucketRows('Size', sum.bySize) },
        { sheet: 'By colour', data: bucketRows('Colour', sum.byColour) },
        {
          sheet: 'Orders',
          data: [
            header(['Order', 'Date & time', 'Event', 'Size', 'Template', 'Colour', 'Copies', 'Amount (₹)', 'Counts as revenue', 'Payment', 'UPI payment ID', 'Payer UPI', 'Status', 'Reprint of', 'Note']),
            ...orders.map((o) => [
              o.id,
              new Date(o.createdAt).toLocaleString('en-IN'),
              o.eventName ?? '',
              PRINT_SIZES[o.size]?.shortLabel ?? o.size,
              o.templateName,
              o.bw ? 'B&W' : 'Colour',
              o.copies,
              o.amount / 100,
              countsAsRevenue(o) ? 'Yes' : 'No',
              PAYMENT_LABEL[o.paymentMethod],
              o.paymentId ?? '',
              o.payerVpa ?? '',
              ORDER_STATUS_LABEL[o.status],
              o.reprintOf ?? '',
              o.error ?? '',
            ]),
          ],
        },
      ]).toFile(`Picok_Sales_${new Date(from).toLocaleDateString('en-CA')}_${new Date(to - 1).toLocaleDateString('en-CA')}.xlsx`);
    } catch {
      toast('Export failed. Please try again.', true);
    }
  };

  const table = (title: string, b: Record<string, Bucket>) => (
    <Panel title={title}>
      {Object.keys(b).length === 0 ? (
        <p className="dim">No sales in this period.</p>
      ) : (
        <div className="table-scroll"><table className="table">
          <thead><tr><th /><th>Orders</th><th>Prints</th><th>Revenue</th></tr></thead>
          <tbody>
            {Object.keys(b).sort().map((k) => (
              <tr key={k}><td>{k}</td><td>{b[k].orders}</td><td>{b[k].sheets}</td><td>{rupees(b[k].revenue)}</td></tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Panel>
  );

  return (
    <>
      <div className="toolbar">
        <div className="chip-row">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <button key={k} className="chip" aria-pressed={range === k} onClick={() => setRange(k)}>{RANGES[k]}</button>
          ))}
        </div>
        {range === 'custom' && (
          <span className="row-gap">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From" />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To" />
          </span>
        )}
        <button className="btn btn-primary btn-sm" disabled={!orders} onClick={() => void exportExcel()}>⬇ Export to Excel</button>
      </div>
      {!orders ? (
        <div className="spinner" />
      ) : (
        <>
          <div className="stats">
            <Stat label="Revenue" value={rupees(sum.revenue)} color="var(--yellow)" />
            <Stat label="Paid orders" value={String(sum.paid)} color="var(--cyan)" />
            <Stat label="Prints (sheets)" value={String(sum.sheets)} color="var(--pink)" />
            <Stat label="UPI" value={rupees(sum.upi)} color="var(--blue)" />
            <Stat label="Cash" value={rupees(sum.cash)} color="var(--peacock)" />
            <Stat label="Reprints" value={String(sum.reprints)} color="var(--orange)" />
            {sum.demo > 0 && <Stat label="Demo orders" value={String(sum.demo)} color="var(--purple)" />}
            {sum.pending > 0 && <Stat label="Paid, not printed" value={String(sum.pending)} color="var(--danger)" />}
          </div>
          <div className="grid-2">
            {table('By size', sum.bySize)}
            {table('By colour', sum.byColour)}
          </div>
          {table('By day', sum.byDay)}
          <Panel title="Payments" subtitle="UPI payment IDs match the transactions in your Razorpay dashboard">
            {orders.filter((o) => countsAsRevenue(o)).length === 0 && <p className="dim">No payments in this period.</p>}
            {orders.filter((o) => countsAsRevenue(o)).map((o) => (
              <div key={o.id} className="pay-line">
                <span>{o.id}</span>
                <span className="dim">{fmtDateTime(o.createdAt)}</span>
                <span>{rupees(o.amount)}</span>
                <span>{PAYMENT_LABEL[o.paymentMethod]}</span>
                <span className="dim mono">{o.paymentId ?? '—'}</span>
              </div>
            ))}
          </Panel>
        </>
      )}
    </>
  );
}
