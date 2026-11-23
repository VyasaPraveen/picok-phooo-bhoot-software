/**
 * Generates the client's AI poster designs (4x6 portrait, 1200x1800, logo strip at y 1600):
 * - the four client designs (AI design slots 3-6) -> web/seed/client_ai_designs.json, loaded into a booth
 *   with `firebase database:update /booths/<boothId>/customTemplates web/seed/client_ai_designs.json`;
 * - the festival designs -> web/public/cloud/packs (published with the hosting deploy).
 * Run from the repo root: node web/seed/ai-designs.mjs
 * The legacy template_cloud/public folder mirrors web/public/cloud; copy the packs there too.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLOUD = join(HERE, '..', 'public', 'cloud');
const r1 = (v) => Math.round(v * 10) / 10;

/** Heart outline as polygon points, centred at (cx, cy), `s` = half width. */
function heart(cx, cy, s, rot = 0) {
  const pts = [];
  const a = (rot * Math.PI) / 180;
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    const k = s / 16;
    const rx = x * k, ry = y * k;
    pts.push([r1(cx + rx * Math.cos(a) - ry * Math.sin(a)), r1(cy + rx * Math.sin(a) + ry * Math.cos(a))]);
  }
  return pts;
}

const slot = (x, y, w, h, extra = {}) => ({ x, y, w, h, radius: 0, rotation: 0, borderWidth: 0, shadow: false, ...extra });
const logo = (bg, textColor, font = 'Poppins') => ({ x: 0, y: 1600, w: 1200, h: 200, bg, textColor, font });
const GOLD = { colors: ['#FFF1B8', '#F2C14E', '#B07A12'], begin: [0.5, 0], end: [0.5, 1] };

// ---- 1 · Royal King ---------------------------------------------------------------------------
const royalKing = {
  id: 'ai_royal_king',
  name: 'Royal King',
  category: 'custom',
  description: 'Palace arch, royal banners, a golden crown and a "Royal King" title.',
  size: '4x6',
  filter: 'warm_film',
  background: { gradient: { type: 'radial', center: [0.5, 0.38], radius: 0.75, colors: ['#8E1526', '#5A0A16', '#24040A'], stops: [0, 0.55, 1] } },
  layers: [
    { type: 'rays', cx: 600, cy: 640, count: 44, colors: ['#26FFD27A', '#00FFD27A'] },
    { type: 'dots', x: 0, y: 0, w: 1200, h: 1600, spacing: 30, rMax: 4, rMin: 0, color: '#55F2C14E', direction: 'edges' },
    { type: 'arcs', cx: 600, cy: 560, r: 520, band: 16, gap: 10, colors: ['#F2C14E', '#B07A12', '#F2C14E'] },
    // Banners with a lion-crest medallion.
    ...[[30, 175], [1025, 1170]].flatMap(([x0, x1]) => {
      const cx = (x0 + x1) / 2;
      return [
        { type: 'polygon', points: [[x0, 0], [x1, 0], [x1, 700], [cx, 640], [x0, 700]], gradient: { colors: ['#B3192E', '#7A0F1E'], begin: [0, 0.5], end: [1, 0.5] }, stroke: { color: '#F2C14E', width: 6 } },
        { type: 'circle', cx, cy: 330, r: 52, gradient: GOLD },
        { type: 'starburst', cx, cy: 330, points: 8, rOuter: 40, rInner: 18, jitter: 0, rotation: -90, color: '#7A0F1E' },
        { type: 'line', x1: x0 + 16, y1: 120, x2: x1 - 16, y2: 120, width: 4, color: '#F2C14E' },
        { type: 'line', x1: x0 + 16, y1: 540, x2: x1 - 16, y2: 540, width: 4, color: '#F2C14E' },
      ];
    }),
    // Crown over the bottom of the photo.
    { type: 'polygon', z: 'above', points: [[470, 1300], [730, 1300], [752, 1178], [672, 1236], [600, 1140], [528, 1236], [448, 1178]], gradient: GOLD, stroke: { color: '#5A3A08', width: 5 } },
    { type: 'rect', z: 'above', x: 466, y: 1286, w: 268, h: 30, radius: 6, gradient: GOLD, stroke: { color: '#5A3A08', width: 4 } },
    { type: 'circle', z: 'above', cx: 448, cy: 1172, r: 13, color: '#F2C14E' },
    { type: 'circle', z: 'above', cx: 600, cy: 1132, r: 15, color: '#F2C14E' },
    { type: 'circle', z: 'above', cx: 752, cy: 1172, r: 13, color: '#F2C14E' },
    { type: 'circle', z: 'above', cx: 600, cy: 1240, r: 14, color: '#C1121F' },
    { type: 'text', z: 'above', text: 'ROYAL KING', font: 'OldStandard', weight: 700, size: 150, color: '#F6C445', x: 40, y: 1318, w: 1120, h: 170, letterSpacing: 4, stroke: { color: '#4A0610', width: 12 }, shadow: { color: '#C0000000', dx: 6, dy: 8, blur: 8 } },
    { type: 'line', x1: 250, y1: 1500, x2: 950, y2: 1500, width: 4, color: '#F2C14E' },
    { type: 'polygon', points: [[600, 1484], [618, 1500], [600, 1516], [582, 1500]], color: '#F2C14E' },
    { type: 'text', text: '{event}', fallback: 'Long live the king', font: 'Poppins', weight: 600, size: 34, color: '#FFE6A8', letterSpacing: 8, uppercase: true, x: 100, y: 1530, w: 1000 },
  ],
  slots: [slot(205, 150, 790, 1040, { radius: 18, borderWidth: 16, borderColor: '#E8B84A', shadow: true })],
  logo: logo('#24040A', '#F6C445'),
  aiSlot: 1,
};

// ---- 2 · Be Yourself (anime poster) -----------------------------------------------------------
const beYourself = {
  id: 'ai_be_yourself',
  name: 'Be Yourself · Anime',
  category: 'custom',
  description: 'Anime-poster sunset sky, manga speed lines and "Dream Big · Be Yourself" brush titles.',
  size: '4x6',
  filter: 'poster',
  background: { gradient: { colors: ['#14204A', '#2F4F9A', '#E8963A', '#F7D79A'], stops: [0, 0.42, 0.78, 1] } },
  layers: [
    { type: 'circle', cx: 930, cy: 520, r: 420, gradient: { type: 'radial', colors: ['#AAFFE6A8', '#00FFE6A8'] } },
    { type: 'rays', cx: 600, cy: 760, count: 72, colors: ['#18FFFFFF', '#00FFFFFF'] },
    { type: 'dots', x: 0, y: 0, w: 1200, h: 1600, spacing: 24, rMax: 5, rMin: 0, color: '#30FFFFFF', direction: 'down' },
    { type: 'text', text: 'Dream Big...', font: 'Pacifico', size: 92, color: '#FFFFFF', x: 80, y: 8, w: 900, align: 'left', rotation: -3, stroke: { color: '#14204A', width: 10 } },
    { type: 'starburst', cx: 1110, cy: 96, points: 4, rOuter: 46, rInner: 10, jitter: 0, rotation: -90, color: '#FFE6A8' },
    { type: 'text', z: 'above', text: 'Be', font: 'Pacifico', size: 120, color: '#FFFFFF', x: 560, y: 1150, w: 560, align: 'right', rotation: -6, stroke: { color: '#111111', width: 12 } },
    { type: 'text', z: 'above', text: 'Yourself', font: 'Pacifico', size: 180, color: '#FFD21F', x: 160, y: 1280, w: 960, align: 'right', rotation: -6, stroke: { color: '#111111', width: 16 }, shadow: { color: '#111111', dx: 6, dy: 8 } },
    { type: 'line', z: 'above', x1: 470, y1: 1572, x2: 1130, y2: 1512, width: 16, color: '#FFD21F' },
  ],
  slots: [slot(70, 190, 1060, 1180, { radius: 26, rotation: -1.2, borderWidth: 12, borderColor: '#FFFFFF', shadow: true })],
  logo: logo('#111111', '#FFD21F'),
  aiSlot: 2,
};

// ---- 3 · Movie Poster -------------------------------------------------------------------------
const moviePoster = {
  id: 'ai_movie_poster',
  name: 'Movie Poster',
  category: 'custom',
  description: 'Action-movie poster: fiery red light, smoke, embers and your title in lights.',
  size: '4x6',
  filter: 'poster',
  background: { gradient: { colors: ['#000000', '#000000', '#5C0C00', '#E4570C'], stops: [0, 0.72, 0.88, 1] } },
  layers: [
    { type: 'rays', cx: 600, cy: 1700, count: 30, colors: ['#36FF4500', '#00000000'] },
    // Cinematic grade over the photo: red light, vignette and a fade into the title.
    { type: 'rect', z: 'above', x: 0, y: 0, w: 1200, h: 1260, color: '#30C81E1E' },
    { type: 'rect', z: 'above', x: 0, y: 0, w: 1200, h: 1260, gradient: { type: 'radial', center: [0.5, 0.42], radius: 0.72, colors: ['#00000000', '#00000000', '#C8000000'], stops: [0, 0.55, 1] } },
    { type: 'rect', z: 'above', x: 0, y: 820, w: 1200, h: 442, gradient: { colors: ['#00000000', '#FF000000'], begin: [0.5, 0], end: [0.5, 1] } },
    { type: 'circle', z: 'above', cx: 120, cy: 1180, r: 260, color: '#22FFFFFF', glow: 80 },
    { type: 'circle', z: 'above', cx: 1080, cy: 1120, r: 280, color: '#1CFFFFFF', glow: 90 },
    { type: 'dots', z: 'above', x: 0, y: 700, w: 1200, h: 900, spacing: 52, rMax: 4.5, rMin: 0, color: '#AAFF8A1F', direction: 'up' },
    { type: 'text', z: 'above', text: 'STARRING YOU', font: 'BebasNeue', size: 58, color: '#FF8A1F', letterSpacing: 20, x: 50, y: 1080, w: 1100 },
    { type: 'text', z: 'above', text: '{EVENT}', fallback: 'THE BOSS', font: 'BebasNeue', size: 230, color: '#FFFFFF', letterSpacing: 10, x: 40, y: 1140, w: 1120, h: 240, glow: { color: '#FF2A00', blur: 18 } },
    { type: 'text', text: 'IN CINEMAS NOW', font: 'BebasNeue', size: 56, color: '#FFE0C2', letterSpacing: 16, x: 50, y: 1392, w: 1100 },
    { type: 'lines', x: 180, y: 1475, w: 840, h: 96, columns: 1, gutter: 0, lineHeight: 22, thickness: 9, color: '#80FFFFFF' },
  ],
  slots: [slot(0, 0, 1200, 1260)],
  logo: logo('#000000', '#FFFFFF'),
  aiSlot: 3,
};

// ---- 4 · Together Forever ---------------------------------------------------------------------
const hearts = (list, z) => list.map(([cx, cy, s, rot, color]) => ({ type: 'polygon', ...(z ? { z } : {}), points: heart(cx, cy, s, rot), color }));
const together = {
  id: 'ai_together_forever',
  name: 'Together Forever',
  category: 'custom',
  description: 'Romantic pink bokeh and hearts with a "Together Forever" script title. Made for couples.',
  size: '4x6',
  filter: 'warm_film',
  background: { gradient: { colors: ['#FFE9F0', '#F9B3CB', '#E2557F'], stops: [0, 0.55, 1] } },
  layers: [
    ...[[120, 160, 90], [1080, 300, 120], [200, 900, 140], [1050, 1100, 110], [600, 60, 80], [140, 1450, 100], [1100, 1500, 90]].map(
      ([cx, cy, r]) => ({ type: 'circle', cx, cy, r, color: '#55FFFFFF', glow: 30 }),
    ),
    ...hearts([[95, 330, 60, -14, '#E2557F'], [1120, 140, 54, 12, '#FF7AA2'], [70, 1180, 46, -8, '#FF7AA2'], [1135, 860, 62, 14, '#E2557F'], [150, 60, 34, 0, '#FF9DBB'], [1000, 40, 30, 10, '#FF9DBB']]),
    { type: 'rect', z: 'above', x: 90, y: 1010, w: 1020, h: 300, gradient: { colors: ['#00E2557F', '#D9C2185B'], begin: [0.5, 0], end: [0.5, 1] } },
    ...hearts([[1060, 120, 44, 12, '#CCFFFFFF'], [130, 1270, 38, -10, '#CCFFFFFF']], 'above'),
    { type: 'text', z: 'above', text: 'Together', font: 'Pacifico', size: 140, color: '#FFFFFF', x: 60, y: 1110, w: 1080, rotation: -4, stroke: { color: '#A3123F', width: 10 }, shadow: { color: '#66000000', dx: 4, dy: 6, blur: 6 } },
    { type: 'text', z: 'above', text: 'Forever', font: 'Pacifico', size: 160, color: '#FFFFFF', x: 160, y: 1270, w: 900, rotation: -4, stroke: { color: '#A3123F', width: 10 }, shadow: { color: '#66000000', dx: 4, dy: 6, blur: 6 } },
    { type: 'polygon', z: 'above', points: heart(1010, 1355, 46, 14), color: '#00000000', stroke: { color: '#FFFFFF', width: 8 } },
    { type: 'text', text: '{event}', fallback: 'Made for each other', font: 'Poppins', weight: 600, size: 34, color: '#FFFFFF', letterSpacing: 6, uppercase: true, x: 100, y: 1535, w: 1000 },
  ],
  slots: [slot(90, 90, 1020, 1220, { radius: 40, borderWidth: 14, borderColor: '#FFFFFF', shadow: true })],
  logo: logo('#A3123F', '#FFFFFF'),
  aiSlot: 4,
};

// ---- Festival: Holi 2027 and a year-round Festival Special --------------------------------------
const splash = (cx, cy, r, color, z) => ({ type: 'circle', ...(z ? { z } : {}), cx, cy, r, color, glow: Math.round(r * 0.35) });
const holi = {
  id: 'holi27_colours_1',
  name: 'Happy Holi',
  category: 'festival',
  description: 'Bursts of gulal colour on white with a "Happy Holi" title.',
  size: '4x6',
  filter: 'vivid',
  background: { color: '#FFFDF8' },
  layers: [
    splash(80, 120, 230, '#CCFF3D9A'), splash(1130, 90, 210, '#CCFFD21F'), splash(1150, 700, 200, '#B322C55E'),
    splash(40, 860, 220, '#B319D3E6'), splash(120, 1480, 240, '#CCFF8A1F'), splash(1110, 1440, 250, '#B38B3DFF'), splash(600, 1600, 180, '#99FF3D9A'),
    { type: 'dots', x: 0, y: 0, w: 1200, h: 1600, spacing: 34, rMax: 6, rMin: 0, color: '#66FF3D9A', direction: 'edges' },
    { type: 'text', text: 'Happy Holi', font: 'Shrikhand', size: 150, color: '#FF3D9A', x: 60, y: 24, w: 1080, stroke: { color: '#FFFFFF', width: 12 }, shadow: { color: '#8B3DFF', dx: 7, dy: 7 } },
    { type: 'text', text: '{event}', fallback: 'Festival of colours', font: 'Poppins', weight: 700, size: 40, color: '#6D28D9', letterSpacing: 6, uppercase: true, x: 100, y: 214, w: 1000 },
    splash(130, 330, 70, '#99FFD21F', 'above'), splash(1080, 1250, 80, '#9922C55E', 'above'),
    { type: 'text', text: 'Bura na mano, Holi hai!', font: 'Pacifico', size: 60, color: '#FF8A1F', x: 60, y: 1462, w: 1080, stroke: { color: '#FFFFFF', width: 8 } },
  ],
  slots: [slot(95, 290, 1010, 1150, { radius: 30, rotation: -1, borderWidth: 14, borderColor: '#FFFFFF', shadow: true })],
  logo: logo('#6D28D9', '#FFFFFF'),
};

const RAINBOW = ['#19D3E6', '#2F6BFF', '#8B3DFF', '#FF3D9A', '#FF8A1F', '#FFD21F'];
const confetti = [];
for (let i = 0; i < 46; i++) {
  // Deterministic scatter along the edges so the photo stays clear.
  const t = (i * 0.618034) % 1;
  const side = i % 4;
  const along = Math.round(t * 1560) + 20;
  const depth = Math.round(((i * 37) % 90) + 10);
  const [x, y] = side === 0 ? [along * 0.75, depth] : side === 1 ? [1200 - depth - 30, along] : side === 2 ? [depth, along] : [along * 0.75, 1600 - depth - 40];
  confetti.push({ type: 'rect', x, y, w: 26, h: 12, radius: 3, rotation: (i * 47) % 180, color: RAINBOW[i % RAINBOW.length] });
}
const festivalSpecial = {
  id: 'festival_special_1',
  name: 'Festival Special',
  category: 'festival',
  description: 'Year-round festive design: confetti, sparkles and "Let\'s Celebrate!". Shown when no festival is on.',
  size: '4x6',
  filter: 'vivid',
  background: { gradient: { type: 'radial', center: [0.5, 0.4], radius: 0.8, colors: ['#3A1478', '#1A0838', '#0B0418'], stops: [0, 0.6, 1] } },
  layers: [
    { type: 'rays', cx: 600, cy: 760, count: 36, colors: ['#1AFFFFFF', '#00FFFFFF'] },
    ...confetti,
    { type: 'starburst', cx: 140, cy: 150, points: 4, rOuter: 50, rInner: 10, jitter: 0, rotation: -90, color: '#FFD21F' },
    { type: 'starburst', cx: 1070, cy: 200, points: 4, rOuter: 40, rInner: 9, jitter: 0, rotation: -90, color: '#FFFFFF' },
    { type: 'text', text: "Let's Celebrate!", font: 'Shrikhand', size: 120, color: '#FFD21F', x: 60, y: 40, w: 1080, glow: { color: '#FF3D9A', blur: 14 } },
    { type: 'text', text: '{event}', fallback: 'Festival special', font: 'Poppins', weight: 700, size: 40, color: '#FFFFFF', letterSpacing: 8, uppercase: true, x: 100, y: 200, w: 1000 },
    { type: 'rect', x: 0, y: 1580, w: 1200, h: 8, gradient: { colors: RAINBOW, begin: [0, 0.5], end: [1, 0.5] } },
  ],
  slots: [slot(110, 290, 980, 1220, { radius: 28, borderWidth: 12, borderColor: '#FFD21F', shadow: true })],
  logo: logo('#0B0418', '#FFD21F'),
};

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};
const pack = (id, name, from, to, templates) => ({ id, name, version: 1, ...(from ? { activeFrom: from, activeTo: to } : {}), fonts: [], templates });

write(`${CLOUD}/packs/festival_holi_2027/pack.json`, pack('festival_holi_2027', 'Holi 2027', '2027-03-15', '2027-03-24', [holi]));
write(`${CLOUD}/packs/festival_special/pack.json`, pack('festival_special', 'Festival Special (year-round)', null, null, [festivalSpecial]));
write(join(HERE, 'client_ai_designs.json'), Object.fromEntries([royalKing, beYourself, moviePoster, together].map((t) => [t.id, t])));
console.log('AI designs written');
