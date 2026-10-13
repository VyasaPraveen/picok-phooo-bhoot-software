/**
 * Retro photo filters as 4×5 colour matrices (offsets in the 0–255 range, as Flutter's
 * `ColorFilter.matrix`). Ported 1:1 from kiosk_app/lib/render/filters.dart.
 */

export const FILTER_NAMES: Record<string, string> = {
  none: 'Natural',
  warm_film: 'Warm film',
  neon_pop: 'Neon pop',
  poster: 'Poster colour',
  sepia: 'Sepia',
  vivid: 'Vivid',
  classic_bw: 'Classic B&W',
  fade: 'Faded',
  cool: 'Cool',
};

/** The matrix for one template filter (identity for `none` and unknown names). */
export function filterMatrix(filter: string): number[] {
  switch (filter) {
    case 'warm_film':
      return chain([saturation(0.85), contrast(0.92), scale(1.08, 1.0, 0.86, 10, 4, 0), lift(10)]);
    case 'neon_pop':
      return chain([saturation(1.45), contrast(1.15), scale(1.05, 0.97, 1.1, 0, 0, 6)]);
    case 'poster':
      return chain([saturation(1.35), contrast(1.3), scale(1.06, 1.0, 0.95, 4, 0, 0)]);
    case 'sepia':
      return chain([sepia(), contrast(1.05)]);
    case 'vivid':
      return chain([saturation(1.3), contrast(1.12), lift(4)]);
    case 'classic_bw':
      return chain([neutralGrey(), contrast(1.15)]);
    case 'fade':
      return chain([saturation(0.8), contrast(0.85), lift(20)]);
    case 'cool':
      return chain([scale(0.95, 1.0, 1.08, 0, 2, 6)]);
    default:
      return identity();
  }
}

/**
 * True black & white for dye-sublimation: R = G = B exactly, so the printer lays down
 * no colour cast. A small contrast lift compensates for the soft look of dye-sub greys.
 */
export function trueBwMatrix(): number[] {
  return chain([neutralGrey(), contrast(1.08)]);
}

/** The matrix for a photo: template filter first, then B&W if chosen. `null` = identity. */
export function photoMatrix(filter: string, bw: boolean): number[] | null {
  const m = bw ? chain([filterMatrix(filter), trueBwMatrix()]) : filterMatrix(filter);
  return isIdentity(m) ? null : m;
}

/**
 * Applies a 4×5 matrix in place to the device pixels (0,0)–(w,h) of [ctx]
 * (unpremultiplied RGBA, as Skia's colour-matrix filter).
 */
export function applyMatrix(ctx: CanvasRenderingContext2D, w: number, h: number, m: number[]): void {
  w = Math.floor(w);
  h = Math.floor(h);
  if (w <= 0 || h <= 0 || m.length < 20) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = d.length;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19] = m;
  const alphaIdentity = m15 === 0 && m16 === 0 && m17 === 0 && m18 === 1 && m19 === 0;
  const alphaFree = m3 === 0 && m8 === 0 && m13 === 0;
  const grey =
    alphaFree && m0 === m5 && m0 === m10 && m1 === m6 && m1 === m11 && m2 === m7 && m2 === m12 && m4 === m9 && m4 === m14;
  // Uint8ClampedArray stores clamp and round for us.
  if (grey && alphaIdentity) {
    for (let i = 0; i < n; i += 4) {
      const v = m0 * d[i] + m1 * d[i + 1] + m2 * d[i + 2] + m4;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
  } else if (alphaFree && alphaIdentity) {
    for (let i = 0; i < n; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      d[i] = m0 * r + m1 * g + m2 * b + m4;
      d[i + 1] = m5 * r + m6 * g + m7 * b + m9;
      d[i + 2] = m10 * r + m11 * g + m12 * b + m14;
    }
  } else {
    for (let i = 0; i < n; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2],
        a = d[i + 3];
      d[i] = m0 * r + m1 * g + m2 * b + m3 * a + m4;
      d[i + 1] = m5 * r + m6 * g + m7 * b + m8 * a + m9;
      d[i + 2] = m10 * r + m11 * g + m12 * b + m13 * a + m14;
      d[i + 3] = m15 * r + m16 * g + m17 * b + m18 * a + m19;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---- matrix helpers (5×5 maths on 4×5 matrices) ----

function identity(): number[] {
  return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
}

function isIdentity(m: number[]): boolean {
  const id = identity();
  for (let i = 0; i < 20; i++) {
    if (Math.abs(m[i] - id[i]) > 1e-6) return false;
  }
  return true;
}

function saturation(s: number): number[] {
  const lr = 0.2126,
    lg = 0.7152,
    lb = 0.0722;
  const sr = (1 - s) * lr,
    sg = (1 - s) * lg,
    sb = (1 - s) * lb;
  return [sr + s, sg, sb, 0, 0, sr, sg + s, sb, 0, 0, sr, sg, sb + s, 0, 0, 0, 0, 0, 1, 0];
}

function contrast(c: number): number[] {
  const t = 128 * (1 - c);
  return [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0];
}

function scale(r: number, g: number, b: number, ra: number, ga: number, ba: number): number[] {
  return [r, 0, 0, 0, ra, 0, g, 0, 0, ga, 0, 0, b, 0, ba, 0, 0, 0, 1, 0];
}

/** Lifts the black point (faded film look). */
function lift(amount: number): number[] {
  const k = (255 - amount) / 255;
  return scale(k, k, k, amount, amount, amount);
}

function neutralGrey(): number[] {
  const lr = 0.2126,
    lg = 0.7152,
    lb = 0.0722;
  return [lr, lg, lb, 0, 0, lr, lg, lb, 0, 0, lr, lg, lb, 0, 0, 0, 0, 0, 1, 0];
}

function sepia(): number[] {
  return [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0];
}

/** Applies matrices left to right (the first one is applied to the pixel first). */
function chain(ms: number[][]): number[] {
  let acc = identity();
  for (const m of ms) acc = multiply(m, acc);
  return acc;
}

/** Returns a∘b (apply b, then a). */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[row * 5 + k] * b[k * 5 + col];
      if (col === 4) v += a[row * 5 + 4];
      out[row * 5 + col] = v;
    }
  }
  return out;
}
