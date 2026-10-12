'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, FileDown, FileSpreadsheet, FileUp, RefreshCw, Upload } from 'lucide-react';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type {
  EventView,
  ImportIssueResult,
  ImportStageResult,
  JobRecord,
  ListResult,
} from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  ErrorState,
  Field,
  Notice,
  Progress,
  Select,
  StatusBadge,
  type Column,
} from '@/components/ui';
import { formatDateTime, formatNumber, saveBlobResponse, truncate } from '@/lib/utils';
import { useRealtimeStream } from '@/lib/realtime';

/**
 * CSV / XLSX bulk issuance.
 *
 * Four honest stages: upload → auto-mapped columns with a human-editable map →
 * preview of the real parsed rows (including the bad ones and why) → issue,
 * which queues chunked jobs whose progress arrives over SSE.
 */

export default function ImportPage() {
  const { activeTenant, can } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [eventId, setEventId] = useState('');
  const [stage, setStage] = useState<ImportStageResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ['events', tenantId],
    queryFn: () => api.get<ListResult<EventView>>(`${API_PREFIX}/tenants/${tenantId}/events`),
    enabled: Boolean(tenantId),
  });

  const batches = useQuery({
    queryKey: ['imports', tenantId],
    queryFn: () =>
      api.get<ListResult<ImportStageResult & { status: string; createdAt: string }>>(
        `${API_PREFIX}/tenants/${tenantId}/imports`,
      ),
    enabled: Boolean(tenantId),
  });

  const job = useQuery({
    queryKey: ['job', tenantId, jobId],
    queryFn: () => api.get<JobRecord>(`${API_PREFIX}/tenants/${tenantId}/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data?.status === 'completed' || query.state.data?.status === 'failed'
        ? false
        : 2500,
  });

  /* Live progress over SSE so the bar moves without polling. */
  useRealtimeStream({
    tenantId,
    onEvent: (type, payload) => {
      if (type.startsWith('job.') || type.startsWith('import.')) {
        void queryClient.invalidateQueries({ queryKey: ['job', tenantId, jobId] });
        void queryClient.invalidateQueries({ queryKey: ['imports', tenantId] });
      }
      void payload;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('eventId', eventId);
      return api.upload<ImportStageResult>(`${API_PREFIX}/tenants/${tenantId}/imports`, form);
    },
    onSuccess: (result) => {
      setStage(result);
      setMapping(result.mapping);
      toast.success(
        `${result.fileName}: ${result.validRows} of ${result.totalRows} rows look valid`,
      );
      void queryClient.invalidateQueries({ queryKey: ['imports', tenantId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Upload failed'),
  });

  const issue = useMutation({
    mutationFn: async () => {
      if (!stage) throw new Error('Nothing staged');
      return api.post<ImportIssueResult>(
        `${API_PREFIX}/tenants/${tenantId}/imports/${stage.batchId}/issue`,
        { mapping, skipInvalid: true, sendEmail: true, continueOnFailure: true },
      );
    },
    onSuccess: (result) => {
      setJobId(result.jobId);
      toast.success(`Queued ${result.queued} certificate(s) across ${result.chunks} job chunk(s)`);
      void queryClient.invalidateQueries({ queryKey: ['imports', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not start issuance'),
  });

  const sample = useMutation({
    mutationFn: async (kind: 'csv' | 'xlsx') => {
      const response = await api.raw(`${API_PREFIX}/tenants/${tenantId}/imports/sample.${kind}`);
      await saveBlobResponse(response, `kdc-sample.${kind}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not download the sample'),
  });

  const columns: Column<ImportStageResult & { status: string; createdAt: string }>[] = [
    {
      key: 'fileName',
      header: 'File',
      render: (row) => <span className="text-xs font-medium">{truncate(row.fileName, 40)}</span>,
    },
    {
      key: 'rows',
      header: 'Rows',
      render: (row) => (
        <span className="text-xs">
          {formatNumber(row.validRows, locale)} / {formatNumber(row.totalRows, locale)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('certificates.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'createdAt',
      header: 'Uploaded',
      hideBelow: 'md',
      render: (row) => (
        <span className="text-xs text-[var(--kdc-text-muted)]">
          {formatDateTime(row.createdAt, locale)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.import')}
        description="Upload a roster, confirm the column mapping, preview exactly what will be issued, then queue it. Invalid rows are reported, never guessed."
        icon={FileDown}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={FileSpreadsheet}
              loading={sample.isPending}
              onClick={() => sample.mutate('csv')}
            >
              {t('import.sampleCsv')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={FileSpreadsheet}
              loading={sample.isPending}
              onClick={() => sample.mutate('xlsx')}
            >
              {t('import.sampleXlsx')}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="1 · Upload" icon={Upload} />
          <CardBody className="space-y-4">
            <Field label="Target event" required>
              {(id) => (
                <Select
                  id={id}
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value)}
                >
                  <option value="">Choose an event…</option>
                  {(events.data?.items ?? []).map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file && eventId) upload.mutate(file);
                else if (!eventId) toast.error('Choose the target event first');
              }}
              className={
                dragging
                  ? 'rounded-xl border-2 border-dashed border-[var(--kdc-brand)] bg-[color-mix(in_oklab,var(--kdc-brand)_6%,transparent)] px-4 py-10 text-center'
                  : 'rounded-xl border-2 border-dashed border-[var(--kdc-border)] px-4 py-10 text-center'
              }
            >
              <FileUp className="mx-auto size-7 text-[var(--kdc-text-muted)]" aria-hidden />
              <p className="mt-2 text-xs font-semibold">{t('import.dropFile')}</p>
              <p className="mt-1 text-[0.68rem] text-[var(--kdc-text-muted)]">
                .csv or .xlsx · up to 25 MB · header row required
              </p>
              <label className="kdc-btn kdc-btn-secondary mt-3 inline-flex !min-h-9 !py-1.5 !text-xs">
                Choose file
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) return;
                    if (!eventId) {
                      toast.error('Choose the target event first');
                      return;
                    }
                    upload.mutate(file);
                  }}
                />
              </label>
              {upload.isPending ? (
                <p className="mt-3 flex items-center justify-center gap-2 text-xs text-[var(--kdc-text-muted)]">
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden /> Parsing and validating
                  rows…
                </p>
              ) : null}
            </div>

            {stage ? (
              <div className="space-y-4">
                <Notice tone={stage.invalidRows > 0 ? 'warn' : 'ok'}>
                  {t('import.rowsValid', { valid: formatNumber(stage.validRows, locale) })}
                  {stage.invalidRows > 0
                    ? ` · ${t('import.rowsInvalid', { invalid: formatNumber(stage.invalidRows, locale) })}`
                    : ''}{' '}
                  · {formatNumber(stage.totalRows, locale)} total
                </Notice>

                <div>
                  <p className="mb-2 text-xs font-semibold">2 · {t('import.mapColumns')}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.keys(stage.mapping).length === 0
                      ? Object.keys(stage.preview[0] ?? {}).map((column) => (
                          <Field key={column} label={`Column "${column}"`}>
                            {(id) => (
                              <Select
                                id={id}
                                value={mapping[column] ?? ''}
                                onChange={(event) =>
                                  setMapping((previous) => ({
                                    ...previous,
                                    [column]: event.target.value,
                                  }))
                                }
                                className="!min-h-8 !py-1 !text-xs"
                              >
                                <option value="">(ignore)</option>
                                {stage?.canonicalColumns.map((canonical) => (
                                  <option key={canonical.key} value={canonical.key}>
                                    {canonical.label}
                                    {canonical.required ? ' *' : ''}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </Field>
                        ))
                      : Object.entries(stage.mapping).map(([column]) => (
                          <Field key={column} label={`Column "${column}"`}>
                            {(id) => (
                              <Select
                                id={id}
                                value={mapping[column] ?? ''}
                                onChange={(event) =>
                                  setMapping((previous) => ({
                                    ...previous,
                                    [column]: event.target.value,
                                  }))
                                }
                                className="!min-h-8 !py-1 !text-xs"
                              >
                                <option value="">(ignore)</option>
                                {stage?.canonicalColumns.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                    {option.required ? ' *' : ''}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </Field>
                        ))}
                  </div>
                  {stage.unmappedColumns.length > 0 ? (
                    <p className="mt-2 text-[0.68rem] text-[var(--kdc-text-muted)]">
                      Unrecognised columns: {stage.unmappedColumns.join(', ')}
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold">3 · {t('import.preview')}</p>
                  <div className="max-h-56 overflow-auto rounded-lg border border-[var(--kdc-border)]">
                    <table className="w-full text-left text-[0.68rem]">
                      <thead className="sticky top-0 bg-[var(--kdc-surface-sunken)]">
                        <tr>
                          {Object.keys(stage.preview[0] ?? { '#': '' }).map((key) => (
                            <th key={key} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stage.preview.slice(0, 10).map((row, index) => (
                          <tr key={index} className="border-t border-[var(--kdc-border)]/60">
                            {Object.values(row).map((value, columnIndex) => (
                              <td key={columnIndex} className="whitespace-nowrap px-2 py-1">
                                {value === null || value === '' ? (
                                  <span className="text-[var(--kdc-text-muted)]">—</span>
                                ) : (
                                  String(value)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {stage.errors.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-red-600 dark:text-red-400">
                      Rows that will be skipped
                    </p>
                    <ul className="max-h-32 space-y-1 overflow-auto rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-[0.68rem] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                      {stage.errors.slice(0, 40).map((error, index) => (
                        <li key={`${error.row}-${index}`}>
                          Row {error.row}: {error.message}
                        </li>
                      ))}
                      {stage.errors.length > 40 ? (
                        <li>…and {stage.errors.length - 40} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 border-t border-[var(--kdc-border)] pt-3">
                  <p className="text-[0.68rem] text-[var(--kdc-text-muted)]">{stage.nextStep}</p>
                  <Button
                    icon={CheckCircle2}
                    loading={issue.isPending}
                    disabled={stage.validRows === 0 || !can(['certificate:bulk_issue'])}
                    onClick={() => issue.mutate()}
                  >
                    4 · {t('import.startIssuing')}
                  </Button>
                </div>
              </div>
            ) : null}

            {jobId ? (
              <div className="rounded-xl border border-[var(--kdc-border)] bg-[var(--kdc-surface-sunken)] p-3">
                <div className="flex items-center justify-between text-xs">
                  <p className="font-semibold">Bulk job {jobId.slice(0, 8)}…</p>
                  <StatusBadge status={job.data?.status ?? 'queued'} />
                </div>
                <div className="mt-2">
                  <Progress value={job.data?.progress ?? 0} max={100} label="Job progress" />
                </div>
                <p className="mt-1.5 text-[0.68rem] text-[var(--kdc-text-muted)]">
                  {formatNumber(job.data?.processed ?? 0, locale)} /{' '}
                  {formatNumber(job.data?.total ?? 0, locale)} processed ·{' '}
                  {formatNumber(job.data?.succeeded ?? 0, locale)} succeeded ·{' '}
                  {formatNumber(job.data?.failed ?? 0, locale)} failed
                </p>
                {job.data?.status === 'completed' ? (
                  <Notice tone="ok" className="mt-2">
                    Completed. Certificates are listed under Certificates; failures can be retried
                    from Jobs.
                  </Notice>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader
            title="Recent imports"
            icon={FileSpreadsheet}
            action={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh"
                onClick={() => void batches.refetch()}
              >
                <RefreshCw className="size-3.5" aria-hidden />
              </Button>
            }
          />
          {batches.isError ? (
            <CardBody>
              <ErrorState
                message={
                  batches.error instanceof ApiError
                    ? batches.error.message
                    : 'Could not load imports'
                }
              />
            </CardBody>
          ) : (
            <DataTable
              rows={batches.data?.items ?? []}
              columns={columns}
              keyOf={(row) => row.batchId}
              loading={batches.isPending}
              empty={
                <p className="py-6 text-center text-xs text-[var(--kdc-text-muted)]">
                  No imports yet.
                </p>
              }
            />
          )}
          <CardBody className="border-t border-[var(--kdc-border)] !py-3">
            <p className="text-[0.68rem] text-[var(--kdc-text-muted)]">
              Bulk runs are chunked into jobs of 250 recipients and processed in the background.
              Progress here is pushed by the server in real time over server-sent events.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
