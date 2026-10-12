import type { TenantBranding } from '@kdc/shared';
import type { CSSProperties } from 'react';

/**
 * White-label branding.
 *
 * Tenant colours are applied as CSS custom properties on the dashboard shell, so
 * the same components render in each organisation's palette without a rebuild.
 * The values are validated before use: a tenant cannot inject arbitrary CSS
 * through a branding field, because only a hex colour ever reaches `style`.
 */

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const DEFAULT_BRAND = '#1d40f0';
export const DEFAULT_ACCENT = '#d4a94a';

export function isSafeColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

/** Black or white text, whichever contrasts better with `hex` (WCAG-ish). */
export function readableInk(hex: string): string {
  const value = hex.replace('#', '').trim();
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#ffffff';
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  // Relative luminance (sRGB) as defined by WCAG 2.1.
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? '#14171f' : '#ffffff';
}

export function brandVars(branding: TenantBranding | null | undefined): CSSProperties {
  const primary = isSafeColor(branding?.primaryColor)
    ? branding.primaryColor.trim()
    : DEFAULT_BRAND;
  const accent = isSafeColor(branding?.accentColor)
    ? branding.accentColor.trim()
    : isSafeColor(branding?.secondaryColor)
      ? branding.secondaryColor.trim()
      : DEFAULT_ACCENT;
  return {
    ['--kdc-brand' as string]: primary,
    ['--kdc-brand-ink' as string]: readableInk(primary),
    ['--kdc-accent' as string]: accent,
  } as CSSProperties;
}

export function brandColors(branding: TenantBranding | null | undefined): {
  primary: string;
  accent: string;
  ink: string;
} {
  const vars = brandVars(branding) as Record<string, string>;
  const primary = vars['--kdc-brand'] ?? DEFAULT_BRAND;
  return {
    primary,
    accent: vars['--kdc-accent'] ?? DEFAULT_ACCENT,
    ink: vars['--kdc-brand-ink'] ?? '#ffffff',
  };
}

/** `{{token.name}}` substitution for email subjects/bodies shown in the UI. */
export function previewMerge(text: string, values: Record<string, string>): string {
  return text.replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (whole, token: string) => values[token.toLowerCase()] ?? whole,
  );
}
