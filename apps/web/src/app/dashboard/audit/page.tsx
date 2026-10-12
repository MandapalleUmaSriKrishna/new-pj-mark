'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, GitCommitVertical, ShieldCheck } from 'lucide-react';
import type { AuditLog } from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { AuditVerifyResult, ListResult } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Notice,
  Pagination,
  type Column,
} from '@/components/ui';
import { formatDateTime, saveBlobResponse, truncate } from '@/lib/utils';

const PAGE_SIZE = 25;

/**
 * The audit log is append-only and hash-chained on the server. This page lets
 * an operator verify the chain themselves: the API recomputes every link and
 * reports the first broken one, so trust does not depend on the UI.
 */
export default function AuditPage() {
  const { activeTenant } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const [page, setPage] = useState(1);

  const audit = useQuery({
    queryKey: ['audit', tenantId, page],
    queryFn: () =>
      api.get<ListResult<AuditLog>>(`${API_PREFIX}/tenants/${tenantId}/audit`, {
        query: { page, pageSize: PAGE_SIZE },
      }),
    enabled: Boolean(tenantId),
  });

  const verify = useMutation({
    mutationFn: () =>
      api.post<AuditVerifyResult>(`${API_PREFIX}/tenants/${tenantId}/audit/verify`, {}),
    onSuccess: (result) => {
      if (result.ok) toast.success(`Audit chain intact across ${result.checked} entries`);
      else toast.error(`Chain broken at ${result.brokenAt ?? 'unknown entry'}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Verification failed'),
  });

  const exportCsv = useMutation({
    mutationFn: async () => {
      const response = await api.raw(`${API_PREFIX}/tenants/${tenantId}/audit/export.csv`);
      await saveBlobResponse(response, 'audit-log.csv');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Export failed'),
  });

  const columns: Column<AuditLog>[] = [
    {
      key: 'at',
      header: 'When',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-[var(--kdc-text-muted)]">
          {formatDateTime(row.createdAt, locale)}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <Badge
          tone={
            row.severity === 'warning' ? 'warn' : row.severity === 'critical' ? 'danger' : 'muted'
          }
        >
          {row.action}
        </Badge>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{row.actorEmail ?? 'system'}</p>
          <p className="text-[0.68rem] text-[var(--kdc-text-muted)]">{row.actorRole}</p>
        </div>
      ),
    },
    {
      key: 'entity',
      header: 'Entity',
      hideBelow: 'md',
      render: (row) => (
        <span className="font-mono text-[0.68rem] text-[var(--kdc-text-muted)]">
          {row.entityType}:{truncate(row.entityId ?? '—', 8)}
        </span>
      ),
    },
    {
      key: 'payload',
      header: 'Payload',
      hideBelow: 'lg',
      render: (row) => (
        <span className="block max-w-xs truncate font-mono text-[0.65rem] text-[var(--kdc-text-muted)]">
          {JSON.stringify(row.payload)}
        </span>
      ),
    },
    {
      key: 'hash',
      header: 'Chain',
      hideBelow: 'lg',
      render: (row) => (
        <span className="font-mono text-[0.65rem] text-[var(--kdc-text-muted)]">
          {truncate(row.hash ?? '', 12)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.audit')}
        description="Every security-relevant action, append-only, each entry hashed over the previous one. Verify the chain to prove nothing was edited or removed."
        icon={GitCommitVertical}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={ShieldCheck}
              loading={verify.isPending}
              onClick={() => verify.mutate()}
            >
              Verify chain
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              loading={exportCsv.isPending}
              onClick={() => exportCsv.mutate()}
            >
              Export CSV
            </Button>
          </>
        }
      />

      {verify.data ? (
        <Notice tone={verify.data.ok ? 'ok' : 'danger'} className="mb-4">
          {verify.data.ok
            ? `Chain verified: ${verify.data.checked} entries, no break.`
            : `Chain BROKEN at ${verify.data.brokenAt ?? 'an unknown entry'}. Investigate immediately.`}
        </Notice>
      ) : null}

      {audit.isError ? (
        <ErrorState
          message={
            audit.error instanceof ApiError ? audit.error.message : 'Could not load the audit log'
          }
          onRetry={() => void audit.refetch()}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <DataTable
            rows={audit.data?.items ?? []}
            columns={columns}
            keyOf={(row) => row.id}
            loading={audit.isPending}
            empty={
              <p className="py-8 text-center text-xs text-[var(--kdc-text-muted)]">
                No audit entries yet.
              </p>
            }
          />
          {audit.data ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={audit.data.total ?? 0}
              onPage={setPage}
            />
          ) : null}
        </Card>
      )}
    </>
  );
}
