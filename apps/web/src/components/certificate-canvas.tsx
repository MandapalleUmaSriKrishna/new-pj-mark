'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import {
  mergeTokensIn,
  sortElementsByZ,
  type ImageElement,
  type LineElement,
  type MergeValues,
  type QrElement,
  type RectElement,
  type SerialElement,
  type SignatureElement,
  type TemplateDoc,
  type TemplateElement,
  type TextElement,
} from '@kdc/shared';
import { cn } from '@/lib/utils';

/**
 * The on-screen certificate renderer.
 *
 * The template document is authored in PostScript points (see
 * `packages/shared/src/template.ts`), which is also exactly what the PDF engine
 * consumes. So this component draws the same coordinates as an HTML/CSS layer
 * tree scaled by `scale` - 1pt == 1px in document space - which keeps the
 * designer WYSIWYG against the generated PDF instead of being a second,
 * drifting renderer.
 */

const FONT_STACK: Record<string, string> = {
  Helvetica: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
  'Helvetica-Bold': 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
  'Helvetica-Oblique': 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
  'Helvetica-BoldOblique': 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
  'Times-Roman': 'Georgia, "Times New Roman", serif',
  'Times-Bold': 'Georgia, "Times New Roman", serif',
  'Times-Italic': 'Georgia, "Times New Roman", serif',
  'Times-BoldItalic': 'Georgia, "Times New Roman", serif',
  Courier: 'ui-monospace, "Courier New", monospace',
  'Courier-Bold': 'ui-monospace, "Courier New", monospace',
  'Courier-Oblique': 'ui-monospace, "Courier New", monospace',
  'Courier-BoldOblique': 'ui-monospace, "Courier New", monospace',
  Georgia: 'Georgia, serif',
  Palatino: '"Palatino Linotype", "Book Antiqua", Georgia, serif',
  Garamond: 'Garamond, "EB Garamond", Georgia, serif',
  'Trebuchet MS': '"Trebuchet MS", ui-sans-serif, sans-serif',
  Verdana: 'Verdana, ui-sans-serif, sans-serif',
};

export function fontStack(family: string): string {
  return FONT_STACK[family] ?? `"${family}", ${FONT_STACK.Helvetica}`;
}

/** A QR preview rendered in the browser from the same payload the PDF embeds. */
export function QrPreview({
  value,
  size,
  foreground,
  background,
  errorLevel,
  caption,
  captionFontSize,
  scale,
}: {
  value: string;
  size: number;
  foreground: string;
  background: string;
  errorLevel: 'L' | 'M' | 'Q' | 'H';
  caption?: string;
  captionFontSize?: number;
  scale: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value || ' ', {
      errorCorrectionLevel: errorLevel,
      margin: 1,
      width: Math.max(64, Math.round(size * 2)),
      color: { dark: foreground, light: background },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, errorLevel, size, foreground, background]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-1"
      style={{ width: size * scale, height: size * scale }}
    >
      {failed ? (
        <div className="grid h-full w-full place-items-center border border-dashed border-current text-[8px] opacity-60">
          QR unavailable
        </div>
      ) : dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR code encoding ${value}`}
          width={size * scale}
          height={size * scale}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-black/10" />
      )}
      {caption ? (
        <span
          style={{ fontSize: (captionFontSize ?? 8) * scale, color: foreground, lineHeight: 1.2 }}
        >
          {caption}
        </span>
      ) : null}
    </div>
  );
}

function textStyle(element: TextElement, values: MergeValues, scale: number): CSSProperties {
  const style: CSSProperties = {
    left: element.x * scale,
    top: element.y * scale,
    width: element.width * scale,
    height: element.height * scale,
    color: element.color,
    fontFamily: fontStack(element.fontFamily),
    fontSize: element.fontSize * scale,
    fontWeight: element.fontWeight,
    fontStyle: element.fontStyle,
    textAlign: element.align,
    lineHeight: element.lineHeight,
    letterSpacing: element.letterSpacing ? element.letterSpacing * scale : undefined,
    opacity: element.opacity ?? 1,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    display: 'flex',
    flexDirection: 'column',
    justifyContent:
      element.valign === 'top' ? 'flex-start' : element.valign === 'bottom' ? 'flex-end' : 'center',
    overflowWrap: 'break-word',
    whiteSpace: 'pre-wrap',
  };
  if (element.uppercase) style.textTransform = 'uppercase';
  void values;
  return style;
}

function ElementLayer({
  element,
  values,
  scale,
  selected,
  onSelect,
  assetUrls,
}: {
  element: TemplateElement;
  values: MergeValues;
  scale: number;
  selected: boolean;
  onSelect?: (id: string) => void;
  assetUrls: Record<string, string>;
}) {
  const common: CSSProperties = { position: 'absolute', zIndex: element.zIndex ?? 0 };
  const hidden = element.hidden === true;

  const wrapper = (
    inner: React.ReactNode,
    box: { x: number; y: number; width: number; height: number },
  ) => (
    <div
      key={element.id}
      style={{
        ...common,
        left: box.x * scale,
        top: box.y * scale,
        width: box.width * scale,
        height: box.height * scale,
        display: hidden ? 'none' : undefined,
      }}
      className={cn(
        onSelect && 'cursor-move',
        selected && 'outline outline-2 outline-offset-2 outline-[var(--kdc-brand)]',
      )}
      onPointerDown={
        onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect(element.id);
            }
          : undefined
      }
      role={onSelect ? 'button' : undefined}
      aria-label={onSelect ? `Element ${element.name ?? element.type}` : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(element.id);
              }
            }
          : undefined
      }
    >
      {inner}
    </div>
  );

  switch (element.type) {
    case 'text': {
      const text = mergeTokensIn(element.text, values);
      return wrapper(
        <div style={textStyle(element, values, scale)} className="h-full w-full">
          {text}
        </div>,
        { x: element.x, y: element.y, width: element.width, height: element.height },
      );
    }
    case 'rect': {
      const rect: RectElement = element;
      const gradient =
        rect.variant === 'gradient' && rect.gradientFrom && rect.gradientTo
          ? `linear-gradient(${rect.gradientAngle ?? 135}deg, ${rect.gradientFrom}, ${rect.gradientTo})`
          : undefined;
      const borderStyle: CSSProperties =
        rect.variant === 'double_border'
          ? {
              border: `${Math.max(1, rect.strokeWidth * scale)}px double ${rect.stroke ?? rect.fill}`,
              background: rect.fill === 'transparent' ? undefined : rect.fill,
            }
          : rect.variant === 'border'
            ? {
                border: `${Math.max(1, rect.strokeWidth * scale)}px solid ${rect.stroke ?? rect.fill}`,
                background: 'transparent',
              }
            : {
                background: gradient ?? rect.fill,
                border:
                  rect.strokeWidth > 0
                    ? `${rect.strokeWidth * scale}px solid ${rect.stroke ?? 'transparent'}`
                    : undefined,
              };
      return wrapper(
        <div
          className="h-full w-full"
          style={{
            ...borderStyle,
            borderRadius: rect.radius * scale,
            opacity: element.opacity ?? 1,
          }}
        />,
        {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      );
    }
    case 'line': {
      const line: LineElement = element;
      return wrapper(
        <div
          className="w-full"
          style={{
            height: Math.max(1, line.strokeWidth * scale),
            background: line.stroke,
            opacity: element.opacity ?? 1,
            ...(line.dash?.length
              ? {
                  backgroundImage: `repeating-linear-gradient(90deg, ${line.stroke} 0 ${4 * scale}px, transparent ${4 * scale}px ${8 * scale}px)`,
                  background: undefined,
                }
              : {}),
          }}
        />,
        { x: line.x, y: line.y, width: line.width, height: Math.max(line.height, 1) },
      );
    }
    case 'image': {
      const image: ImageElement = element;
      // `src` is either an https URL or an asset id; unresolved ids render a
      // labelled placeholder so a broken reference is visible, never silent.
      const resolved = resolveSrc(image.src, assetUrls);
      return wrapper(
        resolved ? (
          <img
            src={resolved}
            alt={image.alt ?? element.name ?? 'Certificate image'}
            className="h-full w-full"
            style={{
              objectFit: image.fit,
              borderRadius: (image.borderRadius ?? 0) * scale,
              opacity: element.opacity ?? 1,
            }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center border border-dashed border-ink-400 bg-ink-100/60 text-center text-[9px] text-ink-500 dark:bg-ink-800/40 dark:text-ink-300">
            image
            <br />
            {image.src.slice(0, 8)}…
          </div>
        ),
        { x: image.x, y: image.y, width: image.width, height: image.height },
      );
    }
    case 'qr': {
      const qr: QrElement = element;
      const value =
        qr.value === 'serial'
          ? mergeTokensIn('{{certificate.serial}}', values)
          : qr.value === 'custom'
            ? (qr.customValue ?? '')
            : ((values['verify.url'] as string) ?? 'https://verify.example/KDC-2026-SAMPLE-0');
      return wrapper(
        <QrPreview
          value={String(value)}
          size={qr.size}
          foreground={qr.foreground}
          background={qr.background}
          errorLevel={qr.errorLevel}
          caption={qr.caption}
          captionFontSize={qr.captionFontSize}
          scale={scale}
        />,
        { x: qr.x, y: qr.y, width: qr.size, height: qr.size },
      );
    }
    case 'signature': {
      const signature: SignatureElement = element;
      const resolved = signature.src ? resolveSrc(signature.src, assetUrls) : null;
      return wrapper(
        <div
          className="flex h-full w-full flex-col items-center justify-end"
          style={{
            fontFamily: fontStack(signature.fontFamily),
            color: signature.color,
            opacity: element.opacity ?? 1,
          }}
        >
          {signature.mode === 'image' && resolved ? (
            <img
              src={resolved}
              alt={signature.signatoryName ?? 'Signature'}
              className="max-h-[70%] max-w-full object-contain"
            />
          ) : signature.mode === 'image' ? (
            <div className="grid h-[60%] w-3/4 place-items-center border-b border-dashed border-ink-400 text-[8px] text-ink-400">
              signature image
            </div>
          ) : (
            <span style={{ fontSize: signature.fontSize * scale, fontStyle: 'italic' }}>
              {signature.signatoryName ?? 'Signatory'}
            </span>
          )}
          {signature.showRule ? (
            <div
              className="mt-1 w-4/5"
              style={{ height: Math.max(1, scale), background: signature.ruleColor }}
            />
          ) : null}
          {signature.signatoryName && signature.mode !== 'text' ? (
            <span style={{ fontSize: signature.fontSize * scale }} className="mt-0.5">
              {signature.signatoryName}
            </span>
          ) : null}
          {signature.signatoryTitle ? (
            <span style={{ fontSize: signature.fontSize * scale * 0.9 }} className="opacity-80">
              {signature.signatoryTitle}
            </span>
          ) : null}
        </div>,
        { x: signature.x, y: signature.y, width: signature.width, height: signature.height },
      );
    }
    case 'serial': {
      const serial: SerialElement = element;
      return wrapper(
        <div
          className="flex h-full w-full flex-col"
          style={{
            fontFamily: fontStack(serial.fontFamily),
            color: serial.color,
            fontSize: serial.fontSize * scale,
            textAlign: serial.align,
            alignItems:
              serial.align === 'center'
                ? 'center'
                : serial.align === 'right'
                  ? 'flex-end'
                  : 'flex-start',
            justifyContent: 'center',
            opacity: element.opacity ?? 1,
          }}
        >
          {serial.showLabel ? (
            <span
              className="uppercase tracking-widest"
              style={{ fontSize: serial.fontSize * scale * 0.85 }}
            >
              {serial.label}
            </span>
          ) : null}
          <span className="font-bold tracking-wider">
            {(values['certificate.serial'] as string) ?? 'KDC-0000-SAMPLE-0'}
          </span>
        </div>,
        { x: serial.x, y: serial.y, width: serial.width, height: serial.height },
      );
    }
    default:
      return null;
  }
}

/** Maps an uploaded asset id to its short-lived signed URL for on-screen display. */
function resolveSrc(src: string, assetUrls: Record<string, string>): string | null {
  if (src.startsWith('http') || src.startsWith('blob:') || src.startsWith('/')) return src;
  return assetUrls[src] ?? null;
}

export interface CertificateCanvasProps {
  doc: TemplateDoc;
  /** asset id -> signed url, so uploaded images render on the canvas. */
  assetUrls?: Record<string, string>;
  /** Pixels per point. 1 renders at true PDF size. */
  scale?: number;
  values?: MergeValues;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
  showGuides?: boolean;
}

/** Sample merge values so a design can be previewed before any recipient exists. */
export const SAMPLE_VALUES: MergeValues = {
  'recipient.name': 'Jane Q. Public',
  'recipient.first_name': 'Jane',
  'recipient.last_name': 'Public',
  'recipient.email': 'jane.public@example.edu',
  'recipient.title': 'Graduate',
  'recipient.department': 'Computer Science',
  'recipient.roll_number': '21BCE1234',
  'recipient.grade': '9.4 CGPA',
  'recipient.hours': '40',
  'event.name': 'Annual Convocation 2026',
  'event.description': 'Awarded for academic excellence',
  'event.date': '12 October 2026',
  'event.venue': 'Main Auditorium',
  'certificate.serial': 'KDC-2026-7QK3M9XA-4',
  'certificate.issued_at': '12 October 2026',
  'certificate.year': '2026',
  'tenant.name': 'Krishna Institute',
  'tenant.tagline': 'Excellence in Education',
  'verify.url': 'https://kdc.example/verify/KDC-2026-7QK3M9XA-4',
};

export function CertificateCanvas({
  doc,
  scale = 1,
  values = SAMPLE_VALUES,
  selectedId = null,
  onSelect,
  className,
  showGuides,
  assetUrls = {},
}: CertificateCanvasProps) {
  const elements = useMemo(() => sortElementsByZ(doc.elements), [doc.elements]);
  const page = doc.page;
  const background = page.backgroundSrc ? resolveSrc(page.backgroundSrc, assetUrls) : null;

  return (
    <div
      className={cn(
        'relative overflow-hidden shadow-[var(--shadow-pop)]',
        showGuides && page.showGuides !== false && 'kdc-grid-lines',
        className,
      )}
      style={{
        width: page.width * scale,
        height: page.height * scale,
        background: page.background,
      }}
      onPointerDown={onSelect ? () => onSelect(null) : undefined}
      aria-label="Certificate page"
    >
      {background ? (
        <img
          src={background}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: page.backgroundOpacity }}
        />
      ) : null}
      {elements.map((element) => (
        <ElementLayer
          key={element.id}
          element={element}
          values={values}
          scale={scale}
          selected={selectedId === element.id}
          onSelect={onSelect}
          assetUrls={assetUrls}
        />
      ))}
    </div>
  );
}
