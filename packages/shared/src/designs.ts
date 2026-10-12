import { PAGE_PRESETS } from './template';
import type { TemplateDoc, TemplateElement } from './template';

/**
 * Built-in starter designs. These are real, complete template documents - the
 * same JSON a user would produce in the designer - so a brand new tenant gets a
 * usable certificate in one click instead of an empty canvas.
 */

let seq = 0;
const id = (p: string) => `${p}${(seq += 1)}`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function text(
  box: Box,
  value: string,
  o: Partial<TemplateElement & { type: 'text' }> = {},
): TemplateElement {
  return {
    id: id('t'),
    type: 'text',
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    text: value,
    fontFamily: 'Helvetica',
    fontSize: 18,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#111827',
    align: 'center',
    valign: 'middle',
    lineHeight: 1.3,
    letterSpacing: 0,
    ...o,
  } as TemplateElement;
}

function rect(box: Box, o: Record<string, unknown> = {}): TemplateElement {
  return {
    id: id('r'),
    type: 'rect',
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    fill: '#ffffff',
    strokeWidth: 0,
    radius: 0,
    variant: 'solid',
    ...o,
  } as TemplateElement;
}

function line(box: Box, o: Record<string, unknown> = {}): TemplateElement {
  return {
    id: id('l'),
    type: 'line',
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    stroke: '#111827',
    strokeWidth: 1,
    ...o,
  } as TemplateElement;
}

function qr(
  box: { x: number; y: number; s: number },
  o: Record<string, unknown> = {},
): TemplateElement {
  return {
    id: id('q'),
    type: 'qr',
    x: box.x,
    y: box.y,
    size: box.s,
    value: 'verify_url',
    foreground: '#111827',
    background: '#ffffff',
    errorLevel: 'M',
    ...o,
  } as TemplateElement;
}

function signature(box: Box, o: Record<string, unknown> = {}): TemplateElement {
  return {
    id: id('s'),
    type: 'signature',
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    mode: 'image',
    showRule: true,
    ruleColor: '#374151',
    fontFamily: 'Times-Roman',
    fontSize: 11,
    color: '#111827',
    ...o,
  } as TemplateElement;
}

function serialEl(box: Box, o: Record<string, unknown> = {}): TemplateElement {
  return {
    id: id('id'),
    type: 'serial',
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    label: 'Certificate ID',
    showLabel: true,
    fontFamily: 'Courier-Bold',
    fontSize: 10,
    color: '#374151',
    align: 'center',
    ...o,
  } as TemplateElement;
}

function page(preset: keyof typeof PAGE_PRESETS, background = '#ffffff') {
  const p = PAGE_PRESETS[preset];
  return {
    width: p.width,
    height: p.height,
    preset: preset as TemplateDoc['page']['preset'],
    background,
    backgroundOpacity: 1,
    showGuides: true,
    dpi: 150,
  };
}

function doc(
  preset: keyof typeof PAGE_PRESETS,
  elements: TemplateElement[],
  background = '#ffffff',
): TemplateDoc {
  return { version: 1, page: page(preset, background), elements };
}

/** 1. Classic convocation: double rule frame, serif, centred. */
export function classicConvocation(): TemplateDoc {
  const W = 842,
    H = 595;
  return doc('a4_landscape', [
    rect({ x: 0, y: 0, w: W, h: H }, { fill: '#fdfcf9' }),
    rect(
      { x: 24, y: 24, w: W - 48, h: H - 48 },
      { variant: 'double_border', stroke: '#1f3a5f', strokeWidth: 2, fill: 'transparent' },
    ),
    text({ x: 60, y: 52, w: W - 120, h: 26 }, '{{tenant.name}}', {
      fontFamily: 'Times-Bold',
      fontSize: 20,
      color: '#1f3a5f',
      letterSpacing: 2,
    }),
    text({ x: 60, y: 80, w: W - 120, h: 18 }, '{{tenant.tagline}}', {
      fontFamily: 'Times-Italic',
      fontSize: 11,
      color: '#6b7280',
    }),
    line({ x: 200, y: 112, w: W - 400, h: 0 }, { stroke: '#c8a44d', strokeWidth: 1 }),
    text({ x: 40, y: 126, w: W - 80, h: 52 }, 'CERTIFICATE OF ACHIEVEMENT', {
      fontFamily: 'Times-Bold',
      fontSize: 34,
      color: '#111827',
      letterSpacing: 2,
      uppercase: true,
    }),
    text({ x: 60, y: 186, w: W - 120, h: 20 }, 'This certificate is proudly presented to', {
      fontFamily: 'Times-Italic',
      fontSize: 13,
      color: '#4b5563',
    }),
    text({ x: 60, y: 214, w: W - 120, h: 56 }, '{{recipient.name}}', {
      fontFamily: 'Times-Bold',
      fontSize: 40,
      color: '#1f3a5f',
    }),
    line({ x: 231, y: 274, w: 380, h: 0 }, { stroke: '#c8a44d', strokeWidth: 1.5 }),
    text(
      { x: 120, y: 284, w: W - 240, h: 50 },
      'for successfully completing {{event.name}} and demonstrating outstanding performance.',
      { fontFamily: 'Times-Roman', fontSize: 14, color: '#374151', lineHeight: 1.5 },
    ),
    text({ x: 120, y: 334, w: W - 240, h: 20 }, '{{event.description}}', {
      fontFamily: 'Times-Italic',
      fontSize: 11,
      color: '#6b7280',
    }),
    text({ x: 300, y: 372, w: 242, h: 20 }, '{{recipient.department}}', {
      fontFamily: 'Times-Roman',
      fontSize: 12,
      color: '#4b5563',
    }),
    text({ x: 300, y: 394, w: 242, h: 18 }, 'Grade: {{recipient.grade}}', {
      fontFamily: 'Times-Roman',
      fontSize: 11,
      color: '#6b7280',
    }),
    signature(
      { x: 100, y: 430, w: 190, h: 70 },
      { signatoryName: 'Dr. R. Krishnan', signatoryTitle: 'Principal' },
    ),
    signature(
      { x: 552, y: 430, w: 190, h: 70 },
      { signatoryName: 'Prof. S. Anand', signatoryTitle: 'Controller of Examinations' },
    ),
    qr(
      { x: 356, y: 428, s: 74 },
      { caption: 'Scan to verify', captionFontSize: 7, foreground: '#1f3a5f' },
    ),
    serialEl({ x: 60, y: 528, w: 300, h: 18 }, { align: 'left', color: '#6b7280' }),
    text({ x: 482, y: 528, w: 300, h: 18 }, 'Issued {{certificate.issued_at}}', {
      fontFamily: 'Times-Roman',
      fontSize: 9,
      color: '#6b7280',
      align: 'right',
    }),
  ]);
}

/** 2. Modern corporate: left accent bar, sans-serif, generous whitespace. */
export function modernCorporate(): TemplateDoc {
  const W = 842,
    H = 595;
  return doc('a4_landscape', [
    rect({ x: 0, y: 0, w: W, h: H }, { fill: '#ffffff' }),
    rect({ x: 0, y: 0, w: 14, h: H }, { fill: '#2563eb' }),
    rect({ x: 0, y: 0, w: W, h: 4 }, { fill: '#2563eb' }),
    text({ x: 60, y: 56, w: 400, h: 24 }, '{{tenant.name}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 18,
      color: '#0f172a',
      align: 'left',
    }),
    text({ x: 60, y: 82, w: 400, h: 16 }, '{{tenant.tagline}}', {
      fontFamily: 'Helvetica',
      fontSize: 10,
      color: '#64748b',
      align: 'left',
    }),
    text({ x: 60, y: 150, w: 700, h: 22 }, 'CERTIFICATE OF COMPLETION', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 14,
      color: '#2563eb',
      align: 'left',
      letterSpacing: 6,
    }),
    text({ x: 60, y: 182, w: 700, h: 54 }, '{{recipient.name}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 42,
      color: '#0f172a',
      align: 'left',
    }),
    line({ x: 60, y: 250, w: 300, h: 0 }, { stroke: '#2563eb', strokeWidth: 3 }),
    text(
      { x: 60, y: 268, w: 620, h: 44 },
      'has successfully completed {{event.name}} on {{event.date}}.',
      { fontFamily: 'Helvetica', fontSize: 15, color: '#334155', align: 'left', lineHeight: 1.6 },
    ),
    rect({ x: 60, y: 330, w: 250, h: 66 }, { fill: '#f1f5f9', radius: 8 }),
    text({ x: 74, y: 342, w: 222, h: 16 }, 'DEPARTMENT', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 8,
      color: '#64748b',
      align: 'left',
      letterSpacing: 2,
    }),
    text({ x: 74, y: 360, w: 222, h: 24 }, '{{recipient.department}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 14,
      color: '#0f172a',
      align: 'left',
    }),
    rect({ x: 326, y: 330, w: 250, h: 66 }, { fill: '#f1f5f9', radius: 8 }),
    text({ x: 340, y: 342, w: 222, h: 16 }, 'EMPLOYEE / ROLL NO.', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 8,
      color: '#64748b',
      align: 'left',
      letterSpacing: 2,
    }),
    text({ x: 340, y: 360, w: 222, h: 24 }, '{{recipient.roll_number}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 14,
      color: '#0f172a',
      align: 'left',
    }),
    signature(
      { x: 60, y: 440, w: 200, h: 70 },
      {
        signatoryName: 'Authorised Signatory',
        signatoryTitle: '{{tenant.name}}',
        ruleColor: '#2563eb',
      },
    ),
    qr(
      { x: 640, y: 430, s: 84 },
      { foreground: '#0f172a', caption: 'Verify authenticity', captionFontSize: 7 },
    ),
    serialEl(
      { x: 60, y: 540, w: 320, h: 18 },
      { align: 'left', color: '#94a3b8', fontFamily: 'Courier-Bold', fontSize: 9 },
    ),
    text({ x: 400, y: 540, w: 380, h: 18 }, '{{verify.url}}', {
      fontFamily: 'Helvetica',
      fontSize: 8,
      color: '#94a3b8',
      align: 'right',
    }),
  ]);
}

/** 3. Workshop / training: bold, hours and grade prominent. */
export function workshopTraining(): TemplateDoc {
  const W = 842,
    H = 595;
  return doc('a4_landscape', [
    rect({ x: 0, y: 0, w: W, h: H }, { fill: '#0f172a' }),
    rect(
      { x: 0, y: 0, w: W, h: 190 },
      {
        variant: 'gradient',
        fill: 'transparent',
        gradientFrom: '#7c3aed',
        gradientTo: '#db2777',
        gradientAngle: 120,
      },
    ),
    text({ x: 60, y: 40, w: 722, h: 20 }, '{{tenant.name}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 15,
      color: '#ffffff',
      align: 'left',
      letterSpacing: 3,
    }),
    text({ x: 60, y: 74, w: 722, h: 52 }, 'WORKSHOP CERTIFICATE', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 40,
      color: '#ffffff',
      align: 'left',
      letterSpacing: 1,
    }),
    text(
      { x: 60, y: 134, w: 722, h: 24 },
      '{{event.name}}  ·  {{event.date}}  ·  {{event.venue}}',
      { fontFamily: 'Helvetica', fontSize: 12, color: '#f5d0fe', align: 'left' },
    ),
    text({ x: 60, y: 216, w: 722, h: 18 }, 'AWARDED TO', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 10,
      color: '#a78bfa',
      align: 'left',
      letterSpacing: 4,
    }),
    text({ x: 60, y: 239, w: 722, h: 62 }, '{{recipient.name}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 44,
      color: '#ffffff',
      align: 'left',
    }),
    text(
      { x: 60, y: 312, w: 460, h: 60 },
      'in recognition of active participation and successful completion of the {{recipient.hours}}-hour hands-on programme.',
      { fontFamily: 'Helvetica', fontSize: 13, color: '#cbd5e1', align: 'left', lineHeight: 1.6 },
    ),
    rect(
      { x: 560, y: 226, w: 100, h: 100 },
      { fill: '#1e293b', radius: 12, stroke: '#7c3aed', strokeWidth: 1 },
    ),
    text({ x: 560, y: 244, w: 100, h: 38 }, '{{recipient.hours}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 26,
      color: '#ffffff',
    }),
    text({ x: 560, y: 284, w: 100, h: 16 }, 'HOURS', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 8,
      color: '#a78bfa',
      letterSpacing: 2,
    }),
    rect(
      { x: 676, y: 226, w: 106, h: 100 },
      { fill: '#1e293b', radius: 12, stroke: '#7c3aed', strokeWidth: 1 },
    ),
    text({ x: 676, y: 248, w: 106, h: 30 }, '{{recipient.grade}}', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 22,
      color: '#ffffff',
    }),
    text({ x: 676, y: 284, w: 106, h: 16 }, 'GRADE', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 8,
      color: '#a78bfa',
      letterSpacing: 2,
    }),
    line({ x: 60, y: 470, w: 220, h: 0 }, { stroke: '#475569', strokeWidth: 1 }),
    text({ x: 60, y: 480, w: 220, h: 16 }, 'Programme Director', {
      fontFamily: 'Helvetica',
      fontSize: 10,
      color: '#94a3b8',
      align: 'left',
    }),
    signature(
      { x: 60, y: 400, w: 220, h: 66 },
      { mode: 'image', signatoryName: '', signatoryTitle: '', showRule: false },
    ),
    qr(
      { x: 640, y: 400, s: 88 },
      {
        foreground: '#ffffff',
        background: '#0f172a',
        caption: 'Verify certificate',
        captionFontSize: 7,
      },
    ),
    serialEl({ x: 60, y: 528, w: 400, h: 18 }, { align: 'left', color: '#64748b', fontSize: 9 }),
    text({ x: 460, y: 528, w: 322, h: 18 }, 'Issued {{certificate.issued_at}}', {
      fontFamily: 'Helvetica',
      fontSize: 9,
      color: '#64748b',
      align: 'right',
    }),
  ]);
}

/** 4. School appreciation: warm, friendly, portrait-friendly. */
export function schoolAppreciation(): TemplateDoc {
  const W = 842,
    H = 595;
  return doc(
    'a4_landscape',
    [
      rect({ x: 0, y: 0, w: W, h: H }, { fill: '#fffbeb' }),
      rect(
        { x: 18, y: 18, w: W - 36, h: H - 36 },
        { variant: 'border', stroke: '#f59e0b', strokeWidth: 6, fill: 'transparent', radius: 18 },
      ),
      rect(
        { x: 34, y: 34, w: W - 68, h: H - 68 },
        { variant: 'border', stroke: '#fbbf24', strokeWidth: 1.5, fill: 'transparent', radius: 12 },
      ),
      text({ x: 60, y: 62, w: W - 120, h: 24 }, '{{tenant.name}}', {
        fontFamily: 'Helvetica-Bold',
        fontSize: 18,
        color: '#92400e',
      }),
      text({ x: 60, y: 88, w: W - 120, h: 50 }, 'Certificate of Appreciation', {
        fontFamily: 'Georgia',
        fontSize: 34,
        color: '#b45309',
        fontStyle: 'italic',
      }),
      text({ x: 60, y: 150, w: W - 120, h: 20 }, 'This certificate is awarded to', {
        fontFamily: 'Helvetica',
        fontSize: 12,
        color: '#78350f',
      }),
      text({ x: 60, y: 182, w: W - 120, h: 52 }, '{{recipient.name}}', {
        fontFamily: 'Helvetica-Bold',
        fontSize: 38,
        color: '#7c2d12',
      }),
      text(
        { x: 120, y: 246, w: W - 240, h: 54 },
        'for {{event.description}} during {{event.name}}.',
        {
          fontFamily: 'Georgia',
          fontSize: 15,
          color: '#92400e',
          lineHeight: 1.5,
          fontStyle: 'italic',
        },
      ),
      text(
        { x: 120, y: 306, w: W - 240, h: 20 },
        'Class {{recipient.department}}  ·  Roll No. {{recipient.roll_number}}',
        { fontFamily: 'Helvetica', fontSize: 11, color: '#a16207' },
      ),
      signature(
        { x: 110, y: 400, w: 190, h: 74 },
        {
          signatoryName: 'Class Teacher',
          signatoryTitle: '{{tenant.name}}',
          ruleColor: '#b45309',
          color: '#78350f',
        },
      ),
      signature(
        { x: 542, y: 400, w: 190, h: 74 },
        {
          signatoryName: 'Principal',
          signatoryTitle: '{{tenant.name}}',
          ruleColor: '#b45309',
          color: '#78350f',
        },
      ),
      qr(
        { x: 366, y: 396, s: 78 },
        { foreground: '#78350f', background: '#fffbeb', caption: 'Verify', captionFontSize: 7 },
      ),
      serialEl({ x: 60, y: 520, w: 300, h: 18 }, { align: 'left', color: '#a16207', fontSize: 9 }),
      text({ x: 482, y: 520, w: 300, h: 18 }, '{{event.date}}', {
        fontFamily: 'Helvetica',
        fontSize: 9,
        color: '#a16207',
        align: 'right',
      }),
    ],
    '#fffbeb',
  );
}

/** 5. Government / official: formal, seal block, reference number. */
export function governmentOfficial(): TemplateDoc {
  const W = 595,
    H = 842;
  return doc('a4_portrait', [
    rect({ x: 0, y: 0, w: W, h: H }, { fill: '#ffffff' }),
    rect(
      { x: 20, y: 20, w: W - 40, h: H - 40 },
      { variant: 'border', stroke: '#14532d', strokeWidth: 2, fill: 'transparent' },
    ),
    rect({ x: 28, y: 28, w: W - 56, h: 96 }, { fill: '#f0fdf4' }),
    text({ x: 60, y: 44, w: W - 120, h: 22 }, '{{tenant.name}}', {
      fontFamily: 'Times-Bold',
      fontSize: 17,
      color: '#14532d',
      letterSpacing: 1,
    }),
    text({ x: 60, y: 70, w: W - 120, h: 16 }, '{{tenant.tagline}}', {
      fontFamily: 'Times-Italic',
      fontSize: 10,
      color: '#3f6212',
    }),
    text({ x: 60, y: 92, w: W - 120, h: 16 }, 'Ref: {{certificate.serial}}', {
      fontFamily: 'Courier',
      fontSize: 9,
      color: '#4d7c0f',
    }),
    text({ x: 60, y: 156, w: W - 120, h: 40 }, 'CERTIFICATE', {
      fontFamily: 'Times-Bold',
      fontSize: 28,
      color: '#111827',
      letterSpacing: 6,
    }),
    line({ x: 180, y: 200, w: W - 360, h: 0 }, { stroke: '#14532d', strokeWidth: 1 }),
    text({ x: 60, y: 220, w: W - 120, h: 20 }, 'This is to certify that', {
      fontFamily: 'Times-Italic',
      fontSize: 12,
      color: '#374151',
    }),
    text({ x: 60, y: 250, w: W - 120, h: 40 }, '{{recipient.name}}', {
      fontFamily: 'Times-Bold',
      fontSize: 26,
      color: '#14532d',
    }),
    text({ x: 60, y: 300, w: W - 120, h: 20 }, '{{recipient.title}}, {{recipient.department}}', {
      fontFamily: 'Times-Roman',
      fontSize: 12,
      color: '#374151',
    }),
    text(
      { x: 70, y: 340, w: W - 140, h: 90 },
      'has satisfactorily completed the programme "{{event.name}}" conducted at {{event.venue}} on {{event.date}}, and is awarded this certificate in official recognition of the same.',
      { fontFamily: 'Times-Roman', fontSize: 13, color: '#1f2937', lineHeight: 1.7 },
    ),
    rect(
      { x: 70, y: 450, w: W - 140, h: 76 },
      { fill: '#f9fafb', radius: 4, stroke: '#e5e7eb', strokeWidth: 1 },
    ),
    text({ x: 84, y: 462, w: 200, h: 14 }, 'IDENTIFICATION NO.', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 7,
      color: '#6b7280',
      align: 'left',
      letterSpacing: 2,
    }),
    text({ x: 84, y: 480, w: 200, h: 20 }, '{{recipient.roll_number}}', {
      fontFamily: 'Courier-Bold',
      fontSize: 14,
      color: '#111827',
      align: 'left',
    }),
    text({ x: 300, y: 462, w: 200, h: 14 }, 'GRADE / RESULT', {
      fontFamily: 'Helvetica-Bold',
      fontSize: 7,
      color: '#6b7280',
      align: 'left',
      letterSpacing: 2,
    }),
    text({ x: 300, y: 480, w: 200, h: 20 }, '{{recipient.grade}}', {
      fontFamily: 'Courier-Bold',
      fontSize: 14,
      color: '#111827',
      align: 'left',
    }),
    signature(
      { x: 70, y: 620, w: 180, h: 90 },
      {
        signatoryName: 'Issuing Authority',
        signatoryTitle: '{{tenant.name}}',
        ruleColor: '#14532d',
      },
    ),
    signature(
      { x: 345, y: 620, w: 180, h: 90 },
      {
        signatoryName: 'Head of Department',
        signatoryTitle: '{{recipient.department}}',
        ruleColor: '#14532d',
      },
    ),
    qr(
      { x: 247, y: 600, s: 100 },
      { foreground: '#14532d', caption: 'Official verification', captionFontSize: 7 },
    ),
    text(
      { x: 60, y: 742, w: W - 120, h: 16 },
      'This certificate is electronically generated and does not require a physical signature.',
      { fontFamily: 'Times-Italic', fontSize: 8, color: '#6b7280' },
    ),
    serialEl({ x: 60, y: 766, w: W - 120, h: 18 }, { color: '#6b7280', fontSize: 9 }),
  ]);
}

/** 6. Minimal dark: high contrast, contemporary. */
export function minimalDark(): TemplateDoc {
  const W = 842,
    H = 595;
  return doc(
    'a4_landscape',
    [
      rect({ x: 0, y: 0, w: W, h: H }, { fill: '#09090b' }),
      line({ x: 60, y: 100, w: 120, h: 0 }, { stroke: '#e4e4e7', strokeWidth: 2 }),
      text({ x: 60, y: 120, w: 400, h: 18 }, '{{tenant.name}}', {
        fontFamily: 'Helvetica',
        fontSize: 12,
        color: '#a1a1aa',
        align: 'left',
        letterSpacing: 4,
      }),
      text({ x: 60, y: 190, w: 500, h: 64 }, 'Certificate', {
        fontFamily: 'Helvetica-Bold',
        fontSize: 46,
        color: '#fafafa',
        align: 'left',
      }),
      text({ x: 60, y: 260, w: 500, h: 20 }, 'presented to', {
        fontFamily: 'Helvetica',
        fontSize: 12,
        color: '#71717a',
        align: 'left',
      }),
      text({ x: 60, y: 290, w: 560, h: 44 }, '{{recipient.name}}', {
        fontFamily: 'Helvetica-Bold',
        fontSize: 32,
        color: '#fafafa',
        align: 'left',
      }),
      text({ x: 60, y: 356, w: 520, h: 40 }, '{{event.name}} — {{event.date}}', {
        fontFamily: 'Helvetica',
        fontSize: 13,
        color: '#a1a1aa',
        align: 'left',
        lineHeight: 1.6,
      }),
      rect({ x: 60, y: 420, w: 200, h: 1 }, { fill: '#27272a' }),
      text({ x: 60, y: 432, w: 200, h: 16 }, 'Authorised signatory', {
        fontFamily: 'Helvetica',
        fontSize: 9,
        color: '#71717a',
        align: 'left',
      }),
      qr({ x: 682, y: 400, s: 100 }, { foreground: '#fafafa', background: '#09090b' }),
      serialEl(
        { x: 60, y: 520, w: 400, h: 18 },
        { align: 'left', color: '#52525b', fontSize: 9, label: 'ID' },
      ),
      text({ x: 500, y: 520, w: 282, h: 18 }, '{{verify.url}}', {
        fontFamily: 'Courier',
        fontSize: 8,
        color: '#52525b',
        align: 'right',
      }),
    ],
    '#09090b',
  );
}

export interface StarterDesign {
  key: string;
  name: string;
  category: string;
  description: string;
  accent: string;
  build: () => TemplateDoc;
}

export const STARTER_DESIGNS: StarterDesign[] = [
  {
    key: 'classic-convocation',
    name: 'Classic Convocation',
    category: 'College',
    description:
      'Double-rule frame with serif type - the traditional degree and convocation certificate.',
    accent: '#1f3a5f',
    build: classicConvocation,
  },
  {
    key: 'modern-corporate',
    name: 'Modern Corporate',
    category: 'Company',
    description: 'Clean sans-serif layout with an accent bar and metric cards for HR and L&D.',
    accent: '#2563eb',
    build: modernCorporate,
  },
  {
    key: 'workshop-training',
    name: 'Workshop & Training',
    category: 'Training institute',
    description: 'Bold dark canvas highlighting duration and grade for bootcamps and workshops.',
    accent: '#7c3aed',
    build: workshopTraining,
  },
  {
    key: 'school-appreciation',
    name: 'School Appreciation',
    category: 'School',
    description: 'Warm rounded frame for participation, merit and appreciation awards.',
    accent: '#f59e0b',
    build: schoolAppreciation,
  },
  {
    key: 'government-official',
    name: 'Government / Official',
    category: 'Government',
    description: 'Formal portrait layout with reference number and dual signatories.',
    accent: '#14532d',
    build: governmentOfficial,
  },
  {
    key: 'minimal-dark',
    name: 'Minimal Dark',
    category: 'Event',
    description: 'High-contrast contemporary design for events, hackathons and communities.',
    accent: '#09090b',
    build: minimalDark,
  },
];
