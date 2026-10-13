import type { MediaRollKey, PrintSizeKey } from '../render';
import { serverNow } from './firebase';

/** Price for one size, in paise (₹1 = 100 paise). */
export interface SizePrice {
  colour: number;
  bw: number;
  extraCopy: number;
}

export type PaymentMode = 'demo' | 'bridge';
export type PrintMode = 'demo' | 'bridge';

/** Booth settings at /booths/{b}/settings (docs/CLOUD_API.md). */
export interface BoothSettings {
  businessName: string;
  eventName: string;
  eventDate: string;
  showEventOnPrint: boolean;
  logoAssetId: string | null;
  logoStripBg: string;
  prices: Record<string, SizePrice>;
  maxCopies: number;
  freeMode: boolean;
  bwWholePrint: boolean;
  loadedRoll: MediaRollKey;
  disabledSizes: string[];
  finish: 'gloss' | 'matte';
  lowPaperThreshold: number;
  countdownSeconds: number;
  retakesAllowed: number;
  mirrorPhotos: boolean;
  inactivitySeconds: number;
  paymentTimeoutSeconds: number;
  previewAutoPrintSeconds: number;
  retentionMinutes: number;
  paymentMode: PaymentMode;
  printMode: PrintMode;
  hiddenTemplates: string[];
  templateOrder: string[];
  showConsent: boolean;
  consentText: string;
}

export const DEFAULT_CONSENT =
  'By using this booth you agree to have your photo taken and printed. Photos are used only to make your print ' +
  'and are deleted automatically after printing.';

/** Placeholder prices – the operator sets real prices in the admin dashboard. */
export const DEFAULT_PRICES: Record<PrintSizeKey, SizePrice> = {
  '2x6': { colour: 10000, bw: 10000, extraCopy: 5000 },
  '4x6': { colour: 15000, bw: 15000, extraCopy: 7000 },
  '3.5x5': { colour: 10000, bw: 10000, extraCopy: 5000 },
  '5x7': { colour: 25000, bw: 25000, extraCopy: 15000 },
  '6x8': { colour: 35000, bw: 35000, extraCopy: 20000 },
};

export const DEFAULT_SETTINGS: BoothSettings = {
  businessName: 'Picok',
  eventName: '',
  eventDate: '',
  showEventOnPrint: true,
  logoAssetId: null,
  logoStripBg: 'template',
  prices: DEFAULT_PRICES,
  maxCopies: 4,
  freeMode: false,
  bwWholePrint: false,
  loadedRoll: '4x6',
  disabledSizes: [],
  finish: 'gloss',
  lowPaperThreshold: 50,
  countdownSeconds: 3,
  retakesAllowed: 1,
  mirrorPhotos: false,
  inactivitySeconds: 60,
  paymentTimeoutSeconds: 180,
  previewAutoPrintSeconds: 25,
  retentionMinutes: 30,
  paymentMode: 'demo',
  printMode: 'demo',
  hiddenTemplates: [],
  templateOrder: [],
  showConsent: true,
  consentText: DEFAULT_CONSENT,
};

/** Realtime Database keys cannot contain ".", so "3.5x5" is stored as "3_5x5". */
export const priceKey = (size: string) => size.replace('.', '_');

/** Prices in the shape stored in the database. */
export const encodePrices = (prices: Record<string, SizePrice>) =>
  Object.fromEntries(Object.entries(prices).map(([k, v]) => [priceKey(k), v]));

/** Settings in the shape stored in the database. */
export const settingsForDb = (s: BoothSettings) => ({ ...s, prices: encodePrices(s.prices) });

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;

/** Merges stored settings over defaults so a missing or corrupt field never breaks the booth. */
export function normaliseSettings(raw: unknown): BoothSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof BoothSettings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const str = (v: unknown, f: string) => (typeof v === 'string' ? v : f);
  const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const prices: Record<string, SizePrice> = { ...DEFAULT_PRICES };
  if (r.prices && typeof r.prices === 'object') {
    for (const [stored, v] of Object.entries(r.prices as Record<string, unknown>)) {
      const k = stored.replace('_', '.');
      if (!(k in DEFAULT_PRICES) || !v || typeof v !== 'object') continue;
      const p = v as Partial<SizePrice>;
      const f = DEFAULT_PRICES[k as PrintSizeKey];
      prices[k] = {
        colour: clamp(p.colour, 0, 10_000_000, f.colour),
        bw: clamp(p.bw, 0, 10_000_000, f.bw),
        extraCopy: clamp(p.extraCopy, 0, 10_000_000, f.extraCopy),
      };
    }
  }
  const roll = r.loadedRoll;
  return {
    businessName: str(r.businessName, d.businessName) || d.businessName,
    eventName: str(r.eventName, ''),
    eventDate: str(r.eventDate, ''),
    showEventOnPrint: bool(r.showEventOnPrint, d.showEventOnPrint),
    logoAssetId: typeof r.logoAssetId === 'string' ? r.logoAssetId : null,
    logoStripBg: str(r.logoStripBg, d.logoStripBg),
    prices,
    maxCopies: clamp(r.maxCopies, 1, 10, d.maxCopies),
    freeMode: bool(r.freeMode, d.freeMode),
    bwWholePrint: bool(r.bwWholePrint, d.bwWholePrint),
    loadedRoll: roll === '3.5x5' || roll === '5x7' || roll === '6x8' ? roll : '4x6',
    disabledSizes: arr(r.disabledSizes),
    finish: r.finish === 'matte' ? 'matte' : 'gloss',
    lowPaperThreshold: clamp(r.lowPaperThreshold, 0, 1000, d.lowPaperThreshold),
    countdownSeconds: clamp(r.countdownSeconds, 1, 10, d.countdownSeconds),
    retakesAllowed: clamp(r.retakesAllowed, 0, 5, d.retakesAllowed),
    mirrorPhotos: bool(r.mirrorPhotos, d.mirrorPhotos),
    inactivitySeconds: clamp(r.inactivitySeconds, 20, 600, d.inactivitySeconds),
    paymentTimeoutSeconds: clamp(r.paymentTimeoutSeconds, 60, 900, d.paymentTimeoutSeconds),
    previewAutoPrintSeconds: clamp(r.previewAutoPrintSeconds, 5, 120, d.previewAutoPrintSeconds),
    retentionMinutes: clamp(r.retentionMinutes, 0, 1440, d.retentionMinutes),
    paymentMode: r.paymentMode === 'bridge' ? 'bridge' : 'demo',
    printMode: r.printMode === 'bridge' ? 'bridge' : 'demo',
    hiddenTemplates: arr(r.hiddenTemplates),
    templateOrder: arr(r.templateOrder),
    showConsent: bool(r.showConsent, d.showConsent),
    consentText: str(r.consentText, d.consentText) || d.consentText,
  };
}

export interface BoothState {
  printsRemaining: number;
  loadedRoll: MediaRollKey;
  updatedAt: number;
}

export type OrderStatus = 'awaiting_payment' | 'paid' | 'printing' | 'printed' | 'failed' | 'cancelled';
export type PaymentMethod = 'upi' | 'cash' | 'free' | 'demo' | 'reprint' | 'none';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid · not printed',
  printing: 'Printing',
  printed: 'Printed',
  failed: 'Print failed',
  cancelled: 'Cancelled',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  free: 'Free event',
  demo: 'Demo',
  reprint: 'Reprint',
  none: '—',
};

export interface Order {
  id: string;
  createdAt: number;
  updatedAt: number;
  size: PrintSizeKey;
  templateId: string;
  templateName: string;
  photos: number;
  bw: boolean;
  copies: number;
  amount: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentId: string | null;
  payerVpa: string | null;
  jobId: string | null;
  error: string | null;
  eventName: string;
  reprintOf: string | null;
  deviceUid: string;
  /** Set by an admin after refunding; the booth can no longer change the order. */
  refundedAt?: number;
}

export const isPaidStatus = (s: OrderStatus) => s === 'paid' || s === 'printing' || s === 'printed' || s === 'failed';

/** Revenue counts only collected money; demo, free and reprint orders are tracked separately. */
export const countsAsRevenue = (o: Order) =>
  isPaidStatus(o.status) && !o.reprintOf && (o.paymentMethod === 'upi' || o.paymentMethod === 'cash');

/** Prints the customer takes home: one 2×6 sheet gives two strips. */
export const printsOut = (o: Pick<Order, 'size' | 'copies'>) => (o.size === '2x6' ? o.copies * 2 : o.copies);

export type PaymentState = 'requested' | 'pending' | 'paid' | 'expired' | 'closed' | 'error' | 'cancel';

export interface PaymentRequest {
  amount: number;
  description: string;
  state: PaymentState;
  createdAt: number;
  updatedAt: number;
  qrId?: string;
  upiString?: string | null;
  imagePng?: string | null;
  expiresAt?: number;
  paymentId?: string;
  payerVpa?: string;
  message?: string;
}

export type JobStatus = 'queued' | 'printing' | 'done' | 'error';

export interface PrintJob {
  orderId: string;
  media: PrintSizeKey;
  finish: 'gloss' | 'matte';
  copies: number;
  reprint: boolean;
  status: JobStatus;
  message: string;
  createdAt: number;
  updatedAt: number;
  enc?: { alg: string; key: string; iv: string; kid?: string } | null;
  mime?: string;
  data?: string | null;
}

export interface BridgeStatus {
  name?: string;
  version?: string;
  publicKey?: string;
  lastSeen?: number;
  printer?: { name?: string; state?: string; message?: string; jobsInQueue?: number };
  payments?: { provider?: string; ready?: boolean; message?: string };
}

/** The bridge is considered online when it reported in the last 90 seconds (server time). */
export const bridgeOnline = (b: BridgeStatus | null | undefined, now = serverNow()) =>
  !!b?.lastSeen && now - b.lastSeen < 90_000;

export const printerReady = (b: BridgeStatus | null | undefined) =>
  b?.printer?.state === 'ready' || b?.printer?.state === 'printing';

/** Total in paise for an order. */
export function priceFor(s: BoothSettings, size: PrintSizeKey, bw: boolean, copies: number): number {
  if (s.freeMode) return 0;
  const p = s.prices[size] ?? DEFAULT_PRICES[size];
  return (bw ? p.bw : p.colour) + Math.max(0, Math.min(9, copies - 1)) * p.extraCopy;
}

export function fromPrice(s: BoothSettings, size: PrintSizeKey): number {
  if (s.freeMode) return 0;
  const p = s.prices[size] ?? DEFAULT_PRICES[size];
  return Math.min(p.colour, p.bw);
}

const inr = new Intl.NumberFormat('en-IN');
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 15000 → "₹150", 15050 → "₹150.50". */
export const rupees = (paise: number) => (paise % 100 === 0 ? `₹${inr.format(paise / 100)}` : `₹${inr2.format(paise / 100)}`);

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
