import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  ImageElement,
  LineElement,
  MergeValues,
  QrElement,
  RectElement,
  SerialElement,
  SignatureElement,
  TemplateDoc,
  TemplateElement,
  TextElement,
} from '@kdc/shared';
import { mergeTokensIn, sortElementsByZ } from '@kdc/shared';
import { parseColor, toPdfColor } from './color';
import { isBuiltIn, resolveStandardFont } from './fonts';
import { QrService } from './qr.service';

export type WatermarkKind = 'draft' | 'specimen' | 'revoked' | null;

export interface PdfRenderInput {
  doc: TemplateDoc;
  mergeValues: MergeValues;
  serial: string;
  verifyUrl: string;
  tenantName: string;
  issuedAt: Date;
  watermark?: WatermarkKind;
  /** assetId -> image bytes, resolved by the caller from the storage port. */
  images?: Map<string, Buffer>;
  /** font family -> ttf/otf bytes for tenant-uploaded fonts. */
  customFonts?: Map<string, Buffer>;
  /** https URL -> image bytes for elements that reference remote images. */
  remoteImages?: Map<string, Buffer>;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string[] };
}

export interface PdfRenderResult {
  buffer: Buffer;
  sha256: string;
  bytes: number;
  pages: number;
  warnings: string[];
}

const MAX_REMOTE_IMAGES = 20;

/**
 * Template document -> PDF.
 *
 * The renderer walks the same element list the designer canvas does, in the same
 * coordinate system (points, origin top-left), which is what makes the preview
 * and the printed artefact agree. Anything it cannot faithfully reproduce is
 * reported in `warnings` rather than silently dropped, and those warnings are
 * stored on the job so an operator can see them.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(private readonly qr: QrService) {}

  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    const warnings: string[] = [];
    const { doc } = input;
    const { width, height } = doc.page;

    const pdf = new PDFDocument({
      size: [width, height],
      margin: 0,
      autoFirstPage: true,
      compress: true,
      info: {
        Title: input.metadata?.title ?? `Certificate ${input.serial}`,
        Author: input.metadata?.author ?? input.tenantName,
        Subject: input.metadata?.subject ?? 'Digital certificate',
        Keywords: input.metadata?.keywords?.join(', ') ?? `certificate,${input.serial}`,
        Creator: 'Krishna Digital Certificate',
        Producer: 'Krishna Digital Certificate PDF renderer',
        CreationDate: input.issuedAt,
      },
    });

    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    const finished = new Promise<void>((resolve, reject) => {
      pdf.on('end', () => resolve());
      pdf.on('error', (err: Error) => reject(err));
    });

    try {
      await this.paintPage(pdf, doc, input, warnings);
    } catch (err) {
      pdf.end();
      throw err;
    }
    pdf.end();
    await finished;

    const buffer = Buffer.concat(chunks);
    return {
      buffer,
      bytes: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      pages: 1,
      warnings,
    };
  }

  /* ------------------------------------------------------------------ page */

  private async paintPage(
    pdf: PDFKit.PDFDocument,
    doc: TemplateDoc,
    input: PdfRenderInput,
    warnings: string[],
  ): Promise<void> {
    const { page } = doc;

    // 1. Background colour
    const bg = toPdfColor(page.background, '#ffffff');
    if (bg) {
      pdf.save();
      pdf.rect(0, 0, page.width, page.height).fill(bg);
      pdf.restore();
    }

    // 2. Optional full-bleed background image
    if (page.backgroundSrc) {
      const buf = await this.resolveImage(page.backgroundSrc, input, warnings, 'page background');
      if (buf) {
        pdf.save();
        pdf.opacity(page.backgroundOpacity ?? 1);
        pdf.image(buf, 0, 0, {
          width: page.width,
          height: page.height,
          fit: [page.width, page.height],
        });
        pdf.restore();
      }
    }

    // 3. Elements, in z order
    for (const element of sortElementsByZ(doc.elements)) {
      if (element.hidden) continue;
      pdf.save();
      if (typeof element.opacity === 'number' && element.opacity < 1)
        pdf.opacity(Math.max(0, element.opacity));
      if (element.rotation) this.applyRotation(pdf, element, doc);
      try {
        await this.paintElement(pdf, element, input, warnings);
      } catch (err) {
        warnings.push(
          `Element "${element.id}" (${element.type}) failed to render: ${(err as Error).message}`,
        );
        this.logger.warn(`Element ${element.id} failed: ${(err as Error).message}`);
      }
      pdf.restore();
    }

    // 4. Watermark last so it sits above the artwork but below nothing else
    if (input.watermark) this.paintWatermark(pdf, doc, input.watermark);
  }

  private applyRotation(pdf: PDFKit.PDFDocument, element: TemplateElement, doc: TemplateDoc): void {
    const cx = element.type === 'qr' ? element.x + element.size / 2 : element.x + element.width / 2;
    const cy =
      element.type === 'qr' ? element.y + element.size / 2 : element.y + element.height / 2;
    void doc;
    pdf.rotate(element.rotation as number, { origin: [cx, cy] });
  }

  private async paintElement(
    pdf: PDFKit.PDFDocument,
    element: TemplateElement,
    input: PdfRenderInput,
    warnings: string[],
  ): Promise<void> {
    switch (element.type) {
      case 'rect':
        return this.paintRect(pdf, element, warnings);
      case 'line':
        return this.paintLine(pdf, element);
      case 'text':
        return this.paintText(pdf, element, input, warnings);
      case 'image':
        return this.paintImage(pdf, element, input, warnings);
      case 'qr':
        return this.paintQr(pdf, element, input, warnings);
      case 'signature':
        return this.paintSignature(pdf, element, input, warnings);
      case 'serial':
        return this.paintSerial(pdf, element, input, warnings);
      default: {
        warnings.push(`Unknown element type encountered: ${(element as TemplateElement).type}`);
      }
    }
  }

  /* ------------------------------------------------------------------ rect */

  private paintRect(pdf: PDFKit.PDFDocument, el: RectElement, warnings: string[]): void {
    const { x, y, width, height } = el;
    const radius = Math.min(el.radius ?? 0, width / 2, height / 2);

    if (el.variant === 'gradient') {
      const from = el.gradientFrom ?? '#ffffff';
      const to = el.gradientTo ?? '#000000';
      const angle = ((el.gradientAngle ?? 0) * Math.PI) / 180;
      const cx = x + width / 2;
      const cy = y + height / 2;
      const dx = (Math.cos(angle) * width) / 2;
      const dy = (Math.sin(angle) * height) / 2;
      if (radius > 0) pdf.roundedRect(x, y, width, height, radius);
      else pdf.rect(x, y, width, height);
      const gradient = pdf.linearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      gradient.stop(0, toCss(from), toAlpha(from));
      gradient.stop(1, toCss(to), toAlpha(to));
      // Documented pdfkit API: hand the gradient to fill() for the current path.
      pdf.fill(gradient);
      if (el.stroke && el.strokeWidth > 0) {
        const sc = toPdfColor(el.stroke);
        if (sc) {
          if (radius > 0) pdf.roundedRect(x, y, width, height, radius);
          else pdf.rect(x, y, width, height);
          pdf.lineWidth(el.strokeWidth).stroke(sc);
        }
      }
      return;
    }

    const fill = toPdfColor(el.fill, '#ffffff');
    const stroke = toPdfColor(el.stroke);

    const path = (): void => {
      if (radius > 0) pdf.roundedRect(x, y, width, height, radius);
      else pdf.rect(x, y, width, height);
    };

    if (el.variant === 'border' || el.variant === 'double_border') {
      if (stroke) {
        const sw = Math.max(0.5, el.strokeWidth || 1);
        path();
        pdf.lineWidth(sw).stroke(stroke);
        if (el.variant === 'double_border') {
          const inset = sw * 2.5;
          if (width > inset * 2 && height > inset * 2) {
            const r2 = Math.max(0, radius - inset);
            if (r2 > 0)
              pdf.roundedRect(x + inset, y + inset, width - inset * 2, height - inset * 2, r2);
            else pdf.rect(x + inset, y + inset, width - inset * 2, height - inset * 2);
            pdf.lineWidth(Math.max(0.5, sw * 0.5)).stroke(stroke);
          }
        }
      } else {
        warnings.push(
          `Rect "${el.id}" uses variant "${el.variant}" with no stroke colour; nothing was drawn.`,
        );
      }
      return;
    }

    if (fill) {
      path();
      pdf.fill(fill);
    }
    if (stroke && el.strokeWidth > 0) {
      path();
      pdf.lineWidth(el.strokeWidth).stroke(stroke);
    }
  }

  /* ------------------------------------------------------------------ line */

  private paintLine(pdf: PDFKit.PDFDocument, el: LineElement): void {
    const stroke = toPdfColor(el.stroke, '#111827');
    if (!stroke) return;
    pdf.save();
    pdf.lineWidth(Math.max(0.25, el.strokeWidth));
    pdf.strokeColor(stroke as [number, number, number]);
    if (el.dash && el.dash.length > 0) applyDashPattern(pdf, el.dash);
    // A zero-height box is a horizontal rule; a zero-width box is vertical.
    if (el.height <= 0.001)
      pdf
        .moveTo(el.x, el.y)
        .lineTo(el.x + el.width, el.y)
        .stroke();
    else if (el.width <= 0.001)
      pdf
        .moveTo(el.x, el.y)
        .lineTo(el.x, el.y + el.height)
        .stroke();
    else
      pdf
        .moveTo(el.x, el.y)
        .lineTo(el.x + el.width, el.y + el.height)
        .stroke();
    pdf.restore();
  }

  /* ------------------------------------------------------------------ text */

  private paintText(
    pdf: PDFKit.PDFDocument,
    el: TextElement,
    input: PdfRenderInput,
    warnings: string[],
  ): void {
    const resolved = mergeTokensIn(el.text ?? '', input.mergeValues);
    const text = el.uppercase ? resolved.toUpperCase() : resolved;
    if (!text.trim()) return;

    this.selectFont(
      pdf,
      el.fontFamily,
      el.fontWeight ?? 'normal',
      el.fontStyle ?? 'normal',
      input,
      warnings,
    );
    const color = toPdfColor(el.color, '#111827');
    if (!color) return;

    let fontSize = el.fontSize;
    const width = Math.max(1, el.width);
    const height = Math.max(1, el.height);
    const wantedLineHeight = el.lineHeight ?? 1.3;

    /**
     * pdfkit's `lineGap` is added ON TOP of the font's natural leading, so
     * passing `(lineHeight - 1) * size` double-counts and inflates every text
     * box. The designer's `lineHeight` is a total multiplier (CSS semantics),
     * therefore the gap is the difference between what the designer asked for
     * and what the font already provides.
     */
    const extraGapFor = (size: number): number => {
      pdf.fontSize(size);
      const natural = pdf.currentLineHeight(true);
      return Math.max(0, wantedLineHeight * size - natural);
    };
    const lineGap = extraGapFor(fontSize);
    const measure = (size: number): number => {
      pdf.fontSize(size);
      return pdf.heightOfString(text, {
        width,
        lineGap: extraGapFor(size),
        characterSpacing: el.letterSpacing ?? 0,
      });
    };

    if (el.autoShrink) {
      let guard = 0;
      while (measure(fontSize) > height && fontSize > 4 && guard < 60) {
        fontSize -= 0.5;
        guard += 1;
      }
      if (measure(fontSize) > height) {
        warnings.push(
          `Text "${el.id}" ("${summarise(text)}") still overflows its box at ${fontSize.toFixed(1)}pt; it will be clipped.`,
        );
      }
    } else if (measure(fontSize) > height * 1.02) {
      warnings.push(
        `Text "${el.id}" ("${summarise(text)}") needs ${measure(fontSize).toFixed(0)}pt of height but its box is ` +
          `${height.toFixed(0)}pt at ${fontSize.toFixed(1)}pt font. Enable "shrink to fit" or enlarge the box.`,
      );
    }

    pdf.fontSize(fontSize);
    pdf.fillColor(color as [number, number, number]);

    // 'middle' is the designer's word; pdfkit calls it 'center'.
    const valign = el.valign === 'middle' ? 'center' : el.valign;
    const options: PDFKit.Mixins.TextOptions = {
      width,
      height,
      align: el.align === 'justify' ? 'justify' : el.align,
      valign,
      lineGap,
      ellipsis: true,
      characterSpacing: el.letterSpacing ?? 0,
    };
    pdf.text(text, el.x, el.y, options);
  }

  private selectFont(
    pdf: PDFKit.PDFDocument,
    family: string,
    weight: 'normal' | 'bold',
    style: 'normal' | 'italic',
    input: PdfRenderInput,
    warnings: string[],
  ): void {
    const custom = input.customFonts?.get(family);
    if (custom) {
      try {
        // Registering a buffer embeds the font, so the PDF renders identically
        // on machines that do not have it installed.
        pdf.font(custom);
        return;
      } catch (err) {
        warnings.push(
          `Custom font "${family}" could not be embedded (${(err as Error).message}); fell back to a standard font.`,
        );
      }
    }
    const standard = resolveStandardFont(family, weight, style);
    if (!isBuiltIn(standard) && !warnings.some((w) => w.includes(`font "${family}"`))) {
      warnings.push(`Font "${family}" is not available; substituted ${standard}.`);
    }
    pdf.font(standard);
  }

  /* ----------------------------------------------------------------- image */

  private async resolveImage(
    src: string,
    input: PdfRenderInput,
    warnings: string[],
    what: string,
  ): Promise<Buffer | null> {
    if (!src) return null;
    if (src.startsWith('data:')) {
      // Data URLs are rejected: they bloat template documents and bypass the
      // asset pipeline's type and size checks.
      warnings.push(`Inline data: URL for ${what} is not allowed; upload it as an asset instead.`);
      return null;
    }
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const cached = input.remoteImages?.get(src);
      if (cached) return cached;
      if ((input.remoteImages?.size ?? 0) > MAX_REMOTE_IMAGES) {
        warnings.push(`Too many remote images; ${what} (${src}) was skipped.`);
        return null;
      }
      warnings.push(`Remote image ${src} for ${what} was not pre-fetched and was skipped.`);
      return null;
    }
    const buf = input.images?.get(src) ?? null;
    if (!buf) warnings.push(`Asset "${src}" for ${what} could not be loaded and was skipped.`);
    return buf;
  }

  private async paintImage(
    pdf: PDFKit.PDFDocument,
    el: ImageElement,
    input: PdfRenderInput,
    warnings: string[],
  ): Promise<void> {
    const buf = await this.resolveImage(el.src, input, warnings, `image "${el.id}"`);
    if (!buf) return;
    const width = Math.max(1, el.width);
    const height = Math.max(1, el.height);

    if (el.borderRadius && el.borderRadius > 0) {
      const r = Math.min(el.borderRadius, width / 2, height / 2);
      pdf.save();
      pdf.roundedRect(el.x, el.y, width, height, r).clip();
      this.drawImage(pdf, buf, el, width, height, warnings);
      pdf.restore();
      return;
    }
    this.drawImage(pdf, buf, el, width, height, warnings);
  }

  private drawImage(
    pdf: PDFKit.PDFDocument,
    buf: Buffer,
    el: ImageElement,
    width: number,
    height: number,
    warnings: string[],
  ): void {
    try {
      if (el.fit === 'fill') pdf.image(buf, el.x, el.y, { width, height });
      else if (el.fit === 'cover') {
        // Cover: fill the box then clip the overflow.
        pdf.save();
        pdf.rect(el.x, el.y, width, height).clip();
        const coverOptions: PDFKit.Mixins.ImageOption & { valign?: 'top' | 'center' | 'bottom' } = {
          fit: [width, height],
          align: 'center',
          valign: 'center',
        };
        pdf.image(buf, el.x, el.y, coverOptions);
        pdf.restore();
      } else
        pdf.image(buf, el.x, el.y, { fit: [width, height], align: 'center', valign: 'center' });
    } catch (err) {
      warnings.push(`Image "${el.id}" could not be embedded (${(err as Error).message}).`);
    }
  }

  /* -------------------------------------------------------------------- qr */

  private async paintQr(
    pdf: PDFKit.PDFDocument,
    el: QrElement,
    input: PdfRenderInput,
    warnings: string[],
  ): Promise<void> {
    const payload =
      el.value === 'serial'
        ? input.serial
        : el.value === 'custom'
          ? mergeTokensIn(el.customValue ?? '', input.mergeValues)
          : input.verifyUrl;
    if (!payload) {
      warnings.push(`QR "${el.id}" has an empty payload and was skipped.`);
      return;
    }
    const size = Math.max(8, el.size);
    const png = await this.qr.toPngBuffer({
      text: payload,
      sizePoints: size,
      foreground: el.foreground,
      background: el.background,
      errorLevel: el.errorLevel,
      marginModules: 1,
    });
    pdf.image(png, el.x, el.y, { width: size, height: size });

    if (el.caption) {
      const captionSize = el.captionFontSize ?? 7;
      pdf.save();
      pdf.font('Helvetica');
      pdf.fontSize(captionSize);
      const fg = parseColor(el.foreground ?? '#000000');
      pdf.fillColor([fg.r, fg.g, fg.b] as [number, number, number]);
      pdf.text(el.caption, el.x - size * 0.25, el.y + size + 2, {
        width: size * 1.5,
        align: 'center',
      });
      pdf.restore();
    }
  }

  /* ------------------------------------------------------------- signature */

  private async paintSignature(
    pdf: PDFKit.PDFDocument,
    el: SignatureElement,
    input: PdfRenderInput,
    warnings: string[],
  ): Promise<void> {
    const width = Math.max(1, el.width);
    const height = Math.max(1, el.height);
    const ruleY = el.y + height - 26;

    if (el.mode === 'image' && el.src) {
      const buf = await this.resolveImage(el.src, input, warnings, `signature "${el.id}"`);
      if (buf) {
        const imgH = Math.max(12, height - 30);
        pdf.image(buf, el.x, el.y, { fit: [width, imgH], align: 'center', valign: 'bottom' });
      }
    } else if (el.mode === 'text' && el.signatoryName) {
      pdf.save();
      this.selectFont(pdf, el.fontFamily, 'normal', 'italic', input, warnings);
      pdf.fontSize(Math.min(el.fontSize + 8, 34));
      const c = toPdfColor(el.color, '#111827');
      if (c) pdf.fillColor(c as [number, number, number]);
      pdf.text(el.signatoryName, el.x, el.y, {
        width,
        height: height - 28,
        align: 'center',
        valign: 'bottom',
      });
      pdf.restore();
    }

    if (el.showRule !== false) {
      const rule = toPdfColor(el.ruleColor, '#374151');
      if (rule) {
        pdf.save();
        pdf.lineWidth(0.8).strokeColor(rule as [number, number, number]);
        pdf
          .moveTo(el.x, ruleY)
          .lineTo(el.x + width, ruleY)
          .stroke();
        pdf.restore();
      }
    }

    const name = mergeTokensIn(el.signatoryName ?? '', input.mergeValues);
    const title = mergeTokensIn(el.signatoryTitle ?? '', input.mergeValues);
    pdf.save();
    pdf.font('Helvetica-Bold');
    pdf.fontSize(Math.max(6, Math.min(el.fontSize, 14)));
    const textColor = toPdfColor(el.color, '#111827');
    if (textColor) pdf.fillColor(textColor as [number, number, number]);
    let cursorY = ruleY + 5;
    if (name) {
      pdf.text(name, el.x, cursorY, { width, align: 'center' });
      cursorY += el.fontSize + 3;
    }
    if (title) {
      pdf.font('Helvetica');
      pdf.fontSize(Math.max(5, Math.min(el.fontSize - 2, 12)));
      const muted = parseColor(el.color ?? '#111827');
      pdf.fillColor([muted.r, muted.g, muted.b, 0.75] as [number, number, number, number]);
      pdf.text(title, el.x, cursorY, { width, align: 'center' });
    }
    pdf.restore();
  }

  /* ---------------------------------------------------------------- serial */

  private paintSerial(
    pdf: PDFKit.PDFDocument,
    el: SerialElement,
    input: PdfRenderInput,
    warnings: string[],
  ): void {
    const width = Math.max(1, el.width);
    const height = Math.max(1, el.height);
    const color = toPdfColor(el.color, '#374151');
    if (!color) return;
    pdf.save();
    pdf.fillColor(color as [number, number, number]);

    let y = el.y;
    if (el.showLabel !== false && el.label) {
      pdf.font('Helvetica');
      pdf.fontSize(Math.max(5, el.fontSize - 2));
      pdf.text(el.label.toUpperCase(), el.x, y, { width, align: el.align, characterSpacing: 1.2 });
      y += Math.max(8, el.fontSize);
    }
    const font = resolveStandardFont(el.fontFamily, 'bold', 'normal');
    pdf.font(isBuiltIn(font) ? font : 'Courier-Bold');
    pdf.fontSize(el.fontSize);
    pdf.text(input.serial, el.x, y, { width, height: height - (y - el.y), align: el.align });
    pdf.restore();
    void warnings;
  }

  /* ------------------------------------------------------------- watermark */

  private paintWatermark(
    pdf: PDFKit.PDFDocument,
    doc: TemplateDoc,
    kind: NonNullable<WatermarkKind>,
  ): void {
    const label =
      kind === 'revoked'
        ? 'REVOKED'
        : kind === 'specimen'
          ? 'SPECIMEN - NOT VALID'
          : 'DRAFT - NOT ISSUED';
    const color =
      kind === 'revoked' ? [220, 38, 38] : kind === 'specimen' ? [107, 114, 128] : [217, 119, 6];
    const { width, height } = doc.page;
    pdf.save();
    pdf.opacity(0.18);
    pdf.font('Helvetica-Bold');
    pdf.fontSize(Math.max(28, Math.min(width, height) / 9));
    pdf.fillColor(color as [number, number, number]);
    pdf.rotate(-28, { origin: [width / 2, height / 2] });
    pdf.text(label, 0, height / 2 - 30, { width, align: 'center' });
    pdf.restore();

    // A thin corner tag survives being cropped or screenshotted.
    pdf.save();
    pdf.opacity(0.85);
    pdf.font('Helvetica-Bold');
    pdf.fontSize(9);
    pdf.fillColor(color as [number, number, number]);
    pdf.text(label, 14, height - 24, { width: width - 28, align: 'right' });
    pdf.restore();
  }
}

/**
 * Applies an arbitrary dash pattern.
 *
 * pdfkit's `dash()` only accepts a single on/off length, so multi-value patterns
 * are written with the PDF `d` operator directly. The values are validated and
 * clamped first - they come from a template document, so they must never be able
 * to inject arbitrary content stream operators.
 */
function applyDashPattern(pdf: PDFKit.PDFDocument, pattern: number[]): void {
  const values = pattern
    .map((n) => (Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : 0))
    .filter((n, i) => n > 0 || i === 0)
    .slice(0, 8);
  if (values.length === 0) return;
  const writer = pdf as unknown as { addContent?: (raw: string) => unknown };
  if (typeof writer.addContent === 'function') {
    writer.addContent(`[${values.map((v) => Number(v.toFixed(3))).join(' ')}] 0 d`);
    return;
  }
  pdf.dash(values[0] ?? 1, { space: values[1] ?? values[0] ?? 1 });
}

/** First line of the rendered text, truncated - makes warnings actionable. */
function summarise(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 48 ? `${flat.slice(0, 48)}\u2026` : flat;
}

function toCss(input: string): string {
  const { r, g, b } = parseColor(input);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function toAlpha(input: string): number {
  return parseColor(input).a;
}
