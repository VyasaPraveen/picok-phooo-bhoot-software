/** Low-level Canvas 2D helpers shared by the renderer (internal). */
import { css, parseColor, type Rgba } from './color';

export type Ctx = CanvasRenderingContext2D;
export type Json = Record<string, unknown>;
export type Style = string | CanvasGradient;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isMap(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Dart `_d`: a number, or the fallback. */
export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

export function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function context2d(c: HTMLCanvasElement, willReadFrequently = false): Ctx {
  const ctx = c.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Uniform scale of the current transform (device px per template px). */
export function deviceScale(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

export function rotateAbout(ctx: Ctx, cx: number, cy: number, degrees: number): void {
  if (degrees === 0) return;
  ctx.translate(cx, cy);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.translate(-cx, -cy);
}

/** Adds a rounded rectangle (Skia-style clamped radius) to the current path. */
export function rrectPath(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number): void {
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const r = Math.min(Math.max(0, radius), w / 2, h / 2);
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

export function colorsOf(v: unknown): Rgba[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').map(parseColor) : [];
}

export function evenStops(n: number): number[] {
  if (n <= 1) return [0];
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

function rel(v: unknown, b: Rect, fx: number, fy: number): [number, number] {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    return [b.x + v[0] * b.w, b.y + v[1] * b.h];
  }
  return [b.x + fx * b.w, b.y + fy * b.h];
}

function addStops(g: CanvasGradient, colors: Rgba[], stops: number[]): CanvasGradient {
  for (let i = 0; i < colors.length; i++) {
    const s = stops[i];
    g.addColorStop(Number.isFinite(s) ? clamp(s, 0, 1) : 0, css(colors[i]));
  }
  return g;
}

/** A gradient from explicit colours (evenly spaced), from top-centre to bottom-centre etc. */
export function linearGradient(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, colors: Rgba[]): CanvasGradient {
  return addStops(ctx.createLinearGradient(x0, y0, x1, y1), colors, evenStops(colors.length));
}

/** A fill style from `color` or `gradient` keys (gradient wins when it has ≥ 2 colours). */
export function paintFor(ctx: Ctx, spec: Json, bounds: Rect): Style | null {
  const g = spec.gradient;
  if (isMap(g)) {
    const colors = colorsOf(g.colors);
    if (colors.length >= 2) {
      const raw = Array.isArray(g.stops) ? g.stops.filter((e): e is number => typeof e === 'number') : null;
      const stops = raw && raw.length === colors.length ? raw : evenStops(colors.length);
      if (g.type === 'radial') {
        const [cx, cy] = rel(g.center, bounds, 0.5, 0.5);
        const r = Math.max(0, num(g.radius, 0.5) * Math.max(bounds.w, bounds.h));
        return addStops(ctx.createRadialGradient(cx, cy, 0, cx, cy, r), colors, stops);
      }
      const [x0, y0] = rel(g.begin, bounds, 0.5, 0);
      const [x1, y1] = rel(g.end, bounds, 0.5, 1);
      return addStops(ctx.createLinearGradient(x0, y0, x1, y1), colors, stops);
    }
  }
  const col = spec.color;
  if (typeof col === 'string') return css(parseColor(col));
  return null;
}

/** Applies a `stroke {color,width}` spec to the context. Returns false when there is none. */
export function setStroke(ctx: Ctx, spec: unknown): boolean {
  if (!isMap(spec)) return false;
  ctx.lineWidth = num(spec.width, 4);
  ctx.strokeStyle = css(parseColor(str(spec.color, '#000000')));
  ctx.lineJoin = 'round';
  return true;
}

// Distance (device px) the real geometry is pushed off-canvas so only its shadow lands.
function farOffset(ctx: Ctx): number {
  return 20000 + 4 * Math.max(ctx.canvas.width, ctx.canvas.height);
}

/**
 * Draws only the blurred "shadow" of the geometry produced by [draw] — the Canvas 2D
 * equivalent of a Flutter paint with `MaskFilter.blur` (or a text `Shadow`).
 * [sigmaDevice] is the Gaussian sigma in device pixels; ([dx], [dy]) is an offset in the
 * current user space. [draw] must fill/stroke with fully opaque styles (it gets black).
 */
export function shadowOnly(
  ctx: Ctx,
  color: string,
  sigmaDevice: number,
  dx: number,
  dy: number,
  draw: () => void,
): void {
  const m = ctx.getTransform();
  const far = farOffset(ctx);
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e - far, m.f);
  ctx.shadowColor = color;
  ctx.shadowBlur = sigmaDevice > 0 ? sigmaDevice * 2 : 0;
  ctx.shadowOffsetX = far + m.a * dx + m.c * dy;
  ctx.shadowOffsetY = m.b * dx + m.d * dy;
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  draw();
  ctx.restore();
}

const FILTER_SUPPORTED = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

/**
 * Fills the path produced by [path] with [style] blurred by [sigmaDevice] and nothing sharp.
 * Gradients use `ctx.filter` where supported; otherwise (or for solid colours) the shadow trick.
 */
export function blurredFill(ctx: Ctx, style: Style, fallbackColor: string, sigmaDevice: number, path: () => void): void {
  if (typeof style !== 'string' && FILTER_SUPPORTED) {
    ctx.save();
    ctx.filter = `blur(${sigmaDevice}px)`;
    ctx.fillStyle = style;
    ctx.beginPath();
    path();
    ctx.fill();
    ctx.restore();
    return;
  }
  shadowOnly(ctx, typeof style === 'string' ? style : fallbackColor, sigmaDevice, 0, 0, () => {
    ctx.beginPath();
    path();
    ctx.fill();
  });
}

/**
 * `drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)` with high-quality downscaling but without
 * the per-draw mipmap build Chrome does for `imageSmoothingQuality` medium/high (~80 ms for a
 * 1920×1440 photo). The source is halved with bilinear steps (an exact 2×2 box filter) until
 * it is less than 2× the device-pixel target, then drawn bilinearly; upscales use 'high'.
 */
export function drawImageHQ(
  ctx: Ctx,
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const k = deviceScale(ctx);
  let factor = Math.min(sw / (Math.abs(dw) * k), sh / (Math.abs(dh) * k));
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if (!(factor >= 2) || !Number.isFinite(factor)) {
    ctx.imageSmoothingQuality = factor >= 1 ? 'low' : 'high';
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  let w = Math.max(1, Math.round(sw / 2)),
    h = Math.max(1, Math.round(sh / 2));
  let cur = createCanvas(w, h);
  let cctx = context2d(cur);
  cctx.imageSmoothingQuality = 'low';
  cctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  factor /= 2;
  while (factor >= 2 && w > 1 && h > 1) {
    const nw = Math.max(1, Math.round(w / 2)),
      nh = Math.max(1, Math.round(h / 2));
    const next = createCanvas(nw, nh);
    cctx = context2d(next);
    cctx.imageSmoothingQuality = 'low';
    cctx.drawImage(cur, 0, 0, w, h, 0, 0, nw, nh);
    cur = next;
    w = nw;
    h = nh;
    factor /= 2;
  }
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(cur, 0, 0, w, h, dx, dy, dw, dh);
  ctx.restore();
}

/** Pixel size of any canvas image source. */
export function sourceSize(s: CanvasImageSource): [number, number] {
  if ('naturalWidth' in s) return [s.naturalWidth, s.naturalHeight]; // HTMLImageElement
  if ('videoWidth' in s) return [s.videoWidth, s.videoHeight]; // HTMLVideoElement
  if ('displayWidth' in s) return [s.displayWidth, s.displayHeight]; // VideoFrame
  if (typeof s.width === 'number' && typeof s.height === 'number') return [s.width, s.height]; // canvas, bitmap
  if (typeof s.width === 'object' && typeof s.height === 'object') {
    return [s.width.baseVal.value, s.height.baseVal.value]; // SVGImageElement
  }
  return [0, 0];
}
