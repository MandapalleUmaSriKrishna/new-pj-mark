/**
 * Colour parsing for the renderer.
 *
 * The designer emits hex (#rgb / #rrggbb / #rrggbbaa), rgb() and rgba() strings.
 * PDFKit wants either a hex string or an [r,g,b] / [r,g,b,a] tuple, and it does
 * not understand `transparent`, so everything is normalised here once.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type PdfColor = [number, number, number] | [number, number, number, number];

export function parseColor(input: string | undefined | null, fallback = '#000000'): Rgba {
  const raw = (input ?? '').trim().toLowerCase();
  if (!raw || raw === 'transparent' || raw === 'none') return { r: 0, g: 0, b: 0, a: 0 };

  const rgbaMatch = raw.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (rgbaMatch) {
    return {
      r: clamp255(Number(rgbaMatch[1])),
      g: clamp255(Number(rgbaMatch[2])),
      b: clamp255(Number(rgbaMatch[3])),
      a: rgbaMatch[4] === undefined ? 1 : clamp01(Number(rgbaMatch[4])),
    };
  }

  let hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].every((v) => Number.isFinite(v))) {
      return {
        r: clamp255(r),
        g: clamp255(g),
        b: clamp255(b),
        a: clamp01(Number.isFinite(a) ? a : 1),
      };
    }
  }

  const fb = parseColor(fallback);
  return fb;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
}

export function toPdfColor(
  input: string | undefined | null,
  fallback = '#000000',
): PdfColor | null {
  const { r, g, b, a } = parseColor(input, fallback);
  if (a <= 0) return null; // fully transparent: draw nothing
  return a >= 1 ? [r, g, b] : [r, g, b, Number(a.toFixed(3))];
}

export function toCssRgba(input: string | undefined | null, fallback = '#000000'): string {
  const { r, g, b, a } = parseColor(input, fallback);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function relativeLuminance(input: string): number {
  const { r, g, b } = parseColor(input);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Picks black or white text for a background - keeps contrast readable. */
export function readableForeground(background: string): '#000000' | '#ffffff' {
  return relativeLuminance(background) > 0.45 ? '#000000' : '#ffffff';
}
