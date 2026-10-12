'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Ban,
  Clock3,
  FileQuestion,
  Fingerprint,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { api, API_PREFIX } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { VerificationResult } from '@/lib/types';
import { Badge, Button, Card, CardBody, ErrorState, Input, Spinner } from '@/components/ui';
import { QrPreview } from '@/components/certificate-canvas';
import { brandVars } from '@/lib/branding';
import { cn, formatDate, formatDateTime, formatNumber, titleCase } from '@/lib/utils';

/**
 * Public verification.
 *
 * Deliberately unauthenticated: anyone holding a certificate (an employer, a
 * university admissions office) must be able to check it. The API returns the
 * verification verdict plus exactly the fields a verifier needs - never the
 * recipient's email address.
 */

const RESULT_COPY: Record<
  string,
  {
    key: 'valid' | 'revoked' | 'notIssued' | 'notFound' | 'malformed';
    icon: typeof ShieldCheck;
    tone: string;
  }
> = {
  valid: { key: 'valid', icon: ShieldCheck, tone: 'text-emerald-600 dark:text-emerald-400' },
  revoked: { key: 'revoked', icon: Ban, tone: 'text-red-600 dark:text-red-400' },
  not_issued: { key: 'notIssued', icon: Clock3, tone: 'text-amber-600 dark:text-amber-400' },
  pending_approval: { key: 'notIssued', icon: Clock3, tone: 'text-amber-600 dark:text-amber-400' },
  not_found: { key: 'notFound', icon: FileQuestion, tone: 'text-ink-500' },
  malformed: { key: 'malformed', icon: ShieldAlert, tone: 'text-red-600 dark:text-red-400' },
};

export function VerifyForm({ initial }: { initial?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState(initial ?? '');

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        const serial = value.trim();
        if (serial) router.push(`/verify/${encodeURIComponent(serial)}`);
      }}
    >
      <label className="sr-only" htmlFor="serial">
        {t('verify.serial')}
      </label>
      <Input
        id="serial"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="KDC-2026-7QK3M9XA-4"
        className="font-mono sm:flex-1"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" icon={BadgeCheck} className="sm:w-40">
        {t('verify.button')}
      </Button>
    </form>
  );
}

export function VerifyResult({ serial }: { serial: string }) {
  const { t, locale } = useI18n();

  const query = useQuery({
    queryKey: ['public', 'verify', serial],
    queryFn: () =>
      api.get<VerificationResult>(`${API_PREFIX}/public/verify`, { query: { serial } }),
    retry: false,
    staleTime: 10_000,
  });

  if (query.isPending) {
    return (
      <div className="grid place-items-center py-14">
        <Spinner label="Verifying" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Verification failed"
        message="The verification service could not be reached. Try again shortly."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const result = query.data;
  const copy = RESULT_COPY[result.result] ?? RESULT_COPY.not_found;
  const Copy = copy ? copy.icon : FileQuestion;
  const certificate = result.certificate;
  const verifiedAt = formatDateTime(result.checkedAt, locale);

  return (
    <Card className="overflow-hidden">
      <div style={brandVars(certificate?.branding)}>
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 border-b border-[var(--kdc-border)] px-5 py-4',
            result.result === 'valid'
              ? 'bg-emerald-50/70 dark:bg-emerald-500/10'
              : result.result === 'revoked'
                ? 'bg-red-50/70 dark:bg-red-500/10'
                : 'bg-[var(--kdc-surface-sunken)]',
          )}
        >
          <Copy className={cn('size-8 shrink-0', copy?.tone)} aria-hidden />
          <div className="min-w-0 flex-1">
            {/* The verdict is the page's heading: /verify/[serial] has no other
                h1, and it is the first thing a screen reader should announce. */}
            <h1 className="text-base font-bold tracking-tight">
              {t(`verify.${copy?.key ?? 'notFound'}` as 'verify.valid')}
            </h1>
            <p className="mt-0.5 font-mono text-xs text-[var(--kdc-text-muted)]">{result.serial}</p>
          </div>
          <Badge
            tone={
              result.result === 'valid' ? 'ok' : result.result === 'revoked' ? 'danger' : 'warn'
            }
          >
            {titleCase(result.result)}
          </Badge>
        </div>

        <CardBody className="space-y-5">
          {certificate ? (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Row label={t('verify.issuedTo')} value={certificate.recipient.name} />
                {certificate.recipient.title ? (
                  <Row label="Title" value={certificate.recipient.title} />
                ) : null}
                {certificate.recipient.department ? (
                  <Row label="Department" value={certificate.recipient.department} />
                ) : null}
                {certificate.recipient.grade ? (
                  <Row label="Grade" value={certificate.recipient.grade} />
                ) : null}
                {certificate.eventName ? <Row label="Event" value={certificate.eventName} /> : null}
                <Row label={t('verify.issuedBy')} value={certificate.tenantName} />
                <Row
                  label={t('verify.issuedOn')}
                  value={certificate.issuedAtDisplay || formatDate(certificate.issuedAt, locale)}
                />
                <Row
                  label={t('verify.downloads')}
                  value={formatNumber(certificate.downloadCount, locale)}
                />
                <Row
                  label={t('verify.views')}
                  value={formatNumber(certificate.viewCount, locale)}
                />
              </dl>

              {result.result === 'revoked' && certificate.revocation ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <Trash2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <p>
                    Revoked on {formatDateTime(certificate.revocation.revokedAt, locale)}
                    {certificate.revocation.reason ? <> — {certificate.revocation.reason}</> : null}
                    .
                  </p>
                </div>
              ) : null}

              <div
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
                  certificate.integrityOk
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
                )}
              >
                <Fingerprint className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <p>
                  <strong className="font-semibold">{t('verify.integrity')}:</strong>{' '}
                  {certificate.integrityOk ? t('verify.integrityOk') : t('verify.integrityBad')}
                </p>
              </div>
            </>
          ) : (
            <p className="text-xs text-[var(--kdc-text-muted)]">
              {result.reason ??
                'No certificate record matches this identifier. Check the ID on the certificate and try again.'}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 border-t border-[var(--kdc-border)] pt-4">
            <div className="rounded-lg border border-[var(--kdc-border)] bg-white p-2">
              <QrPreview
                value={result.verifyUrl}
                size={96}
                foreground="#111827"
                background="#ffffff"
                errorLevel="M"
                scale={1}
              />
            </div>
            <div className="min-w-0 flex-1 text-xs text-[var(--kdc-text-muted)]">
              <p className="font-semibold text-[var(--kdc-text)]">Scan to re-verify</p>
              <p className="mt-1 break-all font-mono text-[0.68rem]">{result.verifyUrl}</p>
              <p className="mt-2">Checked {verifiedAt}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => window.location.assign('/verify')}>
              {t('verify.checkAnother')}
            </Button>
          </div>
        </CardBody>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
