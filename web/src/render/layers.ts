/** Decoration layers, ported 1:1 from TemplateRenderer in template_renderer.dart. */
import {
  blurredFill,
  clamp,
  colorsOf,
  deviceScale,
  drawImageHQ,
  isMap,
  linearGradient,
  num,
  paintFor,
  rotateAbout,
  rrectPath,
  setStroke,
  shadowOnly,
  sourceSize,
  str,
  type Ctx,
  type Json,
  type Rect,
} from './canvas';
import { css, parseColor, withAlpha } from './color';
import { cssWeight, drawLayout, layoutText, type Align, type FontSpec, type TextLayout } from './text';

/** What layers need from the render request. */
export interface LayerEnv {
  width: number;
  height: number;
  eventName: string;
  eventDate: string;
  layerImages: Record<string, CanvasImageSource>;
}

export function drawLayer(ctx: Ctx, l: Json, env: LayerEnv): void {
  ctx.save();
  switch (l.type) {
    case 'rect':
      rect(ctx, l);
      break;
    case 'circle':
      circle(ctx, l);
      break;
    case 'arcs':
      arcs(ctx, l);
      break;
    case 'text':
      text(ctx, l, env);
      break;
    case 'grid':
      grid(ctx, l);
      break;
    case 'dots':
      dots(ctx, l);
      break;
    case 'stripes':
      stripes(ctx, l);
      break;
    case 'rays':
      rays(ctx, l);
      break;
    case 'starburst':
      starburst(ctx, l);
      break;
    case 'sprockets':
      sprockets(ctx, l);
      break;
    case 'line':
      line(ctx, l);
      break;
    case 'lines':
      fauxText(ctx, l);
      break;
    case 'polygon':
      polygon(ctx, l);
      break;
    case 'sun':
      sun(ctx, l);
      break;
    case 'image':
      image(ctx, l, env);
      break;
  }
  ctx.restore();
}

/** Fills a rect (or rounded rect) with a `color`/`gradient` spec. */
export function fillSpec(ctx: Ctx, r: Rect, spec: Json, radius = 0): void {
  const style = paintFor(ctx, spec, r);
  if (style === null) return;
  ctx.fillStyle = style;
  ctx.beginPath();
  if (radius > 0) rrectPath(ctx, r.x, r.y, r.w, r.h, radius);
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill();
}

function rectOf(l: Json): Rect {
  return { x: num(l.x), y: num(l.y), w: num(l.w), h: num(l.h) };
}

/** MaskFilter.blur sigma (template units) → device px, as Skia respects the CTM. */
function sigmaDev(ctx: Ctx, sigma: number): number {
  return sigma * deviceScale(ctx);
}

// ---- primitives -----------------------------------------------------------

function rect(ctx: Ctx, l: Json): void {
  const r = rectOf(l);
  const radius = num(l.radius);
  rotateAbout(ctx, r.x + r.w / 2, r.y + r.h / 2, num(l.rotation));
  const shadow = l.shadow;
  if (isMap(shadow)) {
    const color = css(parseColor(str(shadow.color, '#66000000')));
    const dx = num(shadow.dx, 6),
      dy = num(shadow.dy, 10);
    shadowOnly(ctx, color, sigmaDev(ctx, num(shadow.blur, 12)), 0, 0, () => {
      ctx.beginPath();
      rrectPath(ctx, r.x + dx, r.y + dy, r.w, r.h, radius);
      ctx.fill();
    });
  }
  fillSpec(ctx, r, l, radius);
  if (setStroke(ctx, l.stroke)) {
    const glow = num(l.glow);
    const path = (): void => {
      ctx.beginPath();
      rrectPath(ctx, r.x, r.y, r.w, r.h, radius);
    };
    if (glow > 0) {
      const color = ctx.strokeStyle as string;
      const width = ctx.lineWidth;
      shadowOnly(ctx, color, sigmaDev(ctx, glow), 0, 0, () => {
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        path();
        ctx.stroke();
      });
    }
    path();
    ctx.stroke();
  }
}

function circle(ctx: Ctx, l: Json): void {
  const cx = num(l.cx),
    cy = num(l.cy),
    r = num(l.r);
  const path = (): void => ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
  const style = paintFor(ctx, l, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
  if (style !== null) {
    const glow = num(l.glow);
    if (glow > 0) {
      // Flutter puts the blur on the fill paint itself: the disc is drawn soft only.
      const first = colorsOf(isMap(l.gradient) ? l.gradient.colors : null)[0];
      blurredFill(ctx, style, first ? css(first) : '#000', sigmaDev(ctx, glow), path);
    } else {
      ctx.fillStyle = style;
      ctx.beginPath();
      path();
      ctx.fill();
    }
  }
  if (setStroke(ctx, l.stroke)) {
    ctx.beginPath();
    path();
    ctx.stroke();
  }
}

/** Concentric rainbow bands, outermost first. */
function arcs(ctx: Ctx, l: Json): void {
  const cx = num(l.cx),
    cy = num(l.cy);
  const outer = num(l.r);
  const band = num(l.band, 40);
  const gap = num(l.gap, 0);
  const start = (num(l.start, 180) * Math.PI) / 180;
  const sweep = (num(l.sweep, 180) * Math.PI) / 180;
  const colors = colorsOf(l.colors);
  ctx.lineWidth = band;
  ctx.lineCap = 'butt';
  for (let i = 0; i < colors.length; i++) {
    const radius = outer - i * (band + gap) - band / 2;
    if (radius <= 0) break;
    ctx.strokeStyle = css(colors[i]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep, sweep < 0);
    ctx.stroke();
  }
}

function grid(ctx: Ctx, l: Json): void {
  const r = rectOf(l);
  const cols = Math.trunc(num(l.cols, 12));
  const rows = Math.trunc(num(l.rows, 8));
  const perspective = l.perspective !== false;
  const colour = parseColor(str(l.color, '#FF2BD6'));
  const width = num(l.width, 3);
  const glow = num(l.glow, 0);
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const path = (): void => {
    ctx.beginPath();
    for (let i = 0; i <= rows; i++) {
      const f = i / rows;
      const y = r.y + r.h * (perspective ? f * f : f);
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    const cx = r.x + r.w / 2;
    for (let i = 0; i <= cols; i++) {
      const xb = r.x - r.w * 0.75 + (r.w * 2.5 * i) / cols;
      const xt = perspective ? cx + (xb - cx) * 0.18 : xb;
      ctx.moveTo(xt, r.y);
      ctx.lineTo(xb, r.y + r.h);
    }
  };
  ctx.lineCap = 'butt';
  if (glow > 0) {
    shadowOnly(ctx, css(withAlpha(colour, 0.8)), sigmaDev(ctx, glow), 0, 0, () => {
      ctx.lineWidth = width * 3;
      path();
      ctx.stroke();
    });
  }
  ctx.strokeStyle = css(colour);
  ctx.lineWidth = width;
  path();
  ctx.stroke();
}

/** Halftone dots that grow towards one edge. */
function dots(ctx: Ctx, l: Json): void {
  const r = rectOf(l);
  const spacing = Math.max(4, num(l.spacing, 24));
  const rMax = num(l.rMax, spacing * 0.45);
  const rMin = num(l.rMin, 1);
  const dir = str(l.direction, 'none');
  ctx.fillStyle = css(parseColor(str(l.color, '#33000000')));
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  const shortest = Math.min(Math.abs(r.w), Math.abs(r.h));
  const longest = Math.max(Math.abs(r.w), Math.abs(r.h));
  // Neighbouring dots are `spacing` apart; when they cannot overlap, one path is identical
  // to drawing each circle on its own (and much faster).
  const batch = 2 * Math.max(rMin, rMax) <= spacing;
  if (batch) ctx.beginPath();
  let row = 0;
  for (let y = r.y; y <= r.y + r.h + spacing; y += spacing * 0.866, row++) {
    const offset = row % 2 === 1 ? spacing / 2 : 0;
    for (let x = r.x - spacing + offset; x <= r.x + r.w + spacing; x += spacing) {
      let f: number;
      switch (dir) {
        case 'down':
          f = (y - r.y) / r.h;
          break;
        case 'up':
          f = 1 - (y - r.y) / r.h;
          break;
        case 'radial':
          f = 1 - clamp(Math.hypot(x - cx, y - cy) / (shortest * 0.75), 0, 1);
          break;
        case 'edges':
          f = clamp(Math.hypot(x - cx, y - cy) / (longest * 0.6), 0, 1);
          break;
        default:
          f = 1;
      }
      const rad = rMin + (rMax - rMin) * clamp(f, 0, 1);
      if (rad > 0.3) {
        if (!batch) ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        if (!batch) ctx.fill();
      }
    }
  }
  if (batch) ctx.fill();
}

function stripes(ctx: Ctx, l: Json): void {
  const r = rectOf(l);
  const colors = colorsOf(l.colors);
  if (colors.length === 0) return;
  const width = Math.max(2, num(l.width, 40));
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  rotateAbout(ctx, cx, cy, num(l.angle));
  const reach = Math.max(Math.abs(r.w), Math.abs(r.h)) * 1.5;
  let i = 0;
  for (let x = cx - reach; x < cx + reach; x += width, i++) {
    ctx.fillStyle = css(colors[i % colors.length]);
    ctx.fillRect(x, cy - reach, width + 0.5, reach * 2);
  }
}

/** Sunburst wedges around a centre (poster and comic backgrounds). */
function rays(ctx: Ctx, l: Json): void {
  const cx = num(l.cx),
    cy = num(l.cy);
  const count = Math.max(4, Math.trunc(num(l.count, 24)));
  const r = num(l.r, 3000);
  const colors = colorsOf(l.colors);
  if (colors.length === 0) return;
  const clip = l.clip;
  if (isMap(clip)) {
    ctx.beginPath();
    ctx.rect(num(clip.x), num(clip.y), num(clip.w), num(clip.h));
    ctx.clip();
  }
  const step = (2 * Math.PI) / count;
  const rot = (num(l.rotation) * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const a0 = rot + i * step,
      a1 = a0 + step;
    ctx.fillStyle = css(colors[i % colors.length]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
    ctx.lineTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
    ctx.closePath();
    ctx.fill();
  }
}

function polyPath(ctx: Ctx, pts: [number, number][], dx = 0, dy = 0): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + dx, y + dy) : ctx.lineTo(x + dx, y + dy)));
  ctx.closePath();
}

function boundsOf(pts: [number, number][]): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Comic-style "POW!" burst with irregular points. */
function starburst(ctx: Ctx, l: Json): void {
  const cx = num(l.cx),
    cy = num(l.cy);
  const points = Math.max(5, Math.trunc(num(l.points, 14)));
  const ro = num(l.rOuter, 200);
  const ri = num(l.rInner, 130);
  const jitter = num(l.jitter, 0.18);
  const rot = (num(l.rotation) * Math.PI) / 180;
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const outer = i % 2 === 0;
    // Deterministic irregularity so every print looks identical.
    const wobble = 1 + jitter * Math.sin(i * 2.399963) * (outer ? 1 : 0.4);
    const radius = (outer ? ro : ri) * wobble;
    const a = rot + (i * Math.PI) / points;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  const shadow = l.shadow;
  if (isMap(shadow)) {
    ctx.fillStyle = css(parseColor(str(shadow.color, '#000000')));
    polyPath(ctx, pts, num(shadow.dx, 10), num(shadow.dy, 10));
    ctx.fill();
  }
  const fill = paintFor(ctx, l, boundsOf(pts));
  if (fill !== null) {
    ctx.fillStyle = fill;
    polyPath(ctx, pts);
    ctx.fill();
  }
  if (setStroke(ctx, l.stroke)) {
    polyPath(ctx, pts);
    ctx.stroke();
  }
}

/** A column of film sprocket holes. */
function sprockets(ctx: Ctx, l: Json): void {
  const r = rectOf(l);
  const hw = num(l.holeW, r.w * 0.55);
  const hh = num(l.holeH, hw * 0.75);
  const gap = num(l.gap, hh * 0.9);
  const radius = num(l.radius, 6);
  if (hh + gap <= 0) return;
  ctx.fillStyle = css(parseColor(str(l.color, '#F2EBDD')));
  ctx.beginPath();
  for (let y = r.y + gap / 2; y + hh <= r.y + r.h; y += hh + gap) {
    rrectPath(ctx, r.x + r.w / 2 - hw / 2, y, hw, hh, radius);
  }
  ctx.fill();
}

function line(ctx: Ctx, l: Json): void {
  const color = css(parseColor(str(l.color, '#000000')));
  const width = num(l.width, 3);
  const ax = num(l.x1),
    ay = num(l.y1),
    bx = num(l.x2),
    by = num(l.y2);
  const dash = l.dash;
  const path = (): void => {
    ctx.beginPath();
    if (Array.isArray(dash) && dash.length === 2) {
      const on = num(dash[0], 10),
        off = num(dash[1], 10);
      const total = Math.hypot(bx - ax, by - ay);
      if (total <= 0 || on + off <= 0) return;
      const ux = (bx - ax) / total,
        uy = (by - ay) / total;
      for (let t = 0; t < total; t += on + off) {
        const e = Math.min(total, t + on);
        ctx.moveTo(ax + ux * t, ay + uy * t);
        ctx.lineTo(ax + ux * e, ay + uy * e);
      }
    } else {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
  };
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  const glow = num(l.glow);
  if (glow > 0) {
    // As in Flutter, a glowing line is drawn blurred only.
    shadowOnly(ctx, color, sigmaDev(ctx, glow), 0, 0, () => {
      ctx.lineCap = 'round';
      ctx.lineWidth = width;
      path();
      ctx.stroke();
    });
    return;
  }
  ctx.strokeStyle = color;
  path();
  ctx.stroke();
}

/** Faux newspaper body text: rows of thin bars in columns. */
function fauxText(ctx: Ctx, l: Json): void {
  const r = rectOf(l);
  const columns = Math.max(1, Math.trunc(num(l.columns, 2)));
  const gutter = num(l.gutter, 24);
  const lineH = Math.max(4, num(l.lineHeight, 18));
  const thick = num(l.thickness, 6);
  ctx.fillStyle = css(parseColor(str(l.color, '#55000000')));
  const colW = (r.w - gutter * (columns - 1)) / columns;
  ctx.beginPath();
  for (let col = 0; col < columns; col++) {
    const x = r.x + col * (colW + gutter);
    let i = 0;
    for (let y = r.y; y + thick <= r.y + r.h; y += lineH, i++) {
      // Paragraph rhythm: every 7th line is short, every 8th is blank.
      if (i % 8 === 7) continue;
      const len = i % 8 === 6 ? colW * (0.35 + 0.1 * (col % 3)) : colW;
      rrectPath(ctx, x, y, len, thick, thick / 2);
    }
  }
  ctx.fill();
}

function polygon(ctx: Ctx, l: Json): void {
  const raw = Array.isArray(l.points) ? l.points : [];
  const pts = raw
    .filter((e): e is unknown[] => Array.isArray(e) && e.length === 2)
    .map((e): [number, number] => [num(e[0]), num(e[1])]);
  if (pts.length < 3) return;
  const fill = paintFor(ctx, l, boundsOf(pts));
  if (fill !== null) {
    ctx.fillStyle = fill;
    polyPath(ctx, pts);
    ctx.fill();
  }
  if (setStroke(ctx, l.stroke)) {
    polyPath(ctx, pts);
    ctx.stroke();
  }
}

/** Synthwave sun: gradient disc with horizontal cut bands in its lower half. */
function sun(ctx: Ctx, l: Json): void {
  const cx = num(l.cx),
    cy = num(l.cy);
  const r = Math.max(0, num(l.r, 300));
  const colors = colorsOf(l.colors);
  const glow = num(l.glow, 0);
  if (glow > 0 && colors.length > 0) {
    shadowOnly(ctx, css(withAlpha(colors[0], 0.55)), sigmaDev(ctx, glow), 0, 0, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.fillStyle =
    colors.length >= 2 ? linearGradient(ctx, cx, cy - r, cx, cy + r, colors) : colors.length === 0 ? '#FFB000' : css(colors[0]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const bands = Math.trunc(num(l.bands, 6));
  if (bands <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = css(parseColor(str(l.bandColor, '#1A0B3D')));
  for (let i = 0; i < bands; i++) {
    const f = i / bands;
    const y = cy + r * (0.1 + 0.9 * f);
    const hgt = r * (0.03 + 0.07 * f);
    ctx.fillRect(cx - r, y, r * 2, hgt);
  }
}

function image(ctx: Ctx, l: Json, env: LayerEnv): void {
  const src = l.src;
  if (typeof src !== 'string') return;
  const img = env.layerImages[src];
  if (!img) return;
  const [iw, ih] = sourceSize(img);
  if (iw <= 0 || ih <= 0) return;
  const dst: Rect = { x: num(l.x), y: num(l.y), w: num(l.w, env.width), h: num(l.h, env.height) };
  if (dst.w <= 0 || dst.h <= 0) return;
  let sx = 0,
    sy = 0,
    sw = iw,
    sh = ih;
  let d: Rect = dst;
  if (l.fit === 'cover') {
    const k = Math.min(iw / dst.w, ih / dst.h);
    sw = dst.w * k;
    sh = dst.h * k;
    sx = (iw - sw) / 2;
    sy = (ih - sh) / 2;
  } else if (l.fit === 'contain') {
    const k = Math.min(dst.w / iw, dst.h / ih);
    const w = iw * k,
      h = ih * k;
    d = { x: dst.x + (dst.w - w) / 2, y: dst.y + (dst.h - h) / 2, w, h };
  }
  ctx.beginPath();
  ctx.rect(dst.x, dst.y, dst.w, dst.h);
  ctx.clip();
  drawImageHQ(ctx, img, sx, sy, sw, sh, d.x, d.y, d.w, d.h);
}

// ---- text -----------------------------------------------------------------

function fillPlaceholders(s: string, env: LayerEnv): string {
  return s
    .split('{event}')
    .join(env.eventName)
    .split('{EVENT}')
    .join(env.eventName.toUpperCase())
    .split('{date}')
    .join(env.eventDate);
}

/** Flutter `Shadow.convertRadiusToSigma`. */
function radiusToSigma(radius: number): number {
  return radius > 0 ? radius * 0.57735 + 0.5 : 0;
}

interface TextShadow {
  color: string;
  /** Device px: SkParagraph's text-shadow blur ignores the canvas transform. */
  sigma: number;
  dx: number;
  dy: number;
}

/**
 * Shrinks [size] by 0.92 steps (down to 35 %) until the text fits [w] in [maxLines] lines.
 */
export function fitText(
  ctx: Ctx,
  textValue: string,
  font: FontSpec,
  w: number,
  maxLines: number,
): TextLayout {
  let size = font.size;
  const minSize = size * 0.35;
  let layout = layoutText(ctx, textValue, font, w, maxLines);
  while ((layout.didExceedMaxLines || layout.longestLine > w + 0.5) && size > minSize) {
    size *= 0.92;
    layout = layoutText(ctx, textValue, { ...font, size }, w, maxLines);
  }
  return layout;
}

function text(ctx: Ctx, l: Json, env: LayerEnv): void {
  let value = fillPlaceholders(str(l.text, ''), env);
  if (value.trim().length === 0) {
    const fallback = l.fallback;
    if (typeof fallback !== 'string' || fallback.length === 0) return;
    value = fillPlaceholders(fallback, env);
  }
  if (l.uppercase === true) value = value.toUpperCase();
  const x = num(l.x),
    y = num(l.y),
    w = num(l.w, env.width);
  const boxH = typeof l.h === 'number' ? l.h : null;
  const align: Align = l.align === 'left' ? 'left' : l.align === 'right' ? 'right' : 'center';
  const colour = css(parseColor(str(l.color, '#000000')));
  const maxLines = Math.max(1, Math.trunc(num(l.maxLines, 1)));
  const shadows: TextShadow[] = [];
  const glow = l.glow;
  if (isMap(glow)) {
    const gc = css(parseColor(str(glow.color, '#FF2BD6')));
    const blur = num(glow.blur, 18);
    shadows.push({ color: gc, sigma: radiusToSigma(blur), dx: 0, dy: 0 });
    shadows.push({ color: gc, sigma: radiusToSigma(blur * 2), dx: 0, dy: 0 });
  }
  const sh = l.shadow;
  if (isMap(sh)) {
    shadows.push({
      color: css(parseColor(str(sh.color, '#88000000'))),
      sigma: radiusToSigma(num(sh.blur, 0)),
      dx: num(sh.dx, 4),
      dy: num(sh.dy, 4),
    });
  }

  const font: FontSpec = {
    family: str(l.font, 'Poppins'),
    size: num(l.size, 60),
    weight: cssWeight(l.weight),
    italic: l.italic === true,
    letterSpacing: num(l.letterSpacing),
    lineHeight: typeof l.lineHeight === 'number' ? l.lineHeight : null,
  };
  const layout = fitText(ctx, value, font, w, maxLines);
  const dy = boxH !== null ? y + (boxH - layout.height) / 2 : y;
  rotateAbout(ctx, x + w / 2, dy + layout.height / 2, num(l.rotation));

  // Shadows sit under everything (they come from the stroked paragraph when there is a stroke).
  for (const s of shadows) {
    shadowOnly(ctx, s.color, s.sigma, s.dx, s.dy, () => drawLayout(ctx, layout, x, dy, align, 'fill'));
  }
  const stroke = l.stroke;
  if (isMap(stroke)) {
    ctx.lineWidth = num(stroke.width, 6);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = css(parseColor(str(stroke.color, '#000000')));
    drawLayout(ctx, layout, x, dy, align, 'stroke');
  }
  ctx.fillStyle = colour;
  drawLayout(ctx, layout, x, dy, align, 'fill');
}
