/**
 * Paragraph layout that mirrors Flutter's (SkParagraph) behaviour closely enough for prints:
 * word wrap, maxLines with an ellipsis, letter spacing, line height multiplier and alignment.
 */
import type { Ctx } from './canvas';

export interface FontSpec {
  family: string;
  size: number;
  /** CSS weight 100–900. */
  weight: number;
  italic: boolean;
  letterSpacing: number;
  /** Flutter `TextStyle.height` multiplier, or null for the font's natural line height. */
  lineHeight: number | null;
}

export type Align = 'left' | 'center' | 'right';

export interface TextLine {
  text: string;
  width: number;
}

export interface TextLayout {
  font: FontSpec;
  lines: TextLine[];
  /** Total paragraph height. */
  height: number;
  lineHeight: number;
  /** Baseline offset from the top of each line box. */
  baseline: number;
  longestLine: number;
  didExceedMaxLines: boolean;
  /** The width the paragraph was laid out in (used for alignment). */
  width: number;
}

/**
 * hhea ascender / descender / lineGap (em units) of the bundled fonts — what Skia/FreeType
 * use in Flutter. Browsers may pick OS/2 win metrics on some platforms, so these are fixed
 * here to keep text boxes in the same place as the Flutter booth.
 */
const FONT_METRICS: Record<string, [number, number, number]> = {
  Poppins: [1.05, 0.35, 0.1],
  Shrikhand: [1.026, 0.432, 0],
  Monoton: [2366 / 2048, 822 / 2048, 0],
  Bangers: [0.883, 0.181, 0],
  Rye: [2020 / 2048, 540 / 2048, 0],
  SpecialElite: [1440 / 2048, 608 / 2048, 0],
  UnifrakturMaguntia: [1607 / 2048, 513 / 2048, 0],
  OldStandard: [0.762, 0.238, 0.236],
  Pacifico: [1.303, 0.453, 0],
  BebasNeue: [0.9, 0.3, 0],
};

const NATIVE_LETTER_SPACING =
  typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

/** Flutter `_weight`: rounds to the nearest of w100…w900. */
export function cssWeight(w: unknown): number {
  const v = typeof w === 'number' ? Math.trunc(w) : 400;
  const idx = Math.min(8, Math.max(0, Math.round(v / 100) - 1));
  return (idx + 1) * 100;
}

export function fontString(f: FontSpec): string {
  const family = f.family.replace(/["\\]/g, '');
  return `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px "${family}", sans-serif`;
}

export function applyFont(ctx: Ctx, f: FontSpec): void {
  ctx.font = fontString(f);
  if (NATIVE_LETTER_SPACING) ctx.letterSpacing = `${f.letterSpacing}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

/** Width of [s] in the current font (call [applyFont] first). */
function measure(ctx: Ctx, f: FontSpec, s: string): number {
  if (s.length === 0) return 0;
  if (NATIVE_LETTER_SPACING || f.letterSpacing === 0) return ctx.measureText(s).width;
  let w = 0;
  for (const ch of s) w += ctx.measureText(ch).width + f.letterSpacing;
  return w;
}

function verticalMetrics(ctx: Ctx, f: FontSpec): { ascent: number; descent: number; leading: number } {
  const known = FONT_METRICS[f.family];
  if (known) return { ascent: known[0] * f.size, descent: known[1] * f.size, leading: known[2] * f.size };
  const m = ctx.measureText('Hg');
  const ascent = typeof m.fontBoundingBoxAscent === 'number' ? m.fontBoundingBoxAscent : f.size * 0.9;
  const descent = typeof m.fontBoundingBoxDescent === 'number' ? m.fontBoundingBoxDescent : f.size * 0.25;
  return { ascent, descent, leading: 0 };
}

function dropLastChar(s: string): string {
  const chars = Array.from(s);
  chars.pop();
  return chars.join('');
}

/** Greedy word wrap; words longer than the line are broken by characters. */
export function layoutText(ctx: Ctx, text: string, f: FontSpec, maxWidth: number, maxLines: number): TextLayout {
  applyFont(ctx, f);
  const limit = maxWidth + 0.01;
  const raw: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    let hasCur = false;
    for (const word of para.split(' ')) {
      if (hasCur) {
        const cand = `${cur} ${word}`;
        if (measure(ctx, f, cand) <= limit) {
          cur = cand;
          continue;
        }
        raw.push(cur);
      }
      hasCur = true;
      if (measure(ctx, f, word) <= limit) {
        cur = word;
        continue;
      }
      let piece = '';
      for (const ch of word) {
        const cand = piece + ch;
        if (piece !== '' && measure(ctx, f, cand) > limit) {
          raw.push(piece);
          piece = ch;
        } else {
          piece = cand;
        }
      }
      cur = piece;
    }
    raw.push(cur);
  }

  const exceeded = raw.length > maxLines;
  const kept = exceeded ? raw.slice(0, maxLines) : raw;
  if (exceeded) {
    let last = kept[kept.length - 1].trimEnd();
    while (last.length > 0 && measure(ctx, f, `${last}…`) > limit) last = dropLastChar(last).trimEnd();
    kept[kept.length - 1] = `${last}…`;
  }
  const lines = kept.map((t) => ({ text: t, width: measure(ctx, f, t.trimEnd()) }));

  const vm = verticalMetrics(ctx, f);
  let lineHeight: number;
  let baseline: number;
  if (f.lineHeight !== null) {
    // SkParagraph: the line box is size × height; the font's intrinsic height (ascent +
    // descent + line gap, half the gap on each side) is scaled proportionally into it.
    lineHeight = f.size * f.lineHeight;
    baseline = ((vm.ascent + vm.leading / 2) * lineHeight) / (vm.ascent + vm.descent + vm.leading);
  } else {
    lineHeight = vm.ascent + vm.descent + vm.leading;
    baseline = vm.leading / 2 + vm.ascent;
  }
  return {
    font: f,
    lines,
    height: lineHeight * lines.length,
    lineHeight,
    baseline,
    longestLine: lines.reduce((m, l) => Math.max(m, l.width), 0),
    didExceedMaxLines: exceeded,
    width: maxWidth,
  };
}

/**
 * Draws a laid-out paragraph with its top-left at ([x], [y]) in a box of the layout width.
 * The caller sets fillStyle/strokeStyle (and any shadow state) beforehand.
 */
export function drawLayout(ctx: Ctx, layout: TextLayout, x: number, y: number, align: Align, mode: 'fill' | 'stroke'): void {
  const f = layout.font;
  applyFont(ctx, f);
  layout.lines.forEach((line, i) => {
    const lx = align === 'left' ? x : align === 'right' ? x + layout.width - line.width : x + (layout.width - line.width) / 2;
    const by = y + i * layout.lineHeight + layout.baseline;
    if (NATIVE_LETTER_SPACING || f.letterSpacing === 0) {
      if (mode === 'fill') ctx.fillText(line.text, lx, by);
      else ctx.strokeText(line.text, lx, by);
      return;
    }
    let cx = lx;
    for (const ch of line.text) {
      if (mode === 'fill') ctx.fillText(ch, cx, by);
      else ctx.strokeText(ch, cx, by);
      cx += ctx.measureText(ch).width + f.letterSpacing;
    }
  });
}

// ---- fonts ------------------------------------------------------------------------

/** [family, file in /fonts, CSS weight] for every font bundled with the booth. */
const FONT_FILES: [string, string, string][] = [
  ['Poppins', 'Poppins-Regular.ttf', '400'],
  ['Poppins', 'Poppins-Medium.ttf', '500'],
  ['Poppins', 'Poppins-SemiBold.ttf', '600'],
  ['Poppins', 'Poppins-Bold.ttf', '700'],
  ['Poppins', 'Poppins-ExtraBold.ttf', '800'],
  ['Shrikhand', 'Shrikhand-Regular.ttf', '400'],
  ['Monoton', 'Monoton-Regular.ttf', '400'],
  ['Bangers', 'Bangers-Regular.ttf', '400'],
  ['Rye', 'Rye-Regular.ttf', '400'],
  ['SpecialElite', 'SpecialElite-Regular.ttf', '400'],
  ['UnifrakturMaguntia', 'UnifrakturMaguntia-Book.ttf', '400'],
  ['OldStandard', 'OldStandard-Regular.ttf', '400'],
  ['OldStandard', 'OldStandard-Bold.ttf', '700'],
  ['Pacifico', 'Pacifico-Regular.ttf', '400'],
  ['BebasNeue', 'BebasNeue-Regular.ttf', '400'],
];

const registered = new Map<string, Promise<void>>();

/**
 * Registers one font face (e.g. a font shipped in a template pack) and resolves when it
 * has loaded. Repeated calls for the same family/url/weight share one load.
 */
export function registerFont(family: string, url: string, descriptors: FontFaceDescriptors = {}): Promise<void> {
  const key = `${family}|${url}|${descriptors.weight ?? ''}|${descriptors.style ?? ''}`;
  let p = registered.get(key);
  if (!p) {
    const face = new FontFace(family, `url("${url.replace(/"/g, '%22')}")`, descriptors);
    p = face.load().then((loaded) => {
      document.fonts.add(loaded);
    });
    // A failed load may be retried later (e.g. once back online).
    p.catch(() => registered.delete(key));
    registered.set(key, p);
  }
  return p;
}

let allFonts: Promise<void> | null = null;

/** Registers and loads every bundled font family from `/fonts`. Idempotent; never rejects. */
export function ensureFonts(): Promise<void> {
  if (!allFonts) {
    const base = `${import.meta.env.BASE_URL ?? '/'}fonts/`;
    allFonts = Promise.allSettled(
      FONT_FILES.map(([family, file, weight]) => registerFont(family, base + file, { weight, style: 'normal' })),
    ).then((results) => {
      // Text still renders with fallback fonts; try again on the next call.
      if (results.some((r) => r.status === 'rejected')) allFonts = null;
    });
  }
  return allFonts;
}
