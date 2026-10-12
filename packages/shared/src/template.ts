import { z } from 'zod';

/**
 * The certificate designer document.
 *
 * All geometry is expressed in PostScript points (1/72 inch) with the origin at
 * the TOP-LEFT corner, growing right and down. The browser canvas scales this
 * space to the viewport; the PDF renderer (PDFKit) consumes it 1:1 because
 * PDFKit's user space is already points. Keeping one coordinate system is what
 * makes the designer WYSIWYG against the generated PDF.
 */

export const PT_PER_INCH = 72;
export const PT_PER_MM = 72 / 25.4;

export const PAGE_PRESETS = {
  a4_landscape: { label: 'A4 landscape', width: 842, height: 595 },
  a4_portrait: { label: 'A4 portrait', width: 595, height: 842 },
  letter_landscape: { label: 'US Letter landscape', width: 792, height: 612 },
  letter_portrait: { label: 'US Letter portrait', width: 612, height: 792 },
  a5_landscape: { label: 'A5 landscape', width: 595, height: 420 },
  square: { label: 'Square (social)', width: 600, height: 600 },
} as const;
export type PagePresetId = keyof typeof PAGE_PRESETS;

export const FONT_STACKS = [
  'Helvetica',
  'Times-Roman',
  'Courier',
  'Georgia',
  'Palatino',
  'Garamond',
  'Trebuchet MS',
  'Verdana',
] as const;

/**
 * PDFKit ships the 14 standard PDF fonts, which need no embedding and always
 * render identically. Custom fonts can be registered per tenant by uploading a
 * .ttf/.otf; those are listed in `customFonts` and resolved at render time.
 */
export const BUILT_IN_FONTS = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
] as const;
export type BuiltInFont = (typeof BUILT_IN_FONTS)[number];

/**
 * Merge fields available to any text element. `{{...}}` tokens in text are
 * substituted per recipient at render time.
 */
export const MERGE_FIELDS = [
  { token: 'recipient.name', label: 'Recipient full name', sample: 'Jane Q. Public' },
  { token: 'recipient.first_name', label: 'Recipient first name', sample: 'Jane' },
  { token: 'recipient.last_name', label: 'Recipient last name', sample: 'Public' },
  { token: 'recipient.email', label: 'Recipient email', sample: 'jane.public@example.edu' },
  { token: 'recipient.title', label: 'Recipient title / designation', sample: 'Graduate' },
  { token: 'recipient.department', label: 'Department / branch', sample: 'Computer Science' },
  { token: 'recipient.roll_number', label: 'Roll / employee number', sample: '21BCE1234' },
  { token: 'recipient.grade', label: 'Grade / score / CGPA', sample: '9.4 CGPA' },
  { token: 'recipient.hours', label: 'Duration in hours', sample: '40' },
  { token: 'event.name', label: 'Event / programme name', sample: 'Annual Convocation 2026' },
  { token: 'event.description', label: 'Event description', sample: 'Awarded for excellence' },
  { token: 'event.date', label: 'Event date', sample: '12 October 2026' },
  { token: 'event.venue', label: 'Event venue', sample: 'Main Auditorium' },
  { token: 'certificate.serial', label: 'Certificate ID', sample: 'KDC-2026-7QK3M9XA-4' },
  { token: 'certificate.issued_at', label: 'Issue date', sample: '12 October 2026' },
  { token: 'certificate.year', label: 'Issue year', sample: '2026' },
  { token: 'tenant.name', label: 'Organisation name', sample: 'Krishna Institute' },
  { token: 'tenant.tagline', label: 'Organisation tagline', sample: 'Excellence in Education' },
  { token: 'verify.url', label: 'Verification URL', sample: 'https://kdc.example/v/KDC-2026-…' },
] as const;

export const MERGE_TOKEN_RE = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

export type MergeValues = Record<string, string | number | null | undefined>;

export function mergeTokensIn(text: string, values: MergeValues): string {
  return text.replace(MERGE_TOKEN_RE, (whole, token: string) => {
    const key = token.trim().toLowerCase();
    const v = values[key];
    if (v === null || v === undefined || v === '') return whole;
    return String(v);
  });
}

export function usedMergeTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MERGE_TOKEN_RE)) out.add((m[1] as string).toLowerCase());
  return [...out];
}

/* ------------------------------------------------------------------ schema */

const num = z.number().finite();

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$|^rgba?\([^)]*\)$|^transparent$/, {
    message: 'Colour must be a hex (#rgb/#rrggbb/#rrggbbaa) or rgb()/rgba() value',
  });

const baseElement = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(120).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  rotation: num.min(-360).max(360).optional(),
  opacity: num.min(0).max(1).optional(),
  zIndex: z.number().int().min(0).max(10_000).optional(),
});

export const textElementSchema = baseElement.extend({
  type: z.literal('text'),
  x: num,
  y: num,
  width: num.gt(0),
  height: num.gt(0),
  text: z.string().max(5_000),
  fontFamily: z.string().max(80).default('Helvetica'),
  fontSize: num.gt(0).max(600).default(18),
  fontWeight: z.enum(['normal', 'bold']).default('normal'),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  color: colorSchema.default('#111827'),
  align: z.enum(['left', 'center', 'right', 'justify']).default('center'),
  valign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  lineHeight: num.gt(0).max(4).default(1.3),
  letterSpacing: num.min(-10).max(50).default(0),
  uppercase: z.boolean().optional(),
  autoShrink: z.boolean().optional(),
});

export const imageElementSchema = baseElement.extend({
  type: z.literal('image'),
  x: num,
  y: num,
  width: num.gt(0),
  height: num.gt(0),
  /** Asset id (uploaded) or an https URL. Never a data: or file: URL. */
  src: z.string().min(1).max(2_048),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
  borderRadius: num.min(0).optional(),
  alt: z.string().max(200).optional(),
});

export const rectElementSchema = baseElement.extend({
  type: z.literal('rect'),
  x: num,
  y: num,
  width: num.gt(0),
  height: num.gt(0),
  fill: colorSchema.default('#ffffff'),
  stroke: colorSchema.optional(),
  strokeWidth: num.min(0).max(50).default(0),
  radius: num.min(0).max(500).default(0),
  /** 'border' renders an ornamental double-rule frame commonly used on awards. */
  variant: z.enum(['solid', 'border', 'double_border', 'gradient']).default('solid'),
  gradientFrom: colorSchema.optional(),
  gradientTo: colorSchema.optional(),
  gradientAngle: num.min(0).max(360).optional(),
});

export const lineElementSchema = baseElement.extend({
  type: z.literal('line'),
  x: num,
  y: num,
  width: num.gt(0),
  height: num.gte(0),
  stroke: colorSchema.default('#111827'),
  strokeWidth: num.min(0).max(50).default(1),
  dash: z.array(num.min(0)).max(8).optional(),
});

export const qrElementSchema = baseElement.extend({
  type: z.literal('qr'),
  x: num,
  y: num,
  size: num.gt(0).max(600),
  /** Token source rendered into the QR payload. */
  value: z.enum(['verify_url', 'serial', 'custom']).default('verify_url'),
  customValue: z.string().max(500).optional(),
  foreground: colorSchema.default('#000000'),
  background: colorSchema.default('#ffffff'),
  errorLevel: z.enum(['L', 'M', 'Q', 'H']).default('M'),
  caption: z.string().max(120).optional(),
  captionFontSize: num.gt(0).max(40).optional(),
});

export const signatureElementSchema = baseElement.extend({
  type: z.literal('signature'),
  x: num,
  y: num,
  width: num.gt(0),
  height: num.gt(0),
  mode: z.enum(['image', 'text']).default('image'),
  /** Asset id of the uploaded signature/seal image. */
  src: z.string().max(2_048).optional(),
  signatoryName: z.string().max(200).optional(),
  signatoryTitle: z.string().max(200).optional(),
  showRule: z.boolean().default(true),
  ruleColor: colorSchema.default('#374151'),
  fontFamily: z.string().max(80).default('Times-Roman'),
  fontSize: num.gt(0).max(120).default(11),
  color: colorSchema.default('#111827'),
});

export const serialElementSchema = baseElement.extend({
  type: z.literal('serial'),
  x: num,
  y: num,
  width: num.gt(0),
  height: num.gt(0),
  label: z.string().max(80).default('Certificate ID'),
  showLabel: z.boolean().default(true),
  fontFamily: z.string().max(80).default('Courier-Bold'),
  fontSize: num.gt(0).max(120).default(10),
  color: colorSchema.default('#374151'),
  align: z.enum(['left', 'center', 'right']).default('center'),
});

export const templateElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  imageElementSchema,
  rectElementSchema,
  lineElementSchema,
  qrElementSchema,
  signatureElementSchema,
  serialElementSchema,
]);
export type TemplateElement = z.infer<typeof templateElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type RectElement = z.infer<typeof rectElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type QrElement = z.infer<typeof qrElementSchema>;
export type SignatureElement = z.infer<typeof signatureElementSchema>;
export type SerialElement = z.infer<typeof serialElementSchema>;

export const pageSchema = z.object({
  width: num.gt(50).max(4_000),
  height: num.gt(50).max(4_000),
  preset: z
    .enum([
      'a4_landscape',
      'a4_portrait',
      'letter_landscape',
      'letter_portrait',
      'a5_landscape',
      'square',
      'custom',
    ])
    .default('a4_landscape'),
  background: colorSchema.default('#ffffff'),
  /** Optional full-bleed background asset id / https URL. */
  backgroundSrc: z.string().max(2_048).optional(),
  backgroundOpacity: num.min(0).max(1).default(1),
  margins: z
    .object({ top: num.min(0), right: num.min(0), bottom: num.min(0), left: num.min(0) })
    .optional(),
  showGuides: z.boolean().default(true),
  dpi: z.number().int().min(72).max(600).default(150),
});

export const templateDocSchema = z.object({
  version: z.literal(1),
  page: pageSchema,
  elements: z.array(templateElementSchema).max(200),
  /** Per-tenant uploaded font families referenced by elements. */
  customFonts: z
    .array(z.object({ family: z.string().max(80), assetId: z.string().max(64) }))
    .max(10)
    .optional(),
  defaultLocale: z.string().max(10).optional(),
});
export type TemplateDoc = z.infer<typeof templateDocSchema>;
export type PageSpec = z.infer<typeof pageSchema>;

export function isLandscape(page: Pick<PageSpec, 'width' | 'height'>): boolean {
  return page.width >= page.height;
}

export function elementBounds(el: TemplateElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (el.type === 'qr') return { x: el.x, y: el.y, width: el.size, height: el.size };
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

export function hitTest(el: TemplateElement, px: number, py: number, tolerance = 0): boolean {
  const b = elementBounds(el);
  return (
    px >= b.x - tolerance &&
    px <= b.x + b.width + tolerance &&
    py >= b.y - tolerance &&
    py <= b.y + b.height + tolerance
  );
}

export function clampToPage(el: TemplateElement, page: PageSpec): TemplateElement {
  const b = elementBounds(el);
  const maxX = Math.max(0, page.width - b.width);
  const maxY = Math.max(0, page.height - b.height);
  const x = Math.min(Math.max(0, b.x), maxX);
  const y = Math.min(Math.max(0, b.y), maxY);
  return { ...el, x, y } as TemplateElement;
}

export function sortElementsByZ(elements: TemplateElement[]): TemplateElement[] {
  return [...elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

export function nextZIndex(elements: TemplateElement[]): number {
  return elements.reduce((m, e) => Math.max(m, e.zIndex ?? 0), 0) + 1;
}

let counter = 0;
export function newElementId(prefix = 'el'): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function emptyTemplateDoc(preset: PagePresetId = 'a4_landscape'): TemplateDoc {
  const p = PAGE_PRESETS[preset];
  return {
    version: 1,
    page: {
      width: p.width,
      height: p.height,
      preset,
      background: '#ffffff',
      backgroundOpacity: 1,
      showGuides: true,
      dpi: 150,
    },
    elements: [],
  };
}

/** Validates an arbitrary JSON payload as a template document. */
export function parseTemplateDoc(input: unknown): TemplateDoc {
  return templateDocSchema.parse(input);
}

export function safeParseTemplateDoc(input: unknown) {
  return templateDocSchema.safeParse(input);
}
