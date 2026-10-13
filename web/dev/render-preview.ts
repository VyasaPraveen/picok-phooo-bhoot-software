/**
 * Dev-only preview of the web template renderer (served by `vite` at /dev/render-preview.html,
 * not part of the production build).
 *
 * Query params: `group=retro|bw|std|pack|all` (default all), `id=<template id>` for one large
 * render, `bw=1` with `id`, `scale=0.5`, `cell=280` (grid cell px), `perf=0` to skip timing.
 */
import {
  builtinTemplates,
  ensureFonts,
  parseTemplate,
  renderTemplate,
  retroTemplates,
  stripSheet,
  type RenderRequest,
  type TemplateDef,
} from '../src/render';

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '0.5') || 0.5;
const group = params.get('group') ?? 'all';
const onlyId = params.get('id');
const logEl = document.getElementById('log') as HTMLPreElement;
const grid = document.getElementById('grid') as HTMLDivElement;
if (params.get('cell')) grid.style.setProperty('--cell', `${Number(params.get('cell'))}px`);
const lines: string[] = [];
const log = (s: string): void => {
  lines.push(s);
  logEl.textContent = lines.join('\n');
};

/** A copy of template_cloud/public/packs/festival_diwali_2026 (exercises JSON parsing). */
const DIWALI_JSON = `{
  "id": "diwali26_diyas_2", "name": "Festival of Lights", "category": "festival",
  "description": "Golden diyas and rangoli dots on deep maroon.", "size": "4x6", "filter": "warm_film",
  "background": { "gradient": { "colors": ["#3A0610", "#6B0F1A", "#3A0610"], "stops": [0, 0.5, 1] } },
  "layers": [
    { "type": "dots", "x": 0, "y": 0, "w": 1200, "h": 1600, "spacing": 30, "rMax": 4, "rMin": 0, "color": "#55FFC94A", "direction": "edges" },
    { "type": "starburst", "cx": 600, "cy": 150, "points": 12, "rOuter": 120, "rInner": 60, "jitter": 0, "color": "#33FFC94A" },
    { "type": "text", "text": "Happy Diwali", "font": "Shrikhand", "size": 120, "color": "#FFC94A", "x": 80, "y": 60, "w": 1040,
      "glow": { "color": "#FF8A1F", "blur": 14 } },
    { "type": "text", "text": "{event}", "fallback": "Shubh Deepavali", "font": "Poppins", "weight": 600, "size": 40, "color": "#FFE6A8",
      "letterSpacing": 4, "uppercase": true, "x": 100, "y": 232, "w": 1000 },
    { "type": "circle", "cx": 160, "cy": 1530, "r": 46, "color": "#C4691B" },
    { "type": "polygon", "points": [[140, 1488], [160, 1430], [180, 1488]], "color": "#FFD21F" },
    { "type": "circle", "cx": 600, "cy": 1530, "r": 46, "color": "#C4691B" },
    { "type": "polygon", "points": [[580, 1488], [600, 1430], [620, 1488]], "color": "#FFD21F" },
    { "type": "circle", "cx": 1040, "cy": 1530, "r": 46, "color": "#C4691B" },
    { "type": "polygon", "points": [[1020, 1488], [1040, 1430], [1060, 1488]], "color": "#FFD21F" }
  ],
  "slots": [
    { "x": 90, "y": 310, "w": 1020, "h": 540, "radius": 24, "borderWidth": 10, "borderColor": "#FFC94A", "shadow": true },
    { "x": 90, "y": 880, "w": 1020, "h": 540, "radius": 24, "borderWidth": 10, "borderColor": "#FFC94A", "shadow": true }
  ],
  "logo": { "x": 0, "y": 1600, "w": 1200, "h": 200, "bg": "#2A040B", "textColor": "#FFC94A" }
}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${src}`));
    img.src = src;
  });
}

/** A camera-sized synthetic "photo" so the timing includes real image scaling. */
function fakePhoto(i: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1920;
  c.height = 1440;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const g = ctx.createLinearGradient(0, 0, 1920, 1440);
  g.addColorStop(0, `hsl(${i * 80}, 70%, 60%)`);
  g.addColorStop(1, `hsl(${i * 80 + 140}, 70%, 35%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1920, 1440);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 260px sans-serif';
  ctx.fillText(`#${i + 1}`, 160, 400);
  ctx.beginPath();
  ctx.arc(1200, 800, 380, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function addFigure(canvas: HTMLCanvasElement, caption: string): void {
  const fig = document.createElement('figure');
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.alt = caption;
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(img, cap);
  grid.append(fig);
}

async function main(): Promise<void> {
  const t0 = performance.now();
  await ensureFonts();
  log(`fonts ready in ${(performance.now() - t0).toFixed(0)} ms`);
  const [logo, logoOnLight] = await Promise.all([
    loadImage('/brand/picok_logo_transparent.png'),
    loadImage('/brand/picok_logo.png'),
  ]);

  const all = builtinTemplates();
  // JSON round trip of every built-in must parse back to an equivalent template.
  const bad = all.filter((t) => parseTemplate(JSON.parse(JSON.stringify(t)) as unknown) === null).map((t) => t.id);
  const invalid = [
    parseTemplate({ id: 'x', size: '4x6', slots: [], logo: {} }),
    parseTemplate({ id: 'x', size: '9x9', slots: [{ x: 0, y: 0, w: 1, h: 1 }], logo: {} }),
    parseTemplate({ id: 'x', size: '4x6', name: 7, slots: [{ x: 0, y: 0, w: 1, h: 1 }], logo: {} }),
  ].filter((t) => t !== null).length;
  log(`builtins: ${all.length} templates, round-trip failures: ${bad.length ? bad.join(', ') : 'none'}, invalid accepted: ${invalid}`);
  const diwali = parseTemplate(DIWALI_JSON, 'festival_diwali_2026');
  log(`diwali pack template parsed: ${diwali ? 'yes' : 'NO'}`);

  const base = (t: TemplateDef, bw: boolean): RenderRequest => ({
    template: t,
    logo,
    logoOnLight,
    // Same inputs as kiosk_app/test/render_templates_test.dart (B&W previews have no event text).
    eventName: bw ? '' : 'Ravi weds Priya',
    eventDate: bw ? '' : '12 Oct 2026',
    bw,
  });

  const jobs: { req: RenderRequest; caption: string }[] = [];
  if (onlyId) {
    const t = onlyId === diwali?.id ? diwali : all.find((x) => x.id === onlyId);
    if (t) jobs.push({ req: base(t, params.get('bw') === '1'), caption: t.id });
    else log(`unknown template id ${onlyId}`);
  } else {
    const retro = retroTemplates();
    if (group === 'all' || group === 'retro') for (const t of retro) jobs.push({ req: base(t, false), caption: t.id });
    if (group === 'all' || group === 'bw') {
      for (const t of retro) jobs.push({ req: base(t, true), caption: `${t.id} · B&W` });
      const comic = retro.find((t) => t.id === 'retro_pop_comic_90s');
      if (comic) jobs.push({ req: { ...base(comic, false), bw: true, bwWholePrint: true }, caption: `${comic.id} · whole-print B&W` });
    }
    if (group === 'all' || group === 'std') {
      const ids = [
        'std_classic_2x6_4',
        'std_midnight_2x6_4',
        'std_classic_4x6_2',
        'std_midnight_4x6_2',
        'std_classic_4x6_2_l',
        'std_midnight_4x6_2_l',
        'std_midnight_5x7_4',
        'std_classic_3.5x5_1',
      ];
      for (const id of ids) {
        const t = all.find((x) => x.id === id);
        if (t) jobs.push({ req: base(t, false), caption: id });
      }
    }
    if ((group === 'all' || group === 'pack') && diwali) {
      // The Flutter test renders pack templates with an event name but no date.
      jobs.push({ req: { ...base(diwali, false), eventDate: '' }, caption: `pack ${diwali.id}` });
    }
  }

  const tr = performance.now();
  for (const j of jobs) addFigure(await renderTemplate(j.req, scale), j.caption);
  log(`rendered ${jobs.length} previews at scale ${scale} in ${(performance.now() - tr).toFixed(0)} ms`);

  if ((group === 'all' || group === 'std') && !onlyId) {
    const strip = retroTemplates().find((t) => t.id === 'retro_vintage_film');
    if (strip) {
      const sheet = stripSheet(await renderTemplate({ template: strip, logo }, 1));
      addFigure(sheet, `strip sheet ${sheet.width}×${sheet.height}`);
    }
  }

  if (params.get('perf') !== '0') {
    const comic = all.find((t) => t.id === 'retro_pop_comic_90s');
    const std4 = all.find((t) => t.id === 'std_classic_4x6_4');
    const photos = [0, 1, 2, 3].map(fakePhoto);
    const time = async (label: string, req: RenderRequest): Promise<void> => {
      const runs: number[] = [];
      let size = '';
      for (let i = 0; i < 4; i++) {
        const s = performance.now();
        const c = await renderTemplate(req, 1);
        // Chrome rasterises canvas commands lazily; a 1-px readback makes the timing include it.
        c.getContext('2d')?.getImageData(0, 0, 1, 1);
        runs.push(performance.now() - s);
        size = `${c.width}×${c.height}`;
      }
      const warm = runs.slice(1).sort((a, b) => a - b);
      log(
        `PERF ${label} ${size}: first ${runs[0].toFixed(0)} ms, warm median ${warm[1].toFixed(0)} ms ` +
          `(runs ${runs.map((r) => r.toFixed(0)).join(' / ')})`,
      );
    };
    if (comic) {
      await time('retro_pop_comic_90s, 4 photos, vivid filter', { ...base(comic, false), photos });
      await time('retro_pop_comic_90s, 4 photos, whole-print B&W', { ...base(comic, true), photos, bwWholePrint: true });
    }
    if (std4) await time('std_classic_4x6_4, 4 photos, no filter', { ...base(std4, false), photos });
  }
  log(`done in ${(performance.now() - t0).toFixed(0)} ms`);
  document.body.dataset.done = '1';
}

main().catch((e: unknown) => log(`ERROR ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
