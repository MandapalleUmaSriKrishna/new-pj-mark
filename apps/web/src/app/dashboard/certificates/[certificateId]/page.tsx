'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Download,
  Fingerprint,
  MailPlus,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { EventView, ListResult, PublicCertificate } from '@/lib/types';
import { CertificateCanvas, SAMPLE_VALUES } from '@/components/certificate-canvas';
import { QrPreview } from '@/components/certificate-canvas';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  ErrorState,
  Modal,
  Field,
  Input,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import { formatDateTime, formatNumber, saveBlobResponse } from '@/lib/utils';
import type { MergeValues, TemplateDoc } from '@kdc/shared';

export default function CertificateDetailPage() {
  const params = useParams<{ certificateId: string }>();
  const certificateId = params.certificateId;
  const router = useRouter();
  const { activeTenant, can } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();

  const certificate = useQuery({
    queryKey: ['certificate', tenantId, certificateId],
    queryFn: () =>
      api.get<PublicCertificate>(`${API_PREFIX}/tenants/${tenantId}/certificates/${certificateId}`),
    enabled: Boolean(tenantId && certificateId),
  });

  const template = useQuery({
    queryKey: ['template-for-cert', tenantId, certificate.data?.templateId],
    queryFn: async () => {
      const list = await api.get<ListResult<{ id: string; doc: TemplateDoc }>>(
        `${API_PREFIX}/tenants/${tenantId}/templates`,
      );
      return list.items.find((entry) => entry.id === certificate.data?.templateId)?.doc ?? null;
    },
    enabled: Boolean(certificate.data?.templateId),
  });

  const event = useQuery({
    queryKey: ['event-for-cert', tenantId, certificate.data?.eventId],
    queryFn: async () => {
      const list = await api.get<ListResult<EventView>>(`${API_PREFIX}/tenants/${tenantId}/events`);
      return list.items.find((entry) => entry.id === certificate.data?.eventId) ?? null;
    },
    enabled: Boolean(certificate.data?.eventId),
  });

  const download = useMutation({
    mutationFn: async () => {
      const response = await api.raw(
        `${API_PREFIX}/tenants/${tenantId}/certificates/${certificateId}/pdf`,
      );
      await saveBlobResponse(response, `${certificate.data?.serial ?? 'certificate'}.pdf`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Download failed'),
  });

  const resend = useMutation({
    mutationFn: () =>
      api.post(`${API_PREFIX}/tenants/${tenantId}/certificates/${certificateId}/resend`, {}),
    onSuccess: () => {
      toast.success('Delivery queued');
      void queryClient.invalidateQueries({ queryKey: ['certificate', tenantId, certificateId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Resend failed'),
  });

  const revoke = useMutation({
    mutationFn: (reason: string) =>
      api.post(`${API_PREFIX}/tenants/${tenantId}/certificates/${certificateId}/revoke`, {
        reason,
      }),
    onSuccess: () => {
      setRevokeOpen(false);
      setRevokeReason('');
      toast.success('Certificate revoked');
      void queryClient.invalidateQueries({ queryKey: ['certificate', tenantId, certificateId] });
      void queryClient.invalidateQueries({ queryKey: ['certificates', tenantId] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Revocation failed'),
  });

  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  if (!tenantId || !certificateId) return <Spinner />;
  if (certificate.isError)
    return (
      <ErrorState
        message={certificate.error instanceof ApiError ? certificate.error.message : 'Not found'}
        onRetry={() => void certificate.refetch()}
      />
    );

  const record = certificate.data;

  const merge: MergeValues = record
    ? {
        ...SAMPLE_VALUES,
        'recipient.name': record.recipient.name,
        'recipient.title': record.recipient.title ?? '',
        'recipient.department': record.recipient.department ?? '',
        'recipient.roll_number': record.recipient.rollNumber ?? '',
        'recipient.grade': record.recipient.grade ?? '',
        'recipient.hours': record.recipient.hours ?? '',
        'recipient.email': record.recipient.email ?? '',
        'event.name': event.data?.name ?? '',
        'event.date': event.data?.date ?? '',
        'event.venue': event.data?.venue ?? '',
        'certificate.serial': record.serial,
        'certificate.issued_at': record.issuedAtDisplay,
        'verify.url': record.verifyUrl,
      }
    : SAMPLE_VALUES;

  return (
    <>
      <button
        type="button"
        onClick={() => router.push('/dashboard/certificates')}
        className="kdc-btn kdc-btn-ghost mb-3 !min-h-8 !px-2 !text-xs"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> {t('common.back')}
      </button>

      {certificate.isPending || !record ? (
        <div className="grid place-items-center py-20">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Card className="overflow-hidden">
            <CardHeader
              title={<span className="font-mono">{record.serial}</span>}
              description={`${record.recipient.name}${record.recipient.title ? ` · ${record.recipient.title}` : ''}`}
              action={<StatusBadge status={record.status} />}
            />
            <CardBody className="space-y-4">
              <div className="overflow-auto rounded-lg bg-[var(--kdc-surface-sunken)] p-3">
                {template.data ? (
                  <div className="mx-auto w-fit">
                    <CertificateCanvas doc={template.data} scale={0.62} values={merge} />
                  </div>
                ) : (
                  <div className="grid h-56 place-items-center text-xs text-[var(--kdc-text-muted)]">
                    Loading design preview…
                  </div>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <Row
                  label={t('certificates.status')}
                  value={<StatusBadge status={record.status} />}
                />
                <Row
                  label="Issued"
                  value={record.issuedAt ? formatDateTime(record.issuedAt, locale) : '—'}
                />
                <Row label="Event" value={event.data?.name ?? '—'} />
                <Row
                  label={t('verify.downloads')}
                  value={formatNumber(record.downloadCount, locale)}
                />
                <Row label={t('verify.views')} value={formatNumber(record.viewCount, locale)} />
                <Row
                  label="Link expires"
                  value={
                    record.downloadExpiresAt
                      ? formatDateTime(record.downloadExpiresAt, locale)
                      : '—'
                  }
                />
                <Row
                  label="PDF SHA-256"
                  value={
                    record.pdfSha256 ? (
                      <span className="break-all font-mono text-[0.62rem]">
                        {record.pdfSha256.slice(0, 24)}…
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                <Row
                  label="Batch"
                  value={
                    record.batchId ? (
                      <span className="font-mono text-[0.62rem]">
                        {record.batchId.slice(0, 8)}…
                      </span>
                    ) : (
                      'single issue'
                    )
                  }
                />
                <Row label="Approved by" value={record.approvedBy ?? '—'} />
              </dl>

              <div
                className={
                  record.integrityOk
                    ? 'flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : 'flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                }
              >
                <Fingerprint className="size-3.5 shrink-0" aria-hidden />
                {record.integrityOk ? t('verify.integrityOk') : t('verify.integrityBad')}
              </div>

              {record.revocation ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <p className="font-semibold">
                    Revoked {formatDateTime(record.revocation.revokedAt, locale)}
                  </p>
                  <p className="mt-0.5">{record.revocation.reason}</p>
                </div>
              ) : null}
              {record.failureReason ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="font-semibold">Last failure</p>
                  <p className="mt-0.5">{record.failureReason}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-[var(--kdc-border)] pt-3">
                <Button
                  size="sm"
                  icon={Download}
                  loading={download.isPending}
                  disabled={!record.hasPdf}
                  onClick={() => download.mutate()}
                >
                  {t('certificates.downloadPdf')}
                </Button>
                {can(['certificate:resend']) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={MailPlus}
                    loading={resend.isPending}
                    onClick={() => resend.mutate()}
                  >
                    {t('certificates.resend')}
                  </Button>
                ) : null}
                <CopyButton value={record.verifyUrl} label="Copy verify link" />
                {can(['certificate:revoke']) && record.status !== 'revoked' ? (
                  <Button size="sm" variant="danger" icon={Ban} onClick={() => setRevokeOpen(true)}>
                    {t('certificates.revoke')}
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Verification" icon={ShieldCheck} />
              <CardBody className="space-y-3">
                <div className="mx-auto w-fit rounded-lg border border-[var(--kdc-border)] bg-white p-2">
                  <QrPreview
                    value={record.verifyUrl}
                    size={132}
                    foreground="#111827"
                    background="#ffffff"
                    errorLevel="M"
                    caption={record.serial}
                    captionFontSize={9}
                    scale={1}
                  />
                </div>
                <p className="break-all text-center font-mono text-[0.68rem] text-[var(--kdc-text-muted)]">
                  {record.verifyUrl}
                </p>
                <div className="flex justify-center gap-2">
                  <a
                    href={`/verify/${record.serial}`}
                    target="_blank"
                    rel="noreferrer"
                    className="kdc-btn kdc-btn-secondary !min-h-9 !py-1.5 !text-xs"
                  >
                    <QrCode className="size-3.5" aria-hidden /> Open public page
                  </a>
                  <CopyButton value={record.verifyUrl} />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Recipient" icon={BadgeCheck} />
              <CardBody>
                <dl className="space-y-2 text-xs">
                  <Row label="Name" value={record.recipient.name} />
                  <Row label="Email" value={record.recipient.email ?? '—'} />
                  <Row label="Title" value={record.recipient.title ?? '—'} />
                  <Row label="Department" value={record.recipient.department ?? '—'} />
                  <Row label="Roll number" value={record.recipient.rollNumber ?? '—'} />
                  <Row label="Grade" value={record.recipient.grade ?? '—'} />
                  <Row label="Hours" value={record.recipient.hours ?? '—'} />
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      <Modal
        open={revokeOpen}
        onOpenChange={(open) => !open && setRevokeOpen(false)}
        title={`Revoke ${record?.serial ?? ''}`}
        description="Verification will report this certificate as revoked immediately and permanently."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              icon={Ban}
              loading={revoke.isPending}
              onClick={() => revoke.mutate(revokeReason || 'Revoked by an administrator')}
            >
              {t('certificates.revoke')}
            </Button>
          </>
        }
      >
        <Field label={t('certificates.revokeReason')} required>
          {(id) => (
            <Input
              id={id}
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="Reason shown on the verification page"
            />
          )}
        </Field>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs font-medium">{value}</dd>
    </div>
  );
}
