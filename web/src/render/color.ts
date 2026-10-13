/** A colour with 0–255 channels, as Flutter's `Color`. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };

/**
 * Parses `#RGB`, `#RRGGBB` or `#AARRGGBB` (alpha FIRST, as in Flutter).
 * Anything unparseable becomes opaque black, exactly like the Dart renderer.
 */
export function parseColor(hex: string): Rgba {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h = `FF${h}`;
  if (h.length === 0 || !/^[0-9a-fA-F]+$/.test(h)) return BLACK;
  // Flutter's Color keeps the low 32 bits.
  if (h.length > 8) h = h.slice(-8);
  const v = parseInt(h, 16);
  return { a: (v >>> 24) & 255, r: (v >>> 16) & 255, g: (v >>> 8) & 255, b: v & 255 };
}

/** CSS colour string for canvas styles. */
export function css(c: Rgba): string {
  if (c.a >= 255) return `rgb(${c.r},${c.g},${c.b})`;
  return `rgba(${c.r},${c.g},${c.b},${+(c.a / 255).toFixed(4)})`;
}

/** Shorthand: hex → CSS. */
export function cssHex(hex: string): string {
  return css(parseColor(hex));
}

/** Same colour with an absolute alpha (0–1), like `Color.withValues(alpha:)`. */
export function withAlpha(c: Rgba, alpha: number): Rgba {
  return { ...c, a: Math.round(Math.min(1, Math.max(0, alpha)) * 255) };
}

/** Relative luminance, identical to Flutter's `Color.computeLuminance()`. */
export function luminance(c: Rgba): number {
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
