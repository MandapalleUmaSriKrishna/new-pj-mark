'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { BadgeCheck, Ban, Download, Eye, MailPlus, Plus, Search, Send } from 'lucide-react';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { EventView, IssuedCertificateView, ListResult, PublicCertificate } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Button,
  Card,
  CardBody,
  CopyButton,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  Notice,
  Pagination,
  Select,
  StatusBadge,
  Switch,
  type Column,
} from '@/components/ui';
import { formatDateTime, saveBlobResponse, titleCase, truncate } from '@/lib/utils';
import { readSnapshot, writeSnapshot } from '@/lib/offline';
import { useOfflineQueue } from '@/lib/offline';

const PAGE_SIZE = 20;

const issueSchema = z.object({
  eventId: z.string().min(1, 'Choose an event'),
  name: z.string().trim().min(2, 'Recipient name is required'),
  email: z.string().trim().email('A valid email is required').or(z.literal('')),
  title: z.string().trim().max(160).optional(),
  department: z.string().trim().max(160).optional(),
  rollNumber: z.string().trim().max(80).optional(),
  grade: z.string().trim().max(80).optional(),
  hours: z.string().trim().max(40).optional(),
  sendEmail: z.boolean(),
});
type IssueFormValues = z.infer<typeof issueSchema>;

function CertificatesInner() {
  const { activeTenant, can } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const queue = useOfflineQueue();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(search.get('status') ?? '');
  const [eventFilter, setEventFilter] = useState(search.get('event') ?? '');
  const [term, setTerm] = useState(search.get('q') ?? '');
  const [debouncedTerm, setDebouncedTerm] = useState(term);
  const [issueOpen, setIssueOpen] = useState(search.get('issue') === '1');
  const [issuedOnce, setIssuedOnce] = useState<IssuedCertificateView | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PublicCertificate | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const events = useQuery({
    queryKey: ['events', tenantId],
    queryFn: () => api.get<ListResult<EventView>>(`${API_PREFIX}/tenants/${tenantId}/events`),
    enabled: Boolean(tenantId),
  });

  const snapshotKey = `certificates:${tenantId}:${page}:${status}:${eventFilter}:${debouncedTerm}`;
  const list = useQuery({
    queryKey: ['certificates', tenantId, page, status, eventFilter, debouncedTerm],
    queryFn: async () => {
      const data = await api.get<ListResult<PublicCertificate>>(
        `${API_PREFIX}/tenants/${tenantId}/certificates`,
        {
          query: {
            page,
            pageSize: PAGE_SIZE,
            status: status || undefined,
            eventId: eventFilter || undefined,
            q: debouncedTerm || undefined,
          },
        },
      );
      writeSnapshot(snapshotKey, data);
      return data;
    },
    enabled: Boolean(tenantId),
    placeholderData: () => readSnapshot<ListResult<PublicCertificate>>(snapshotKey)?.data,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['certificates', tenantId] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', tenantId] });
    void queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
  };

  /* ------------------------------------------------------------ mutations */

  const download = useMutation({
    mutationFn: async (certificate: PublicCertificate) => {
      const response = await api.raw(
        `${API_PREFIX}/tenants/${tenantId}/certificates/${certificate.id}/pdf`,
      );
      await saveBlobResponse(response, `${certificate.serial}.pdf`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Download failed'),
  });

  const revoke = useMutation({
    mutationFn: async ({
      certificate,
      reason,
    }: {
      certificate: PublicCertificate;
      reason: string;
    }) => {
      const action = {
        kind: 'revoke' as const,
        label: `Revoke ${certificate.serial}`,
        tenantId,
        method: 'POST' as const,
        path: `${API_PREFIX}/tenants/${tenantId}/certificates/${certificate.id}/revoke`,
        body: { reason },
      };
      if (!navigator.onLine) {
        queue.enqueue(action);
        toast.message('Offline — revocation queued and will sync automatically');
        return;
      }
      await api.post(`${API_PREFIX}/tenants/${tenantId}/certificates/${certificate.id}/revoke`, {
        reason,
      });
    },
    onSuccess: () => {
      setRevokeTarget(null);
      setRevokeReason('');
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Revocation failed'),
  });

  const resend = useMutation({
    mutationFn: async (certificate: PublicCertificate) => {
      const action = {
        kind: 'resend' as const,
        label: `Resend ${certificate.serial}`,
        tenantId,
        method: 'POST' as const,
        path: `${API_PREFIX}/tenants/${tenantId}/certificates/${certificate.id}/resend`,
        body: {},
      };
      if (!navigator.onLine) {
        queue.enqueue(action);
        toast.message('Offline — resend queued');
        return;
      }
      return api.post<{ deliveryId: string; status: string; captured?: boolean }>(
        `${API_PREFIX}/tenants/${tenantId}/certificates/${certificate.id}/resend`,
        {},
      );
    },
    onSuccess: (result) => {
      invalidate();
      if (result && (result.status === 'captured' || result.captured)) {
        toast.info(
          'No SMTP is configured, so the email was captured to disk on the API host instead of being sent.',
        );
      } else {
        toast.success('Delivery queued');
      }
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Resend failed'),
  });

  const exportCsv = useMutation({
    mutationFn: async () => {
      const response = await api.raw(`${API_PREFIX}/tenants/${tenantId}/certificates/export.csv`, {
        query: { status: status || undefined, eventId: eventFilter || undefined },
      });
      await saveBlobResponse(response, `certificates-${tenantId.slice(0, 8)}.csv`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Export failed'),
  });

  /* ---------------------------------------------------------------- table */

  const columns = useMemo<Column<PublicCertificate>[]>(
    () => [
      {
        key: 'serial',
        header: t('verify.serial'),
        render: (row) => (
          <Link
            href={`/dashboard/certificates/${row.id}`}
            className="font-mono text-xs font-semibold text-[var(--kdc-brand)] hover:underline"
          >
            {row.serial}
          </Link>
        ),
      },
      {
        key: 'recipient',
        header: t('certificates.recipient'),
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{row.recipient.name}</p>
            <p className="truncate text-[0.68rem] text-[var(--kdc-text-muted)]">
              {row.recipient.title ?? row.recipient.department ?? '—'}
            </p>
          </div>
        ),
      },
      {
        key: 'status',
        header: t('certificates.status'),
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'issuedAt',
        header: 'Issued',
        hideBelow: 'md',
        render: (row) => (
          <span className="text-xs text-[var(--kdc-text-muted)]">
            {row.issuedAt ? formatDateTime(row.issuedAt, locale) : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        className: 'text-right',
        render: (row) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              title={t('certificates.downloadPdf')}
              aria-label={`${t('certificates.downloadPdf')} ${row.serial}`}
              disabled={!row.hasPdf || download.isPending}
              onClick={() => download.mutate(row)}
            >
              <Download className="size-3.5" aria-hidden />
            </Button>
            <CopyButton value={row.verifyUrl} label="" copiedLabel="" />
            {can(['certificate:resend']) ? (
              <Button
                variant="ghost"
                size="icon"
                title={t('certificates.resend')}
                aria-label={`${t('certificates.resend')} ${row.serial}`}
                disabled={resend.isPending}
                onClick={() => resend.mutate(row)}
              >
                <MailPlus className="size-3.5" aria-hidden />
              </Button>
            ) : null}
            {can(['certificate:revoke']) && row.status !== 'revoked' ? (
              <Button
                variant="ghost"
                size="icon"
                title={t('certificates.revoke')}
                aria-label={`${t('certificates.revoke')} ${row.serial}`}
                className="text-red-500"
                onClick={() => setRevokeTarget(row)}
              >
                <Ban className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [t, locale, can, download, resend],
  );

  const rows = list.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('nav.certificates')}
        description="Every certificate in this organisation, with live status and one-click verification links."
        icon={BadgeCheck}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              loading={exportCsv.isPending}
              onClick={() => exportCsv.mutate()}
            >
              {t('certificates.exportCsv')}
            </Button>
            {can(['certificate:issue']) ? (
              <Button size="sm" icon={Plus} onClick={() => setIssueOpen(true)}>
                {t('certificates.issueOne')}
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3 !p-3">
          <Field label={t('common.search')} className="min-w-48 flex-1">
            {(id) => (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--kdc-text-muted)]"
                  aria-hidden
                />
                <Input
                  id={id}
                  value={term}
                  onChange={(event) => {
                    setTerm(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Serial, name or roll number"
                  className="pl-8"
                />
              </div>
            )}
          </Field>
          <Field label={t('certificates.status')} className="w-40">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {[
                  'draft',
                  'pending_approval',
                  'approved',
                  'issued',
                  'delivered',
                  'revoked',
                  'failed',
                ].map((value) => (
                  <option key={value} value={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Event" className="w-52">
            {(id) => (
              <Select
                id={id}
                value={eventFilter}
                onChange={(event) => {
                  setEventFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All events</option>
                {(events.data?.items ?? []).map((event) => (
                  <option key={event.id} value={event.id}>
                    {truncate(event.name, 32)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      {list.isError ? (
        <ErrorState
          message={list.error instanceof ApiError ? list.error.message : String(list.error.message)}
          onRetry={() => void list.refetch()}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <DataTable
            rows={rows}
            columns={columns}
            keyOf={(row) => row.id}
            loading={list.isFetching && !list.data}
            empty={
              <p className="text-center text-xs text-[var(--kdc-text-muted)]">
                No certificates match these filters yet.
              </p>
            }
          />
          {list.data ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data.total ?? rows.length}
              onPage={setPage}
            />
          ) : null}
        </Card>
      )}

      <IssueModal
        open={issueOpen}
        onOpenChange={setIssueOpen}
        onIssued={setIssuedOnce}
        tenantId={tenantId}
        onDone={invalidate}
      />

      {issuedOnce ? (
        <Modal
          open
          onOpenChange={(open) => !open && setIssuedOnce(null)}
          title="Certificate issued"
          description={t('certificates.privateLinkOnce')}
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--kdc-border)] bg-[var(--kdc-surface-sunken)] p-3">
              <p className="font-mono text-sm font-bold">{issuedOnce.serial}</p>
              <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
                {issuedOnce.recipient.name}
              </p>
            </div>
            <Field label="Private download link (shown once)">
              {() => (
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={issuedOnce.downloadUrl}
                    className="font-mono text-[0.7rem]"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <CopyButton value={issuedOnce.downloadUrl} />
                </div>
              )}
            </Field>
            <Field label="Download token (shown once)">
              {() => (
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={issuedOnce.downloadToken}
                    className="font-mono text-[0.7rem]"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <CopyButton value={issuedOnce.downloadToken} />
                </div>
              )}
            </Field>
            <Notice tone="warn">
              Store these now. Only the hash of the token is kept, so neither can be recovered
              later.
            </Notice>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => router.push(`/dashboard/certificates/${issuedOnce.id}`)}
              >
                <Eye className="size-4" aria-hidden /> Open record
              </Button>
              <Button onClick={() => setIssuedOnce(null)}>{t('common.close')}</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <Modal
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`Revoke ${revokeTarget?.serial ?? ''}`}
        description="Revocation is immediate and permanent: verification will report this certificate as revoked."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              icon={Ban}
              loading={revoke.isPending}
              onClick={() =>
                revokeTarget &&
                revoke.mutate({
                  certificate: revokeTarget,
                  reason: revokeReason || 'Revoked by an administrator',
                })
              }
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
              placeholder="Duplicate issue, name correction, misconduct…"
            />
          )}
        </Field>
      </Modal>
    </>
  );
}

function IssueModal({
  open,
  onOpenChange,
  onIssued,
  tenantId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (issued: IssuedCertificateView) => void;
  tenantId: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const queryClient = useQueryClient();

  const events = useQuery({
    queryKey: ['events', tenantId],
    queryFn: () => api.get<ListResult<EventView>>(`${API_PREFIX}/tenants/${tenantId}/events`),
    enabled: open && Boolean(tenantId),
  });

  const issue = useMutation({
    mutationFn: async (values: IssueFormValues) => {
      const body = {
        eventId: values.eventId,
        recipient: {
          name: values.name,
          email: values.email || null,
          title: values.title || null,
          department: values.department || null,
          rollNumber: values.rollNumber || null,
          grade: values.grade || null,
          hours: values.hours || null,
        },
        sendEmail: values.sendEmail,
      };
      if (!navigator.onLine) {
        queue.enqueue({
          kind: 'issue',
          label: `Issue to ${values.name}`,
          tenantId,
          method: 'POST',
          path: `${API_PREFIX}/tenants/${tenantId}/certificates/issue`,
          body,
        });
        toast.message('Offline — issuance queued and will sync when you reconnect');
        return null;
      }
      return api.post<IssuedCertificateView>(
        `${API_PREFIX}/tenants/${tenantId}/certificates/issue`,
        body,
      );
    },
    onSuccess: (issued) => {
      if (issued) {
        onIssued(issued);
        toast.success(`Issued ${issued.serial}`);
      }
      onOpenChange(false);
      onDone();
      void queryClient.invalidateQueries({ queryKey: ['certificates', tenantId] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.isPlanGate)
          toast.error(
            `${error.message} ${t('errors.planGate', { plan: error.requiredPlan ?? 'higher' })}`,
          );
        else if (error.code === 'quota_exceeded') toast.error(t('errors.quota'));
        else toast.error(error.fields.map((field) => field.message).join(' · ') || error.message);
      } else {
        toast.error(t('errors.network'));
      }
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<IssueFormValues>({
    resolver: zodResolver(issueSchema),
    defaultValues: {
      eventId: '',
      name: '',
      email: '',
      title: '',
      department: '',
      rollNumber: '',
      grade: '',
      hours: '',
      sendEmail: true,
    },
  });
  const sendEmail = watch('sendEmail');

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('certificates.issueOne')}
      description="Issues immediately unless the event requires approval."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={issue.isPending}
            icon={Send}
            onClick={(event) => void handleSubmit((values) => issue.mutate(values))(event)}
          >
            Issue certificate
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(event) => event.preventDefault()}>
        <Field label="Event" required error={errors.eventId?.message}>
          {(id) => (
            <Select id={id} {...register('eventId')}>
              <option value="">Choose an event…</option>
              {(events.data?.items ?? []).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('certificates.recipient')} required error={errors.name?.message}>
          {(id) => <Input id={id} placeholder="Jane Q. Public" {...register('name')} />}
        </Field>
        <Field
          label={t('auth.email')}
          error={errors.email?.message}
          hint="Optional only if the event allows email-less recipients; needed for delivery and self-download."
        >
          {(id) => (
            <Input
              id={id}
              type="email"
              placeholder="recipient@example.edu"
              {...register('email')}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" error={errors.title?.message}>
            {(id) => <Input id={id} placeholder="Graduate" {...register('title')} />}
          </Field>
          <Field label="Department" error={errors.department?.message}>
            {(id) => <Input id={id} placeholder="Computer Science" {...register('department')} />}
          </Field>
          <Field label="Roll number" error={errors.rollNumber?.message}>
            {(id) => <Input id={id} placeholder="21BCE1234" {...register('rollNumber')} />}
          </Field>
          <Field label="Grade" error={errors.grade?.message}>
            {(id) => <Input id={id} placeholder="9.4 CGPA" {...register('grade')} />}
          </Field>
        </div>
        <div className="flex items-center gap-2.5">
          <Switch
            checked={sendEmail}
            onCheckedChange={(value) => setValue('sendEmail', value)}
            label={t('events.autoDeliver')}
          />
          <span className="text-xs">{t('events.autoDeliver')}</span>
        </div>
        <Notice tone="info">
          Merge fields in the design are filled from these values at issue time.
        </Notice>
      </form>
    </Modal>
  );
}

export default function CertificatesPage() {
  return (
    <Suspense fallback={null}>
      <CertificatesInner />
    </Suspense>
  );
}
