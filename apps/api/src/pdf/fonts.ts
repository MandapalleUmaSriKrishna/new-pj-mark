import { BUILT_IN_FONTS, type BuiltInFont } from '@kdc/shared';

/**
 * Font resolution.
 *
 * Only the 14 standard PDF fonts are guaranteed to render without embedding, so
 * every designer family is mapped onto them. Custom tenant fonts (uploaded .ttf)
 * bypass this map and are registered directly with PDFKit from their asset
 * buffer, which is why `resolveFont` can also return a registered custom name.
 */

const FAMILY_ALIASES: Record<string, string> = {
  helvetica: 'Helvetica',
  arial: 'Helvetica',
  'liberation sans': 'Helvetica',
  roboto: 'Helvetica',
  'open sans': 'Helvetica',
  inter: 'Helvetica',
  'system ui': 'Helvetica',
  'sans serif': 'Helvetica',
  'trebuchet ms': 'Helvetica',
  verdana: 'Helvetica',
  tahoma: 'Helvetica',
  'times new roman': 'Times-Roman',
  'times roman': 'Times-Roman',
  times: 'Times-Roman',
  georgia: 'Times-Roman',
  palatino: 'Times-Roman',
  'palatino linotype': 'Times-Roman',
  garamond: 'Times-Roman',
  'eb garamond': 'Times-Roman',
  serif: 'Times-Roman',
  courier: 'Courier',
  'courier new': 'Courier',
  monospace: 'Courier',
  'dejavu sans mono': 'Courier',
};

function canonicalFamily(family: string): string {
  const key = family
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, '');
  return FAMILY_ALIASES[key] ?? FAMILY_ALIASES[key.replace(/\s+/g, '')] ?? 'Helvetica';
}

const SERIF = new Set(['Times-Roman']);

/** Maps family + weight + style onto one of the 14 standard PDF font names. */
export function resolveStandardFont(
  family: string,
  weight: 'normal' | 'bold' = 'normal',
  style: 'normal' | 'italic' = 'normal',
): BuiltInFont {
  const base = canonicalFamily(family);
  const bold = weight === 'bold';
  const italic = style === 'italic';

  if (base === 'Courier') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (SERIF.has(base)) {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

export function isBuiltIn(name: string): boolean {
  return (BUILT_IN_FONTS as readonly string[]).includes(name);
}

/**
 * CSS font stack used by the browser canvas so the on-screen preview matches the
 * PDF as closely as the platform allows.
 */
export function cssFontStack(family: string): string {
  const base = canonicalFamily(family);
  if (base === 'Courier') return `'Courier New', Courier, monospace`;
  if (SERIF.has(base)) return `Georgia, 'Times New Roman', Times, serif`;
  return `Helvetica, Arial, 'Helvetica Neue', sans-serif`;
}

export function fontLabel(name: string): string {
  return name
    .replace(/^Times-/, 'Times ')
    .replace(/^Helvetica/, 'Helvetica')
    .replace(/^Courier/, 'Courier')
    .replace('-BoldOblique', ' Bold Italic')
    .replace('-BoldItalic', ' Bold Italic')
    .replace('-Bold', ' Bold')
    .replace('-Oblique', ' Italic')
    .replace('-Italic', ' Italic')
    .replace('-Roman', '');
}
