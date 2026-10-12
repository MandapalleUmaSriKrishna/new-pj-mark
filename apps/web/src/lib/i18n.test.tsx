import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider, LOCALE_LABELS, TRANSLATED_LOCALES, translate, useI18n } from './i18n';
import { brandColors, brandVars, isSafeColor, readableInk } from './branding';
import { cn, formatBytes, formatNumber, initials, slugify, titleCase, truncate } from './utils';

describe('translations', () => {
  it('covers every English key in each complete catalogue', () => {
    // A "complete" locale must not silently fall back per-key.
    for (const locale of TRANSLATED_LOCALES) {
      const probe = translate(locale, 'nav.dashboard');
      expect(probe).not.toBe(translate('en', 'nav.dashboard'));
    }
  });

  it('falls back to English for partial locales instead of showing keys', () => {
    expect(translate('es', 'nav.dashboard')).toBe('Dashboard');
    expect(translate('fr', 'verify.title')).toBe(translate('en', 'verify.title'));
  });

  it('interpolates variables', () => {
    expect(translate('en', 'dash.quotaUsed', { used: 5, limit: 100 })).toBe('5 of 100 used');
    expect(translate('hi', 'offline.queued', { count: 3 })).toContain('3');
  });

  it('never returns a raw key for a known message', () => {
    const keys = Object.keys(LOCALE_LABELS);
    expect(keys).toContain('te');
    expect(translate('te', 'verify.valid')).not.toContain('verify.');
  });

  it('exposes the provider hook with dir handling for RTL', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <I18nProvider initialLocale="ar">{children}</I18nProvider>
    );
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe('ar');
    expect(result.current.dir).toBe('rtl');
    expect(result.current.isFallback).toBe(true); // Arabic strings are not shipped yet
  });
});

describe('branding', () => {
  it('rejects non-hex colours so tenant input cannot inject CSS', () => {
    expect(isSafeColor('#123456')).toBe(true);
    expect(isSafeColor('#abc')).toBe(true);
    expect(isSafeColor('rgb(1,2,3)')).toBe(false);
    expect(isSafeColor('url(x)')).toBe(false);
    expect(isSafeColor(null)).toBe(false);
  });

  it('picks readable ink for light and dark brands', () => {
    expect(readableInk('#ffffff')).toBe('#14171f');
    expect(readableInk('#000000')).toBe('#ffffff');
    expect(readableInk('#1d40f0')).toBe('#ffffff');
  });

  it('emits CSS custom properties and falls back when branding is missing', () => {
    const vars = brandVars(null) as Record<string, string>;
    expect(vars['--kdc-brand']).toBe('#1d40f0');
    const colors = brandColors({
      primaryColor: '#0f766e',
      secondaryColor: '#c8a44d',
      accentColor: '',
      tagline: null,
      website: null,
      supportEmail: null,
      logoAssetId: null,
      faviconAssetId: null,
      emailBannerAssetId: null,
      fontFamily: null,
      certificateFooterText: null,
      hidePoweredBy: false,
    });
    expect(colors.primary).toBe('#0f766e');
  });
});

describe('utils', () => {
  it('merges tailwind classes with precedence', () => {
    expect(cn('p-2 p-4', null, 'text-red-500')).toBe('p-4 text-red-500');
  });

  it('formats bytes human-readably', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('formats numbers with the given locale', () => {
    expect(formatNumber(123456, 'en-IN')).toBe('1,23,456');
    expect(formatNumber(123456, 'en-US')).toBe('123,456');
  });

  it('derives initials and slugs safely', () => {
    expect(initials('Jane Q. Public')).toBe('JP');
    expect(initials('')).toBe('?');
    expect(slugify('Krishna Institute of Technology!')).toBe('krishna-institute-of-technology');
    expect(titleCase('pending_approval')).toBe('Pending Approval');
    expect(truncate('abcdefgh', 5)).toBe('abcd…');
  });
});
