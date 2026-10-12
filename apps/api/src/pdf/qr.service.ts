import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';

export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrOptions {
  /** Payload encoded in the code. */
  text: string;
  /** Edge length in PDF points (or CSS px for the browser preview). */
  sizePoints: number;
  foreground?: string;
  background?: string;
  errorLevel?: QrErrorLevel;
  /** Render margin in modules. 0 keeps the design tight; >=2 improves scanning. */
  marginModules?: number;
}

/**
 * QR generation.
 *
 * The code is rasterised at 4x the target size and downscaled by the renderer,
 * which keeps module edges crisp in the PDF at any zoom level. Payload length is
 * capped because a QR's density grows with its data and a dense code printed
 * small on a certificate is exactly the case that fails to scan on a phone.
 */
@Injectable()
export class QrService {
  static readonly MAX_PAYLOAD = 900;

  /** PNG buffer, suitable for embedding in a PDF or serving as an image. */
  async toPngBuffer(opts: QrOptions): Promise<Buffer> {
    const text = opts.text ?? '';
    if (!text) throw new Error('Cannot render a QR code for an empty payload');
    if (text.length > QrService.MAX_PAYLOAD) {
      throw new Error(
        `QR payload is ${text.length} characters; the limit is ${QrService.MAX_PAYLOAD}`,
      );
    }
    const scale = 4;
    const widthPx = Math.max(64, Math.round(opts.sizePoints * scale));
    return QRCode.toBuffer(text, {
      type: 'png',
      width: widthPx,
      margin: Math.max(0, opts.marginModules ?? 1),
      errorCorrectionLevel: opts.errorLevel ?? 'M',
      color: {
        dark: normaliseQrColor(opts.foreground ?? '#000000', 'ff'),
        light: normaliseQrColor(opts.background ?? '#ffffff', 'ff'),
      },
    });
  }

  /** Data URL for browser previews (never sent to the PDF path). */
  async toDataUrl(opts: QrOptions): Promise<string> {
    const buf = await this.toPngBuffer(opts);
    return `data:image/png;base64,${buf.toString('base64')}`;
  }

  /** Terminal-renderable string, handy for support debugging without a browser. */
  async toTerminalString(text: string): Promise<string> {
    return QRCode.toString(text, { type: 'terminal', small: true });
  }
}

/** qrcode wants #RRGGBBAA. */
function normaliseQrColor(input: string, defaultAlpha: string): string {
  let hex = input.trim().replace(/^#/, '');
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  if (hex.length === 6) hex += defaultAlpha;
  if (!/^[0-9a-fA-F]{8}$/.test(hex))
    return `#${defaultAlpha === 'ff' ? '000000' : 'ffffff'}${defaultAlpha}`;
  return `#${hex}`;
}
