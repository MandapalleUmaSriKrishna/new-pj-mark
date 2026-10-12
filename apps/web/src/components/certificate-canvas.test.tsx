import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { STARTER_DESIGNS, mergeTokensIn, usedMergeTokens } from '@kdc/shared';
import { CertificateCanvas, SAMPLE_VALUES, fontStack } from './certificate-canvas';

/**
 * The canvas is the WYSIWYG half of the PDF pipeline: it renders the same
 * document schema the server renders to PDF. These tests pin that every
 * starter design renders every element type it declares, that merge tokens are
 * substituted, and that geometry scales linearly (1pt == 1px * scale).
 */

describe('certificate canvas', () => {
  it('renders every starter design without throwing', () => {
    for (const design of STARTER_DESIGNS) {
      const { unmount } = render(<CertificateCanvas doc={design.build()} scale={0.5} />);
      expect(screen.getByLabelText('Certificate page')).toBeInTheDocument();
      unmount();
    }
  });

  it('scales the page and elements linearly with zoom', () => {
    const doc = STARTER_DESIGNS[0]!.build();
    const { container } = render(<CertificateCanvas doc={doc} scale={0.5} />);
    const page = container.firstElementChild as HTMLElement;
    expect(page.style.width).toBe(`${doc.page.width * 0.5}px`);
    expect(page.style.height).toBe(`${doc.page.height * 0.5}px`);
  });

  it('substitutes merge tokens in text elements at render time', () => {
    const doc = {
      version: 1 as const,
      page: {
        width: 400,
        height: 300,
        preset: 'custom' as const,
        background: '#ffffff',
        backgroundOpacity: 1,
        showGuides: false,
        dpi: 150,
      },
      elements: [
        {
          id: 't1',
          type: 'text' as const,
          x: 10,
          y: 10,
          width: 200,
          height: 30,
          text: 'Hello {{recipient.name}} ({{certificate.serial}})',
          fontFamily: 'Helvetica',
          fontSize: 12,
          fontWeight: 'normal' as const,
          fontStyle: 'normal' as const,
          color: '#000000',
          align: 'left' as const,
          valign: 'middle' as const,
          lineHeight: 1.2,
          letterSpacing: 0,
        },
      ],
    };
    render(
      <CertificateCanvas
        doc={doc}
        scale={1}
        values={{ ...SAMPLE_VALUES, 'recipient.name': 'Test Person' }}
      />,
    );
    expect(screen.getByText(/Hello Test Person/)).toBeInTheDocument();
    expect(screen.getByText(/KDC-2026-7QK3M9XA-4/)).toBeInTheDocument();
  });

  it('keeps unknown tokens visible rather than blanking them', () => {
    expect(mergeTokensIn('Value: {{not.a.field}}', {})).toBe('Value: {{not.a.field}}');
    expect(usedMergeTokens('a {{A.B}} c {{ a.b }}')).toEqual(['a.b']);
  });

  it('hides elements flagged hidden and shows placeholders for unresolved assets', () => {
    const doc = {
      version: 1 as const,
      page: {
        width: 400,
        height: 300,
        preset: 'custom' as const,
        background: '#ffffff',
        backgroundOpacity: 1,
        showGuides: false,
        dpi: 150,
      },
      elements: [
        {
          id: 'i1',
          type: 'image' as const,
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          src: 'asset_123',
          fit: 'contain' as const,
        },
        {
          id: 't2',
          type: 'text' as const,
          x: 0,
          y: 60,
          width: 50,
          height: 20,
          text: 'hidden',
          fontFamily: 'Helvetica',
          fontSize: 10,
          fontWeight: 'normal' as const,
          fontStyle: 'normal' as const,
          color: '#000',
          align: 'left' as const,
          valign: 'top' as const,
          lineHeight: 1,
          letterSpacing: 0,
          hidden: true,
        },
      ],
    };
    render(<CertificateCanvas doc={doc} scale={1} />);
    expect(screen.getByText(/asset_12/)).toBeInTheDocument();
  });

  it('maps PDF font names to browser stacks', () => {
    expect(fontStack('Times-Roman')).toContain('Georgia');
    expect(fontStack('Courier-Bold')).toContain('monospace');
    expect(fontStack('Some Custom Font')).toContain('Some Custom Font');
  });
});
