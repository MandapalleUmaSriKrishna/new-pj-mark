import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { CertificateStatus, DeliveryStatus, JobStatus } from '@kdc/shared';

/** Tailwind-aware class joiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ dates */

const dateCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let cached = dateCache.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    dateCache.set(key, cached);
  }
  return cached;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** e.g. "11 October 2026" */
export function formatDate(
  value: string | number | Date | null | undefined,
  locale = 'en-IN',
): string {
  const date = toDate(value);
  if (!date) return '—';
  return formatter(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** e.g. "11 Oct 2026, 4:05 pm" */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale = 'en-IN',
): string {
  const date = toDate(value);
  if (!date) return '—';
  return formatter(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** e.g. "3 minutes ago" / "in 2 days" */
export function formatRelative(
  value: string | number | Date | null | undefined,
  locale = 'en',
): string {
  const date = toDate(value);
  if (!date) return '—';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds)
      return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return rtf.format(diffSeconds, 'second');
}

/* ---------------------------------------------------------------- numbers */

export function formatNumber(value: number | null | undefined, locale = 'en-IN'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatMoney(
  cents: number | null | undefined,
  currency = 'USD',
  locale = 'en-IN',
): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = Number((bytes / 1024 ** index).toFixed(1));
  return `${value} ${units[index]}`;
}

/* ------------------------------------------------------------------ text */

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0]}${(parts[parts.length - 1] as string)[0]}`.toUpperCase();
}

export function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/* ----------------------------------------------------------------- tone */

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

const STATUS_TONES: Record<string, Tone> = {
  issued: 'ok',
  delivered: 'ok',
  completed: 'ok',
  active: 'ok',
  approved: 'ok',
  sent: 'ok',
  valid: 'ok',
  verified: 'ok',
  captured: 'info',
  pending: 'warn',
  pending_approval: 'warn',
  queued: 'warn',
  paused: 'warn',
  draft: 'muted',
  archived: 'muted',
  cancelled: 'muted',
  trial: 'info',
  revoked: 'danger',
  failed: 'danger',
  bounced: 'danger',
  rejected: 'danger',
  suspended: 'danger',
  expired: 'danger',
  invalid: 'danger',
  malformed: 'danger',
};

export function toneFor(status: CertificateStatus | DeliveryStatus | JobStatus | string): Tone {
  return STATUS_TONES[String(status)] ?? 'muted';
}

export const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  warn: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  danger:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30',
  info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
  muted:
    'bg-ink-100 text-ink-600 border-ink-200 dark:bg-ink-800/60 dark:text-ink-300 dark:border-ink-700',
};

/* ------------------------------------------------------------ browser */

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Triggers a browser download for bytes returned by the API. */
export async function saveBlobResponse(response: Response, fallbackName: string): Promise<void> {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

export function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** Small helper so UI code never has to guess about `AbortError`. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
