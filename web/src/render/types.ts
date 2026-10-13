/**
 * Print sizes, media rolls and the template model. Ported from
 * kiosk_app/lib/models/print_size.dart and kiosk_app/lib/templates/template_def.dart.
 * The JSON shape is documented in template_cloud/README.md and must stay compatible.
 */

export type PrintSizeKey = '2x6' | '4x6' | '3.5x5' | '5x7' | '6x8';

export interface PrintSizeInfo {
  key: PrintSizeKey;
  label: string;
  shortLabel: string;
  mm: string;
  blurb: string;
  /** Portrait canvas size in pixels at 300 dpi. */
  widthPx: number;
  heightPx: number;
  /** Photo counts offered for this size. */
  photoCounts: number[];
  /** A 2×6 strip is printed as a pair on one 4×6 sheet and cut by the printer. */
  isStrip: boolean;
}

export const PRINT_SIZES: Record<PrintSizeKey, PrintSizeInfo> = {
  '2x6': {
    key: '2x6',
    label: '2 × 6 Photo Strip',
    shortLabel: '2×6 Strip',
    mm: '51 × 152 mm',
    blurb: 'Classic photo strip · you get 2 strips',
    widthPx: 600,
    heightPx: 1800,
    photoCounts: [3, 4],
    isStrip: true,
  },
  '4x6': {
    key: '4x6',
    label: '4 × 6 Postcard',
    shortLabel: '4×6',
    mm: '101 × 152 mm',
    blurb: 'Our most popular postcard size',
    widthPx: 1200,
    heightPx: 1800,
    photoCounts: [1, 2, 3, 4],
    isStrip: false,
  },
  '3.5x5': {
    key: '3.5x5',
    label: '3.5 × 5 Print',
    shortLabel: '3.5×5',
    mm: '89 × 127 mm',
    blurb: 'Smaller print, lower price',
    widthPx: 1050,
    heightPx: 1500,
    photoCounts: [1, 2, 4],
    isStrip: false,
  },
  '5x7': {
    key: '5x7',
    label: '5 × 7 Print',
    shortLabel: '5×7',
    mm: '127 × 178 mm',
    blurb: 'Large frame-ready print',
    widthPx: 1500,
    heightPx: 2100,
    photoCounts: [1, 2, 4],
    isStrip: false,
  },
  '6x8': {
    key: '6x8',
    label: '6 × 8 Print',
    shortLabel: '6×8',
    mm: '152 × 203 mm',
    blurb: 'Extra large print',
    widthPx: 1800,
    heightPx: 2400,
    photoCounts: [1, 2, 4],
    isStrip: false,
  },
};

export const SIZE_ORDER: PrintSizeKey[] = ['2x6', '4x6', '3.5x5', '5x7', '6x8'];

export function isPrintSizeKey(v: unknown): v is PrintSizeKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PRINT_SIZES, v);
}

export type MediaRollKey = '4x6' | '3.5x5' | '5x7' | '6x8';

export interface MediaRollInfo {
  key: MediaRollKey;
  label: string;
  /** Prints per roll (DNP RX1HS media set = 2 rolls of this many prints). */
  capacity: number;
  sizes: PrintSizeKey[];
}

/** The media roll loaded in the printer. The DNP holds one roll at a time. */
export const MEDIA_ROLLS: Record<MediaRollKey, MediaRollInfo> = {
  '4x6': { key: '4x6', label: '4×6 media (prints 4×6 and 2×6 strips)', capacity: 700, sizes: ['4x6', '2x6'] },
  '3.5x5': { key: '3.5x5', label: '3.5×5 media', capacity: 700, sizes: ['3.5x5'] },
  '5x7': { key: '5x7', label: '5×7 media', capacity: 400, sizes: ['5x7'] },
  '6x8': { key: '6x8', label: '6×8 media', capacity: 350, sizes: ['6x8'] },
};

/** A rectangle (template pixels at 300 dpi) where one customer photo is placed. */
export interface SlotDef {
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
  /** Degrees, clockwise, around the slot centre. */
  rotation?: number;
  borderWidth?: number;
  borderColor?: string;
  shadow?: boolean;
}

/** The brand-logo strip that appears at the bottom of every print. */
export interface LogoAreaDef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Strip background colour; null = transparent (template artwork shows through). */
  bg?: string | null;
  textColor?: string;
  font?: string;
}

/** A decoration layer. `z: "above"` draws it over the photos. */
export type Layer = Record<string, unknown> & { type: string; z?: 'above' | 'below' };

export interface TemplateDef {
  id: string;
  name: string;
  /** 'retro', 'standard', 'festival', 'event' or 'custom'. */
  category: string;
  description?: string;
  size: PrintSizeKey;
  landscape?: boolean;
  filter?: string;
  background?: Record<string, unknown>;
  layers?: Layer[];
  slots: SlotDef[];
  logo: LogoAreaDef;
  /** Inclusive `yyyy-mm-dd`. */
  activeFrom?: string | null;
  activeTo?: string | null;
  packId?: string;
}

export function templateWidth(t: TemplateDef): number {
  const s = PRINT_SIZES[t.size];
  return t.landscape ? s.heightPx : s.widthPx;
}

export function templateHeight(t: TemplateDef): number {
  const s = PRINT_SIZES[t.size];
  return t.landscape ? s.widthPx : s.heightPx;
}

/** Whether a date-limited (festival/event) template is live on [d] (local calendar day). */
export function isActiveOn(t: TemplateDef, d: Date): boolean {
  const day = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  if (t.activeFrom && day < t.activeFrom) return false;
  if (t.activeTo && day > t.activeTo) return false;
  return true;
}

// ---- parsing ------------------------------------------------------------------

class InvalidTemplate extends Error {}

type Json = Record<string, unknown>;

function isMap(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function n(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** Dart `as String?`: null/missing is fine, any other type invalidates the template. */
function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new InvalidTemplate();
  return v;
}

/** Dart `as Map?`. */
function optMap(v: unknown): Json | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isMap(v)) throw new InvalidTemplate();
  return v;
}

/** Dart `as List?`. */
function optList(v: unknown): unknown[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new InvalidTemplate();
  return v;
}

function ymd(y: number, m: number, d: number): string {
  const p = (x: number, w: number): string => String(x).padStart(w, '0');
  return `${p(y, 4)}-${p(m, 2)}-${p(d, 2)}`;
}

/** Accepts `yyyy-mm-dd` (optionally with a time part, or compact `yyyymmdd`) → normalised `yyyy-mm-dd`. */
function parseDate(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:[T ].*)?$/.exec(v.trim());
  if (!m) return null;
  // Overflowing days roll over like Dart's DateTime (e.g. 2026-02-30 → 2026-03-02).
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(dt.getTime())) return null;
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function parseSlot(j: Json): SlotDef {
  const slot: SlotDef = {
    x: n(j.x),
    y: n(j.y),
    w: n(j.w),
    h: n(j.h),
    radius: n(j.radius),
    rotation: n(j.rotation),
    borderWidth: n(j.borderWidth),
    shadow: j.shadow === true,
  };
  const bc = optString(j.borderColor);
  if (bc !== undefined) slot.borderColor = bc;
  return slot;
}

function parseLogo(j: Json): LogoAreaDef {
  return {
    x: n(j.x),
    y: n(j.y),
    w: n(j.w),
    h: n(j.h),
    bg: optString(j.bg) ?? null,
    textColor: optString(j.textColor) ?? '#FFFFFF',
    font: optString(j.font) ?? 'Poppins',
  };
}

/**
 * Parses a template from JSON (an object, or a JSON string). Returns null if it is not
 * valid, so one bad remote template never breaks the booth. Same rules as `TemplateDef.tryParse`.
 */
export function parseTemplate(json: unknown, packId = 'builtin'): TemplateDef | null {
  try {
    const j: unknown = typeof json === 'string' ? JSON.parse(json) : json;
    if (!isMap(j)) return null;
    const sizeKey = optString(j.size);
    const slotsRaw = optList(j.slots);
    const logo = j.logo;
    const id = j.id;
    if (!isPrintSizeKey(sizeKey) || !slotsRaw || !isMap(logo) || typeof id !== 'string') return null;
    const slots = slotsRaw.filter(isMap).map(parseSlot);
    if (slots.length === 0 || slots.length > 4) return null;
    const layers = (optList(j.layers) ?? []).filter(
      (e): e is Layer => isMap(e) && typeof e.type === 'string',
    );
    return {
      id,
      name: optString(j.name) ?? id,
      category: optString(j.category) ?? 'event',
      size: sizeKey,
      landscape: j.landscape === true,
      filter: optString(j.filter) ?? 'none',
      description: optString(j.description) ?? '',
      background: optMap(j.background) ?? { color: '#FFFFFF' },
      layers,
      slots,
      logo: parseLogo(logo),
      packId,
      activeFrom: parseDate(j.activeFrom),
      activeTo: parseDate(j.activeTo),
    };
  } catch {
    return null;
  }
}
