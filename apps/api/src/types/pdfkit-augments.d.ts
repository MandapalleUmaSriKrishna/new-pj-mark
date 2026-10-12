/**
 * Type augmentations for `@types/pdfkit`.
 *
 * The published type package targets pdfkit 0.17 while this project runs 0.20.
 * Three members that exist at runtime (verified against js/pdfkit.js) are missing
 * from the declarations:
 *
 *   - `PDFLinearGradient` as an argument to `fill()`
 *   - the `valign` text option ('top' | 'center' | 'bottom')
 *   - the `characterSpacing` text option
 *
 * They are declared here once, narrowly, rather than casting to `any` at each
 * call site. If @types/pdfkit catches up this file can simply be deleted.
 */
import type PDFDocument from 'pdfkit';

declare module 'pdfkit/js/pdfkit' {
  interface PDFDocument {
    fill(color?: unknown, rule?: string): this;
  }
}

declare global {
  namespace PDFKit {
    namespace Mixins {
      interface TextOptions {
        valign?: 'top' | 'center' | 'bottom';
        characterSpacing?: number;
      }
    }
  }
}

export type AugmentedPdfDocument = PDFDocument;
