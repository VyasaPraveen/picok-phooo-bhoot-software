/**
 * Draws templates onto a Canvas 2D at 300 dpi (scale 1) or smaller for previews.
 * Ported from kiosk_app/lib/render/template_renderer.dart.
 */
import {
  context2d,
  createCanvas,
  deviceScale,
  drawImageHQ,
  rotateAbout,
  rrectPath,
  shadowOnly,
  sourceSize,
  type Ctx,
  type Rect,
} from './canvas';
import { cssHex, luminance, parseColor } from './color';
import { applyMatrix, photoMatrix, trueBwMatrix } from './filters';
import { drawLayer, fillSpec, type LayerEnv } from './layers';
import { drawLayout, ensureFonts, layoutText, type Align, type TextLayout } from './text';
import { templateHeight, templateWidth, type SlotDef, type TemplateDef } from './types';

export { ensureFonts, registerFont } from './text';

/** Everything needed to draw one print. */
export interface RenderRequest {
  template: TemplateDef;
  /** One entry per slot; a missing/null entry draws a placeholder (used for thumbnails). */
  photos?: (CanvasImageSource | null)[];
  logo?: CanvasImageSource | null;
  /** Optional alternative logo for light strip backgrounds (drawn as a rounded badge). */
  logoOnLight?: CanvasImageSource | null;
  eventName?: string;
  eventDate?: string;
  showEvent?: boolean;
  bw?: boolean;
  bwWholePrint?: boolean;
  mirror?: boolean;
  logoBgOverride?: string | null;
  /** Decoded images for `image` layers, keyed by their `src`. */
  layerImages?: Record<string, CanvasImageSource>;
}

/** Renders one print. Scale 1 = 300 dpi template pixels. Waits for the bundled fonts first. */
export async function renderTemplate(req: RenderRequest, scale = 1): Promise<HTMLCanvasElement> {
  await ensureFonts();
  const t = req.template;
  const tw = templateWidth(t),
    th = templateHeight(t);
  const w = Math.max(1, Math.round(tw * scale));
  const h = Math.max(1, Math.round(th * scale));
  const canvas = createCanvas(w, h);
  const ctx = context2d(canvas);
  ctx.save();
  ctx.scale(w / tw, h / th);
  paint(ctx, req);
  ctx.restore();
  if (req.bw && req.bwWholePrint) applyMatrix(ctx, w, h, trueBwMatrix());
  return canvas;
}

/** Two 2×6 strips side by side on one 4×6 sheet (1200×1800); the DNP 2-inch cut separates them. */
export function stripSheet(strip: HTMLCanvasElement): HTMLCanvasElement {
  const sheet = createCanvas(1200, 1800);
  const ctx = context2d(sheet);
  ctx.drawImage(strip, 0, 0, strip.width, strip.height, 0, 0, 600, 1800);
  ctx.drawImage(strip, 0, 0, strip.width, strip.height, 600, 0, 600, 1800);
  return sheet;
}

/**
 * Loads every image referenced by `image` layers of [t]. [resolve] maps a layer `src`
 * (e.g. a path relative to the pack folder, or `asset:…`) to a URL, or null to skip it.
 * A missing decoration image is skipped rather than failing the print.
 */
export async function loadLayerImages(
  t: TemplateDef,
  resolve: (src: string) => Promise<string | null>,
): Promise<Record<string, HTMLImageElement>> {
  const srcs = new Set<string>();
  for (const l of t.layers ?? []) {
    if (l.type === 'image' && typeof l.src === 'string') srcs.add(l.src);
  }
  const out: Record<string, HTMLImageElement> = {};
  await Promise.all(
    [...srcs].map(async (src) => {
      try {
        const url = await resolve(src);
        if (!url) return;
        out[src] = await loadImage(url);
      } catch {
        // Skipped: the print still renders without this decoration.
      }
    }),
  );
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // keeps the print canvas exportable
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${url}`));
    img.src = url;
  });
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode print image'))),
      type,
      quality,
    );
  });
}

// ---------------------------------------------------------------------------

function paint(ctx: Ctx, r: RenderRequest): void {
  const t = r.template;
  const env: LayerEnv = {
    width: templateWidth(t),
    height: templateHeight(t),
    eventName: r.eventName ?? '',
    eventDate: r.eventDate ?? '',
    layerImages: r.layerImages ?? {},
  };
  fillSpec(ctx, { x: 0, y: 0, w: env.width, h: env.height }, t.background ?? { color: '#FFFFFF' });
  const layers = t.layers ?? [];
  for (const l of layers) if (l.z !== 'above') layer(ctx, l, env);
  const filter = photoMatrix(t.filter ?? 'none', !!r.bw && !r.bwWholePrint);
  const photos = r.photos ?? [];
  t.slots.forEach((s, i) => slot(ctx, s, photos[i] ?? null, i, !!r.mirror, filter));
  for (const l of layers) if (l.z === 'above') layer(ctx, l, env);
  logoStrip(ctx, r);
}

/** One decoration layer; `opacity` < 1 composites it as a group, like Flutter's saveLayer. */
function layer(ctx: Ctx, l: Record<string, unknown>, env: LayerEnv): void {
  const opacity = Math.min(1, Math.max(0, typeof l.opacity === 'number' ? l.opacity : 1));
  if (opacity >= 1) {
    drawLayer(ctx, l, env);
    return;
  }
  if (opacity <= 0) return;
  const off = createCanvas(ctx.canvas.width, ctx.canvas.height);
  const octx = context2d(off);
  octx.setTransform(ctx.getTransform());
  drawLayer(octx, l, env);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

// ---- photo slots ------------------------------------------------------------

function slot(ctx: Ctx, s: SlotDef, photo: CanvasImageSource | null, index: number, mirror: boolean, filter: number[] | null): void {
  const rect: Rect = { x: s.x, y: s.y, w: s.w, h: s.h };
  const radius = s.radius ?? 0;
  const bw = s.borderWidth ?? 0;
  const cx = rect.x + rect.w / 2,
    cy = rect.y + rect.h / 2;
  ctx.save();
  rotateAbout(ctx, cx, cy, s.rotation ?? 0);
  // RRect.inflate grows the corner radius too.
  const outer = (dx: number, dy: number): void => {
    ctx.beginPath();
    rrectPath(ctx, rect.x - bw + dx, rect.y - bw + dy, rect.w + bw * 2, rect.h + bw * 2, Math.max(0, radius + bw));
  };
  if (s.shadow) {
    shadowOnly(ctx, 'rgba(0,0,0,0.3333)', 14 * deviceScale(ctx), 0, 0, () => {
      outer(8, 12);
      ctx.fill();
    });
  }
  if (bw > 0) {
    ctx.fillStyle = cssHex(s.borderColor ?? '#FFFFFF');
    outer(0, 0);
    ctx.fill();
  }
  ctx.beginPath();
  rrectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.clip();

  const size = photo ? sourceSize(photo) : null;
  const usable = photo !== null && size !== null && size[0] > 0 && size[1] > 0;
  if (usable && filter === null) {
    const [sx, sy, sw, sh] = coverSource(size[0], size[1], rect.w / rect.h);
    if (mirror) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
    }
    drawImageHQ(ctx, photo, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
  } else if (rect.w > 0 && rect.h > 0) {
    // Filtered photo or placeholder: draw at device resolution, apply the matrix, composite.
    const k = deviceScale(ctx);
    const dw = Math.max(1, Math.round(rect.w * k)),
      dh = Math.max(1, Math.round(rect.h * k));
    const off = createCanvas(dw, dh);
    const octx = context2d(off, true);
    if (usable) {
      const [sx, sy, sw, sh] = coverSource(size[0], size[1], rect.w / rect.h);
      if (mirror) {
        octx.translate(dw, 0);
        octx.scale(-1, 1);
      }
      drawImageHQ(octx, photo, sx, sy, sw, sh, 0, 0, dw, dh);
    } else {
      octx.setTransform(dw / rect.w, 0, 0, dh / rect.h, (-rect.x * dw) / rect.w, (-rect.y * dh) / rect.h);
      placeholder(octx, rect, index);
    }
    if (filter) applyMatrix(octx, dw, dh, filter);
    drawImageHQ(ctx, off, 0, 0, dw, dh, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

function coverSource(iw: number, ih: number, targetAspect: number): [number, number, number, number] {
  const imgAspect = iw / ih;
  if (imgAspect > targetAspect) {
    const w = ih * targetAspect;
    return [(iw - w) / 2, 0, w, ih];
  }
  const h = iw / targetAspect;
  return [0, (ih - h) / 2, iw, h];
}

const PLACEHOLDER_HUES: [string, string][] = [
  ['#7FD3F7', '#3C6FD8'],
  ['#F7B37F', '#D8513C'],
  ['#B59CF7', '#6A3CD8'],
  ['#9CF7C4', '#2E9E6A'],
];

/** A friendly silhouette used in thumbnails and sample prints. */
function placeholder(ctx: Ctx, rect: Rect, index: number): void {
  const [a, b] = PLACEHOLDER_HUES[index % PLACEHOLDER_HUES.length];
  const g = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const unit = Math.min(rect.w, rect.h);
  const cx = rect.x + rect.w / 2;
  const headR = unit * 0.17;
  const headY = rect.y + rect.h * 0.5 - headR * 0.6;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  const sw = unit * 0.68,
    sh = headR * 3.2;
  const scy = headY + headR * 2.9;
  ctx.beginPath();
  rrectPath(ctx, cx - sw / 2, scy - sh / 2, sw, sh, headR * 1.4);
  ctx.fill();
}

// ---- brand logo strip ---------------------------------------------------------

function contrastOn(hex: string): string {
  return luminance(parseColor(hex)) > 0.5 ? '#111111' : '#FFFFFF';
}

function logoStrip(ctx: Ctx, r: RenderRequest): void {
  const a = r.template.logo;
  const rect: Rect = { x: a.x, y: a.y, w: a.w, h: a.h };
  if (rect.w <= 0 || rect.h <= 0) return;
  const override = r.logoBgOverride ?? null;
  const bg = override ?? a.bg ?? null;
  if (bg !== null) {
    ctx.fillStyle = cssHex(bg);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  const textColour = override !== null ? cssHex(contrastOn(override)) : cssHex(a.textColor ?? '#FFFFFF');
  const lightBg = bg !== null && luminance(parseColor(bg)) > 0.5;
  const useBadge = lightBg && !!r.logoOnLight;

  const showEvent = r.showEvent ?? true;
  const name = showEvent ? (r.eventName ?? '').trim() : '';
  const date = showEvent ? (r.eventDate ?? '').trim() : '';
  const hasText = name.length > 0 || date.length > 0;
  const logo = (useBadge ? r.logoOnLight : r.logo) ?? null;
  const logoSize = logo ? sourceSize(logo) : null;
  const hasLogo = logo !== null && logoSize !== null && logoSize[0] > 0 && logoSize[1] > 0;
  const pad = rect.h * 0.14;
  const horizontal = rect.w / rect.h >= 3.2;
  const align: Align = horizontal ? 'left' : 'center';
  const family = a.font ?? 'Poppins';
  const cx = rect.x + rect.w / 2,
    cy = rect.y + rect.h / 2;

  const para = (s: string, size: number, weight: number, maxW: number): TextLayout =>
    layoutText(ctx, s, { family, size, weight, italic: false, letterSpacing: 0, lineHeight: null }, maxW, 1);
  const drawPara = (p: TextLayout, x: number, y: number): void => {
    ctx.fillStyle = textColour;
    drawLayout(ctx, p, x, y, align, 'fill');
  };

  if (horizontal) {
    const innerH = rect.h - pad * 2;
    let lw = 0,
      lh = 0;
    if (hasLogo) {
      lh = innerH;
      lw = (logoSize[0] / logoSize[1]) * lh;
      const maxW = rect.w * (hasText ? 0.5 : 0.85);
      if (lw > maxW) {
        lw = maxW;
        lh = (lw * logoSize[1]) / logoSize[0];
      }
    }
    const maxTextW = rect.w - lw - pad * (hasLogo ? 3 : 2);
    const p1 = name ? para(name, innerH * 0.34, 700, maxTextW) : null;
    const p2 = date ? para(date, innerH * 0.24, 500, maxTextW) : null;
    const textW = Math.max(p1?.longestLine ?? 0, p2?.longestLine ?? 0);
    const gapW = hasLogo && hasText ? pad : 0;
    const total = lw + gapW + textW;
    let x = rect.x + (rect.w - total) / 2;
    if (hasLogo) {
      drawImageFit(ctx, logo, { x, y: cy - lh / 2, w: lw, h: lh }, useBadge);
      x += lw + gapW;
    }
    const textH = (p1?.height ?? 0) + (p2?.height ?? 0);
    let ty = cy - textH / 2;
    if (p1) {
      drawPara(p1, x, ty);
      ty += p1.height;
    }
    if (p2) drawPara(p2, x, ty);
  } else {
    const innerW = rect.w - pad * 2;
    const innerH = rect.h - pad * 2;
    const logoH = hasText ? innerH * 0.62 : innerH;
    const lineText = [name, date].filter((s) => s.length > 0).join(' · ');
    const p1 = lineText ? para(lineText, innerH * 0.2, 600, innerW) : null;
    const totalH = (hasLogo ? logoH : 0) + (p1 ? p1.height + pad * 0.3 : 0);
    let y = cy - totalH / 2;
    if (hasLogo) {
      let lh = logoH;
      let lw = (logoSize[0] / logoSize[1]) * lh;
      if (lw > innerW) {
        lw = innerW;
        lh = (lw * logoSize[1]) / logoSize[0];
      }
      drawImageFit(ctx, logo, { x: cx - lw / 2, y: y + (logoH - lh) / 2, w: lw, h: lh }, useBadge);
      y += logoH + pad * 0.3;
    }
    if (p1) drawPara(p1, rect.x + pad, y);
  }
}

function drawImageFit(ctx: Ctx, img: CanvasImageSource, dst: Rect, badge: boolean): void {
  ctx.save();
  if (badge) {
    ctx.beginPath();
    rrectPath(ctx, dst.x, dst.y, dst.w, dst.h, Math.min(dst.w, dst.h) * 0.18);
    ctx.clip();
  }
  const [iw, ih] = sourceSize(img);
  drawImageHQ(ctx, img, 0, 0, iw, ih, dst.x, dst.y, dst.w, dst.h);
  ctx.restore();
}
