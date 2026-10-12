'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { ListResult, PublicCertificate } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Button,
  Card,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  StatusBadge,
  type Column,
} from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

interface ApprovalRow {
  id: string;
  status: string;
  requestedBy: string | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  certificate: PublicCertificate;
}

export default function ApprovalsPage() {
  const { activeTenant } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<{ row: ApprovalRow; decision: 'approve' | 'reject' } | null>(
    null,
  );
  const [reason, setReason] = useState('');

  const approvals = useQuery({
    queryKey: ['approvals', tenantId],
    queryFn: () =>
      api.get<ListResult<ApprovalRow>>(`${API_PREFIX}/tenants/${tenantId}/certificates/approvals`),
    enabled: Boolean(tenantId),
    refetchInterval: 15_000,
  });

  const decide = useMutation({
    mutationFn: async ({
      row,
      decision,
      reason: why,
    }: {
      row: ApprovalRow;
      decision: 'approve' | 'reject';
      reason: string;
    }) =>
      api.post(`${API_PREFIX}/tenants/${tenantId}/certificates/${row.certificate.id}/${decision}`, {
        reason: why || undefined,
      }),
    onSuccess: (_result, variables) => {
      toast.success(variables.decision === 'approve' ? 'Approved and issued' : 'Rejected');
      setTarget(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['approvals', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['certificates', tenantId] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not record the decision'),
  });

  const pending = (approvals.data?.items ?? []).filter((row) => row.status === 'pending');
  const decided = (approvals.data?.items ?? []).filter((row) => row.status !== 'pending');

  const columns: Column<ApprovalRow>[] = [
    {
      key: 'serial',
      header: t('verify.serial'),
      render: (row) => (
        <span className="font-mono text-xs font-semibold">{row.certificate.serial}</span>
      ),
    },
    {
      key: 'recipient',
      header: t('certificates.recipient'),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{row.certificate.recipient.name}</p>
          <p className="truncate text-[0.68rem] text-[var(--kdc-text-muted)]">
            {row.certificate.recipient.title ?? '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'requested',
      header: 'Requested',
      hideBelow: 'md',
      render: (row) => (
        <span className="text-xs text-[var(--kdc-text-muted)]">
          {formatDateTime(row.createdAt, locale)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('certificates.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (row) =>
        row.status === 'pending' ? (
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              icon={ThumbsUp}
              onClick={() => setTarget({ row, decision: 'approve' })}
            >
              {t('certificates.approve')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={ThumbsDown}
              onClick={() => setTarget({ row, decision: 'reject' })}
            >
              {t('certificates.reject')}
            </Button>
          </div>
        ) : (
          <span className="text-[0.68rem] text-[var(--kdc-text-muted)]">
            {row.decidedAt ? formatDateTime(row.decidedAt, locale) : '—'}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.approvals')}
        description="Certificates from events that require approval wait here until an approver decides. Decisions are audited."
        icon={ClipboardCheck}
      />

      {approvals.isError ? (
        <ErrorState
          message={
            approvals.error instanceof ApiError
              ? approvals.error.message
              : 'Could not load approvals'
          }
          onRetry={() => void approvals.refetch()}
        />
      ) : (
        <div className="space-y-5">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-[var(--kdc-border)] px-4 py-2.5 text-xs font-semibold">
              Awaiting decision ({pending.length})
            </div>
            <DataTable
              rows={pending}
              columns={columns}
              keyOf={(row) => row.id}
              loading={approvals.isPending}
              empty={
                <p className="py-8 text-center text-xs text-[var(--kdc-text-muted)]">
                  Nothing is waiting for approval.
                </p>
              }
            />
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-[var(--kdc-border)] px-4 py-2.5 text-xs font-semibold">
              Decided
            </div>
            <DataTable
              rows={decided.slice(0, 30)}
              columns={columns}
              keyOf={(row) => row.id}
              empty={
                <p className="py-6 text-center text-xs text-[var(--kdc-text-muted)]">
                  No decisions recorded yet.
                </p>
              }
            />
          </Card>
        </div>
      )}

      {target ? (
        <Modal
          open
          onOpenChange={(open) => !open && setTarget(null)}
          title={`${target.decision === 'approve' ? 'Approve' : 'Reject'} ${target.row.certificate.serial}`}
          description={
            target.decision === 'approve'
              ? 'Approving renders the PDF and issues the certificate immediately.'
              : 'Rejecting keeps the certificate out of circulation and records your reason.'
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => setTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={target.decision === 'approve' ? 'primary' : 'danger'}
                loading={decide.isPending}
                onClick={() =>
                  decide.mutate({ row: target.row, decision: target.decision, reason })
                }
              >
                {target.decision === 'approve'
                  ? t('certificates.approve')
                  : t('certificates.reject')}
              </Button>
            </>
          }
        >
          <Field label={target.decision === 'approve' ? 'Note (optional)' : 'Reason'}>
            {(id) => (
              <Input
                id={id}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  target.decision === 'approve'
                    ? 'Checked against the registrar list'
                    : 'Name misspelt on the roster'
                }
              />
            )}
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
