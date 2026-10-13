/**
 * The 6 custom AI Retro templates plus the generated standard layouts.
 * Ported 1:1 from kiosk_app/lib/templates/builtin_templates.dart (same ids and geometry).
 */
import { PRINT_SIZES, SIZE_ORDER, type Layer, type PrintSizeInfo, type SlotDef, type TemplateDef } from './types';

/** Picok brand rainbow (from the logo lens ring). */
export const PICOK_RAINBOW: string[] = ['#19D3E6', '#2F6BFF', '#8B3DFF', '#FF3D9A', '#FF8A1F', '#FFD21F'];

export function builtinTemplates(): TemplateDef[] {
  return [...retroTemplates(), ...standardTemplates()];
}

export function retroTemplates(): TemplateDef[] {
  return [groovy70s(), neon80s(), bollywoodPoster(), vintageFilmStrip(), popComic90s(), oldTimesNewspaper()];
}

function retro(t: Omit<TemplateDef, 'category' | 'landscape' | 'packId'>): TemplateDef {
  return { ...t, category: 'retro', landscape: false, packId: 'builtin', activeFrom: null, activeTo: null };
}

function slot(x: number, y: number, w: number, h: number, extra: Partial<SlotDef> = {}): SlotDef {
  return { x, y, w, h, radius: 0, rotation: 0, borderWidth: 0, shadow: false, ...extra };
}

// 1 · Groovy '70s — 4×6, 2 photos, warm film filter.
function groovy70s(): TemplateDef {
  return retro({
    id: 'retro_groovy_70s',
    name: "Groovy '70s",
    description: 'Sunset rainbow arcs, cream paper and warm faded tones.',
    size: '4x6',
    filter: 'warm_film',
    background: { color: '#F4E9D3' },
    layers: [
      { type: 'arcs', cx: 600, cy: 340, r: 620, band: 44, gap: 6, colors: ['#D9480F', '#F28C28', '#F6B93B', '#8AA05A', '#3E8E8E'] },
      {
        type: 'text', text: 'Groovy!', font: 'Shrikhand', size: 170, color: '#C2410C',
        x: 150, y: 40, w: 900, shadow: { color: '#F6B93B', dx: 9, dy: 9 },
      },
      {
        type: 'text', text: '{event}', fallback: 'Far out, friends!', font: 'Poppins',
        weight: 700, size: 46, color: '#7A4A1E', letterSpacing: 3, uppercase: true,
        x: 220, y: 268, w: 760,
      },
      { type: 'rect', x: 0, y: 1548, w: 1200, h: 10, color: '#D9480F' },
      { type: 'rect', x: 0, y: 1562, w: 1200, h: 10, color: '#F28C28' },
      { type: 'rect', x: 0, y: 1576, w: 1200, h: 10, color: '#F6B93B' },
    ],
    slots: [
      slot(90, 372, 1020, 560, { radius: 34, rotation: -1.4, borderWidth: 14, borderColor: '#FFF8EC', shadow: true }),
      slot(90, 968, 1020, 560, { radius: 34, rotation: 1.4, borderWidth: 14, borderColor: '#FFF8EC', shadow: true }),
    ],
    logo: { x: 0, y: 1600, w: 1200, h: 200, bg: '#3B2314', textColor: '#F4E9D3', font: 'Poppins' },
  });
}

// 2 · Neon '80s Synthwave — 4×6, 3 photos, neon pop filter.
function neon80s(): TemplateDef {
  return retro({
    id: 'retro_neon_80s',
    name: "Neon '80s Synthwave",
    description: 'Glowing pink and cyan grid on a midnight-purple sky.',
    size: '4x6',
    filter: 'neon_pop',
    background: { gradient: { colors: ['#0B0620', '#22094F', '#4A1677'], stops: [0.0, 0.45, 1.0] } },
    layers: [
      { type: 'dots', x: 0, y: 0, w: 1200, h: 420, spacing: 64, rMax: 2.2, rMin: 2.2, color: '#66FFFFFF' },
      { type: 'sun', cx: 600, cy: 330, r: 240, glow: 50, bands: 7, bandColor: '#1A0841', colors: ['#FFD23F', '#FF6B9A', '#C23BFF'] },
      {
        type: 'text', text: 'NEON', font: 'Monoton', size: 200, color: '#FFFFFF',
        x: 100, y: 70, w: 1000, glow: { color: '#FF2BD6', blur: 20 },
      },
      {
        type: 'text', text: '{EVENT}', fallback: 'RETRO NIGHTS', font: 'BebasNeue', size: 70,
        color: '#22E5FF', letterSpacing: 12, x: 100, y: 352, w: 1000,
        glow: { color: '#22E5FF', blur: 12 },
      },
      { type: 'grid', x: 0, y: 1000, w: 1200, h: 600, cols: 14, rows: 9, color: '#FF2BD6', width: 4, glow: 10 },
      { type: 'rect', x: 82, y: 452, w: 1036, h: 556, radius: 10, stroke: { color: '#22E5FF', width: 6 }, glow: 16 },
      { type: 'rect', x: 82, y: 1052, w: 512, h: 486, radius: 10, stroke: { color: '#FF2BD6', width: 6 }, glow: 16 },
      { type: 'rect', x: 606, y: 1052, w: 512, h: 486, radius: 10, stroke: { color: '#FF2BD6', width: 6 }, glow: 16 },
    ],
    slots: [
      slot(90, 460, 1020, 540, { radius: 6 }),
      slot(90, 1060, 496, 470, { radius: 6 }),
      slot(614, 1060, 496, 470, { radius: 6 }),
    ],
    logo: { x: 0, y: 1600, w: 1200, h: 200, bg: '#0B0620', textColor: '#22E5FF', font: 'Poppins' },
  });
}

// 3 · Bollywood Retro Poster — 4×6, 1 photo, poster colour filter.
function bollywoodPoster(): TemplateDef {
  return retro({
    id: 'retro_bollywood_poster',
    name: 'Bollywood Retro Poster',
    description: 'Hand-painted cinema-poster look with halftone dots and a "Now Showing" title.',
    size: '4x6',
    filter: 'poster',
    background: { color: '#F3D9A4' },
    layers: [
      { type: 'rays', cx: 600, cy: 780, count: 36, colors: ['#F5B53F', '#F3D9A4'], clip: { x: 0, y: 0, w: 1200, h: 1600 } },
      { type: 'dots', x: 0, y: 0, w: 1200, h: 1600, spacing: 22, rMax: 7, rMin: 0, color: '#40B23A48', direction: 'edges' },
      { type: 'starburst', cx: 110, cy: 150, points: 5, rOuter: 62, rInner: 26, jitter: 0, rotation: -90, color: '#C1121F' },
      { type: 'starburst', cx: 1090, cy: 150, points: 5, rOuter: 62, rInner: 26, jitter: 0, rotation: -90, color: '#C1121F' },
      {
        type: 'text', text: 'Superhit!', font: 'Rye', size: 150, color: '#C1121F',
        x: 170, y: 50, w: 860, rotation: -3,
        stroke: { color: '#FFF3D6', width: 16 }, shadow: { color: '#5A0A0A', dx: 8, dy: 8 },
      },
      { type: 'rect', x: -40, y: 1318, w: 1280, h: 124, color: '#C1121F', rotation: -3 },
      {
        type: 'text', text: 'NOW SHOWING', font: 'BebasNeue', size: 100, color: '#FFF3D6',
        letterSpacing: 14, x: 0, y: 1318, w: 1200, h: 124, rotation: -3,
      },
      {
        type: 'text', text: '{EVENT}', fallback: 'IN CINEMAS TODAY', font: 'Rye', size: 58,
        color: '#5A0A0A', x: 60, y: 1468, w: 1080, h: 110,
      },
    ],
    slots: [slot(110, 270, 980, 1010, { borderWidth: 16, borderColor: '#FFF3D6', shadow: true })],
    logo: { x: 0, y: 1600, w: 1200, h: 200, bg: '#5A0A0A', textColor: '#FFF3D6', font: 'Poppins' },
  });
}

// 4 · Vintage Film Strip — 2×6, 4 photos, sepia filter.
function vintageFilmStrip(): TemplateDef {
  const num = (text: string, y: number): Layer => ({
    type: 'text', text, font: 'SpecialElite', size: 26, color: '#E9A13B', x: 470, y, w: 50, align: 'right',
  });
  return retro({
    id: 'retro_vintage_film',
    name: 'Vintage Film Strip',
    description: 'Sprocket-hole film frame with four sepia shots, made for the 2×6 strip.',
    size: '2x6',
    filter: 'sepia',
    background: { color: '#16130F' },
    layers: [
      { type: 'sprockets', x: 0, y: 0, w: 74, h: 1560, holeW: 34, holeH: 26, gap: 22, radius: 5, color: '#E9DFC9' },
      { type: 'sprockets', x: 526, y: 0, w: 74, h: 1560, holeW: 34, holeH: 26, gap: 22, radius: 5, color: '#E9DFC9' },
      {
        type: 'text', text: 'FILM', font: 'SpecialElite', size: 66, color: '#E9DFC9',
        letterSpacing: 22, x: 80, y: 22, w: 440,
      },
      num('1', 112),
      num('2', 468),
      num('3', 824),
      num('4', 1180),
    ],
    slots: [
      slot(86, 146, 428, 330, { radius: 8 }),
      slot(86, 502, 428, 330, { radius: 8 }),
      slot(86, 858, 428, 330, { radius: 8 }),
      slot(86, 1214, 428, 330, { radius: 8 }),
    ],
    logo: { x: 0, y: 1560, w: 600, h: 240, bg: '#16130F', textColor: '#E9DFC9', font: 'SpecialElite' },
  });
}

// 5 · '90s Pop Comic — 4×6, 4 photos, vivid filter.
function popComic90s(): TemplateDef {
  return retro({
    id: 'retro_pop_comic_90s',
    name: "'90s Pop Comic",
    description: 'Comic-book panels, bold outlines and a "POW!" title.',
    size: '4x6',
    filter: 'vivid',
    background: { color: '#FFE14D' },
    layers: [
      { type: 'dots', x: 0, y: 0, w: 1200, h: 1600, spacing: 26, rMax: 6, rMin: 6, color: '#55FF3D9A' },
      {
        type: 'starburst', cx: 600, cy: 150, points: 16, rOuter: 215, rInner: 135,
        color: '#FF3B30', stroke: { color: '#111111', width: 10 }, shadow: { color: '#111111', dx: 12, dy: 12 },
      },
      {
        type: 'text', text: 'POW!', font: 'Bangers', size: 160, color: '#FFE14D', letterSpacing: 6,
        x: 350, y: 52, w: 500, rotation: -6, stroke: { color: '#111111', width: 14 },
      },
      {
        type: 'text', text: 'ZAP!', font: 'Bangers', size: 92, color: '#22A7F0',
        x: 30, y: 70, w: 300, rotation: -14, stroke: { color: '#111111', width: 9 },
      },
      { type: 'polygon', points: [[930, 205], [900, 268], [985, 212]], color: '#FFFFFF', stroke: { color: '#111111', width: 7 } },
      { type: 'rect', x: 850, y: 60, w: 310, h: 160, radius: 70, color: '#FFFFFF', stroke: { color: '#111111', width: 7 } },
      {
        type: 'text', text: '{EVENT}', fallback: 'WOW!', font: 'Bangers', size: 62, color: '#111111',
        maxLines: 2, x: 870, y: 72, w: 270, h: 136, letterSpacing: 2,
      },
    ],
    slots: [
      slot(64, 316, 516, 560, { rotation: -1.6, borderWidth: 12, borderColor: '#111111' }),
      slot(620, 316, 516, 560, { rotation: 1.6, borderWidth: 12, borderColor: '#111111' }),
      slot(64, 930, 516, 600, { rotation: 1.2, borderWidth: 12, borderColor: '#111111' }),
      slot(620, 930, 516, 600, { rotation: -1.2, borderWidth: 12, borderColor: '#111111' }),
    ],
    logo: { x: 0, y: 1600, w: 1200, h: 200, bg: '#111111', textColor: '#FFE14D', font: 'Poppins' },
  });
}

// 6 · Old Times Newspaper — 4×6, 1 photo, classic B&W filter.
function oldTimesNewspaper(): TemplateDef {
  return retro({
    id: 'retro_old_times_news',
    name: 'Old Times Newspaper',
    description: 'Front-page headline with the event name. Looks best in black & white.',
    size: '4x6',
    filter: 'classic_bw',
    background: { color: '#F1EAD8' },
    layers: [
      { type: 'text', text: 'The Daily Booth', font: 'UnifrakturMaguntia', size: 128, color: '#151515', x: 50, y: 30, w: 1100 },
      { type: 'line', x1: 50, y1: 214, x2: 1150, y2: 214, width: 6, color: '#151515' },
      { type: 'line', x1: 50, y1: 228, x2: 1150, y2: 228, width: 2, color: '#151515' },
      {
        type: 'text', text: '{date}', fallback: 'SPECIAL EDITION', font: 'OldStandard', size: 28, color: '#151515',
        align: 'left', x: 56, y: 238, w: 380, uppercase: true,
      },
      { type: 'text', text: 'VOL. I  ·  No. 1', font: 'OldStandard', size: 28, color: '#151515', x: 400, y: 238, w: 400 },
      { type: 'text', text: 'PRICE: ONE SMILE', font: 'OldStandard', size: 28, color: '#151515', align: 'right', x: 764, y: 238, w: 380 },
      { type: 'line', x1: 50, y1: 284, x2: 1150, y2: 284, width: 2, color: '#151515' },
      {
        type: 'text', text: '{EVENT}', fallback: 'LOCAL STARS SPOTTED!', font: 'OldStandard', weight: 700,
        size: 92, maxLines: 2, lineHeight: 1.05, color: '#151515', x: 50, y: 300, w: 1100, h: 220,
      },
      {
        type: 'text', text: 'Pictured: our guests, looking absolutely fabulous.', font: 'OldStandard',
        italic: true, size: 30, color: '#333333', x: 50, y: 1256, w: 1100,
      },
      { type: 'line', x1: 50, y1: 1306, x2: 1150, y2: 1306, width: 2, color: '#151515' },
      { type: 'lines', x: 50, y: 1326, w: 1100, h: 250, columns: 3, gutter: 40, lineHeight: 22, thickness: 7, color: '#59151515' },
    ],
    slots: [slot(50, 536, 1100, 704, { borderWidth: 3, borderColor: '#151515' })],
    logo: { x: 0, y: 1600, w: 1200, h: 200, bg: '#151515', textColor: '#F1EAD8', font: 'OldStandard' },
  });
}

// ---- standard layouts --------------------------------------------------------

type StdStyle = 'classic' | 'midnight';
const STD_STYLES: { name: StdStyle; label: string }[] = [
  { name: 'classic', label: 'Classic White' },
  { name: 'midnight', label: 'Picok Midnight' },
];

export function standardTemplates(): TemplateDef[] {
  const out: TemplateDef[] = [];
  for (const key of SIZE_ORDER) {
    const size = PRINT_SIZES[key];
    for (const n of size.photoCounts) {
      for (const style of STD_STYLES) out.push(standard(size, n, style, false));
    }
  }
  // 4×6 postcards can also print landscape.
  for (const n of [1, 2, 3, 4]) {
    for (const style of STD_STYLES) out.push(standard(PRINT_SIZES['4x6'], n, style, true));
  }
  return out;
}

function logoHeight(size: PrintSizeInfo, landscape: boolean): number {
  if (landscape) return 170;
  switch (size.key) {
    case '2x6':
      return 240;
    case '4x6':
      return 200;
    case '3.5x5':
      return 175;
    case '5x7':
      return 235;
    case '6x8':
      return 265;
  }
}

/** Generates slots for [n] photos in a W×H area above the logo strip. */
export function standardSlots(size: PrintSizeInfo, n: number, landscape: boolean, radius = 0): SlotDef[] {
  const w = landscape ? size.heightPx : size.widthPx;
  const h = landscape ? size.widthPx : size.heightPx;
  const logoH = logoHeight(size, landscape);
  const m = size.isStrip ? 36 : w * 0.05;
  const gap = size.isStrip ? 24 : w * 0.03;
  const areaW = w - m * 2;
  const areaH = h - logoH - m * 2 + m * 0.5;
  const top = m;
  const s = (x: number, y: number, sw: number, sh: number): SlotDef => slot(x, y, sw, sh, { radius });

  if (n === 1) return [s(m, top, areaW, areaH)];

  // Stack vertically for strips and portrait 2/3-photo layouts; columns for landscape.
  const columns = landscape && n <= 3;
  const grid = n === 4 && !size.isStrip;
  if (grid) {
    const cw = (areaW - gap) / 2,
      ch = (areaH - gap) / 2;
    return [s(m, top, cw, ch), s(m + cw + gap, top, cw, ch), s(m, top + ch + gap, cw, ch), s(m + cw + gap, top + ch + gap, cw, ch)];
  }
  if (columns) {
    const cw = (areaW - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => s(m + i * (cw + gap), top, cw, areaH));
  }
  const ch = (areaH - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => s(m, top + i * (ch + gap), areaW, ch));
}

function standard(size: PrintSizeInfo, n: number, style: { name: StdStyle; label: string }, landscape: boolean): TemplateDef {
  const w = landscape ? size.heightPx : size.widthPx;
  const h = landscape ? size.widthPx : size.heightPx;
  const logoH = logoHeight(size, landscape);
  const dark = style.name === 'midnight';
  const orient = landscape ? ' · Landscape' : '';
  const layers: Layer[] = dark
    ? [
        {
          type: 'rect', x: 0, y: h - logoH - 6, w, h: 6,
          gradient: { colors: PICOK_RAINBOW, begin: [0, 0.5], end: [1, 0.5] },
        },
      ]
    : [];
  return {
    id: `std_${style.name}_${size.key}_${n}${landscape ? '_l' : ''}`,
    name: `${style.label}${orient}`,
    category: 'standard',
    description: `${n} photo${n === 1 ? '' : 's'} · ${size.shortLabel}`,
    size: size.key,
    landscape,
    filter: 'none',
    background: { color: dark ? '#0A0A0F' : '#FFFFFF' },
    layers,
    slots: standardSlots(size, n, landscape, dark ? 10 : 0),
    logo: {
      x: 0,
      y: h - logoH,
      w,
      h: logoH,
      bg: dark ? '#0A0A0F' : '#FFFFFF',
      textColor: dark ? '#FFFFFF' : '#111111',
      font: 'Poppins',
    },
    packId: 'builtin',
    activeFrom: null,
    activeTo: null,
  };
}
