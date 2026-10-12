'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Gauge, RefreshCw } from 'lucide-react';
import type { JobRecord } from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { JobQueueCounts, ListResult } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  ErrorState,
  Progress,
  StatusBadge,
  type Column,
} from '@/components/ui';
import { formatDateTime, formatNumber, titleCase, truncate } from '@/lib/utils';
import { useRealtimeStream } from '@/lib/realtime';

export default function JobsPage() {
  const { activeTenant } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();

  const jobs = useQuery({
    queryKey: ['jobs', tenantId],
    queryFn: () =>
      api.get<ListResult<JobRecord> & { types: string[] }>(
        `${API_PREFIX}/tenants/${tenantId}/jobs`,
      ),
    enabled: Boolean(tenantId),
    refetchInterval: 5000,
  });

  const queue = useQuery({
    queryKey: ['jobs', 'queue', tenantId],
    queryFn: () => api.get<JobQueueCounts>(`${API_PREFIX}/tenants/${tenantId}/jobs/queue`),
    enabled: Boolean(tenantId),
    refetchInterval: 5000,
  });

  useRealtimeStream({
    tenantId,
    onEvent: (type) => {
      if (type.startsWith('job.')) {
        void queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
        void queryClient.invalidateQueries({ queryKey: ['jobs', 'queue', tenantId] });
      }
    },
  });

  const retry = useMutation({
    mutationFn: (job: JobRecord) =>
      api.post(`${API_PREFIX}/tenants/${tenantId}/jobs/${job.id}/retry`, {}),
    onSuccess: () => {
      toast.success('Job re-queued');
      void queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Retry failed'),
  });

  const columns: Column<JobRecord>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (row) => <Badge tone="info">{titleCase(row.type)}</Badge>,
    },
    {
      key: 'status',
      header: t('certificates.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (row) => (
        <div className="w-32">
          <Progress value={row.progress ?? 0} max={100} label={`${row.type} progress`} />
          <p className="mt-0.5 text-[0.65rem] text-[var(--kdc-text-muted)]">
            {formatNumber(row.processed ?? 0, locale)} / {formatNumber(row.total ?? 0, locale)}
          </p>
        </div>
      ),
    },
    {
      key: 'attempts',
      header: 'Attempts',
      hideBelow: 'md',
      render: (row) => <span className="text-xs tabular-nums">{row.attempts ?? 0}</span>,
    },
    {
      key: 'error',
      header: 'Last error',
      hideBelow: 'lg',
      render: (row) => (
        <span className="block max-w-xs truncate text-[0.68rem] text-red-600 dark:text-red-400">
          {row.error ?? ''}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      hideBelow: 'md',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-[var(--kdc-text-muted)]">
          {formatDateTime(row.updatedAt, locale)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (row) =>
        row.status === 'failed' ? (
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={retry.isPending && retry.variables?.id === row.id}
            onClick={() => retry.mutate(row)}
          >
            Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.jobs')}
        description="Background work: bulk issuance chunks, PDF renders, email and webhook deliveries. Failures keep their reason and can be retried."
        icon={Gauge}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            onClick={() => {
              void jobs.refetch();
              void queue.refetch();
            }}
          >
            Refresh
          </Button>
        }
      />

      {queue.data ? (
        <Card className="mb-4">
          <CardBody className="flex flex-wrap items-center gap-3 !py-3">
            <span className="text-xs font-semibold">
              Queue driver: <Badge tone="muted">{queue.data.driver}</Badge>
            </span>
            {Object.entries(queue.data.counts).map(([state, count]) => (
              <span
                key={state}
                className="flex items-center gap-1.5 text-xs text-[var(--kdc-text-muted)]"
              >
                {titleCase(state)}{' '}
                <strong className="tabular-nums text-[var(--kdc-text)]">
                  {formatNumber(count, locale)}
                </strong>
              </span>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {jobs.isError ? (
        <ErrorState
          message={jobs.error instanceof ApiError ? jobs.error.message : 'Could not load jobs'}
          onRetry={() => void jobs.refetch()}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <DataTable
            rows={jobs.data?.items ?? []}
            columns={columns}
            keyOf={(row) => row.id}
            loading={jobs.isPending}
            empty={
              <p className="py-8 text-center text-xs text-[var(--kdc-text-muted)]">
                No jobs yet — bulk runs and deliveries appear here.
              </p>
            }
          />
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="How jobs behave" />
        <CardBody className="text-xs leading-relaxed text-[var(--kdc-text-muted)]">
          Bulk issuance splits recipients into chunks of 250 and queues each chunk separately, so
          one bad row cannot stall a run. Progress is recomputed from the certificates themselves,
          which is why the bar matches the certificate list exactly. Failed chunks keep{' '}
          {truncate('their per-row failure reasons in the job payload', 60)} and can be retried from
          here.
        </CardBody>
      </Card>
    </>
  );
}
