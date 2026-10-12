'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Trash2, UserPlus, Users } from 'lucide-react';
import { ALL_ROLES, ROLE_PERMISSIONS, type Role } from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { InviteResult, ListResult, MemberRow, PendingInvite } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  Notice,
  Select,
  StatusBadge,
  type Column,
} from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/utils';

export default function TeamPage() {
  const { activeTenant, user, can } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('issuer');
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);

  const members = useQuery({
    queryKey: ['members', tenantId],
    queryFn: () => api.get<ListResult<MemberRow>>(`${API_PREFIX}/tenants/${tenantId}/members`),
    enabled: Boolean(tenantId),
  });

  const pending = useQuery({
    queryKey: ['members', 'pending', tenantId],
    queryFn: () =>
      api.get<ListResult<PendingInvite>>(`${API_PREFIX}/tenants/${tenantId}/members/pending`),
    enabled: Boolean(tenantId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['members', tenantId] });
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  };

  const invite = useMutation({
    mutationFn: () =>
      api.post<InviteResult>(`${API_PREFIX}/tenants/${tenantId}/members`, {
        email: inviteEmail,
        name: inviteName || undefined,
        role: inviteRole,
      }),
    onSuccess: (result) => {
      setInviteResult(result);
      setInviteEmail('');
      setInviteName('');
      invalidate();
      if (result.queued) toast.success(`Invitation queued for ${result.email}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Invitation failed'),
  });

  const changeRole = useMutation({
    mutationFn: ({ member, role }: { member: MemberRow; role: Role }) =>
      api.patch(`${API_PREFIX}/tenants/${tenantId}/members/${member.membershipId}`, { role }),
    onSuccess: () => {
      toast.success('Role updated');
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change the role'),
  });

  const remove = useMutation({
    mutationFn: (member: MemberRow) =>
      api.del(`${API_PREFIX}/tenants/${tenantId}/members/${member.membershipId}`),
    onSuccess: () => {
      setRemoveTarget(null);
      toast.success('Member removed');
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not remove the member'),
  });

  const resend = useMutation({
    mutationFn: (membershipId: string) =>
      api.post<InviteResult>(
        `${API_PREFIX}/tenants/${tenantId}/members/${membershipId}/resend`,
        {},
      ),
    onSuccess: (result) => {
      toast.success(
        result.inviteUrl ? 'New invite link created — copy it below' : 'Invitation re-sent',
      );
      if (result.inviteUrl) setInviteResult(result);
      invalidate();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not resend'),
  });

  const columns: Column<MemberRow>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">
            {row.name}
            {row.email === user?.email ? (
              <span className="ml-1 text-[0.65rem] text-[var(--kdc-text-muted)]">(you)</span>
            ) : null}
          </p>
          <p className="truncate text-[0.68rem] text-[var(--kdc-text-muted)]">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('team.role'),
      render: (row) =>
        can(['member:update']) && row.role !== 'owner' ? (
          <Select
            value={row.role}
            onChange={(event) =>
              changeRole.mutate({ member: row, role: event.target.value as Role })
            }
            className="!min-h-8 !w-28 !py-1 !text-xs"
            aria-label={`Role for ${row.email}`}
          >
            {ALL_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={row.role === 'owner' ? 'info' : 'muted'}>{row.role}</Badge>
        ),
    },
    {
      key: 'status',
      header: t('certificates.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'permissions',
      header: 'Permissions',
      hideBelow: 'lg',
      render: (row) => (
        <span className="text-[0.68rem] text-[var(--kdc-text-muted)]">
          {row.permissions.length} granted
        </span>
      ),
    },
    {
      key: 'joined',
      header: 'Joined',
      hideBelow: 'md',
      render: (row) => (
        <span className="text-xs text-[var(--kdc-text-muted)]">
          {row.joinedAt
            ? formatDateTime(row.joinedAt, locale)
            : row.inviteExpiresAt
              ? `invite expires ${formatRelative(row.inviteExpiresAt, locale)}`
              : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (row) =>
        can(['member:remove']) && row.role !== 'owner' && row.email !== user?.email ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-red-500"
            aria-label={`Remove ${row.email}`}
            onClick={() => setRemoveTarget(row)}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.team')}
        description="Roles map to permission sets server-side; the UI only offers what each role can actually do."
        icon={Users}
        actions={
          can(['member:invite']) ? (
            <Button size="sm" icon={UserPlus} onClick={() => setInviteOpen(true)}>
              {t('team.invite')}
            </Button>
          ) : null
        }
      />

      {members.isError ? (
        <ErrorState
          message={
            members.error instanceof ApiError ? members.error.message : 'Could not load the team'
          }
          onRetry={() => void members.refetch()}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <DataTable
            rows={members.data?.items ?? []}
            columns={columns}
            keyOf={(row) => row.membershipId}
            loading={members.isPending}
            empty={
              <p className="py-8 text-center text-xs text-[var(--kdc-text-muted)]">
                No members yet.
              </p>
            }
          />
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pending invitations" icon={Mail} />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--kdc-border)]">
              {(pending.data?.items ?? []).map((row) => (
                <li key={row.membershipId} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.email}</p>
                    <p className="text-[0.68rem] text-[var(--kdc-text-muted)]">
                      {row.role} · expires{' '}
                      {row.inviteExpiresAt ? formatRelative(row.inviteExpiresAt, locale) : '—'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={resend.isPending && resend.variables === row.membershipId}
                    onClick={() => resend.mutate(row.membershipId)}
                  >
                    Resend
                  </Button>
                </li>
              ))}
              {(pending.data?.items ?? []).length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-[var(--kdc-text-muted)]">
                  No outstanding invitations.
                </li>
              ) : null}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Role reference"
            description="What each role can do, from the shared permission map"
          />
          <CardBody className="space-y-2">
            {ALL_ROLES.map((role) => (
              <details
                key={role}
                className="rounded-lg border border-[var(--kdc-border)] px-3 py-2"
              >
                <summary className="cursor-pointer text-xs font-semibold capitalize">
                  {role}
                </summary>
                <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--kdc-text-muted)]">
                  {(ROLE_PERMISSIONS[role] as readonly string[]).join(', ')}
                </p>
              </details>
            ))}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) setInviteResult(null);
        }}
        title={t('team.invite')}
        description="The invitee gets the role immediately on accepting; invitations expire after 14 days."
        footer={
          inviteResult ? (
            <Button onClick={() => setInviteResult(null)}>{t('common.close')}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setInviteOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button icon={UserPlus} loading={invite.isPending} onClick={() => invite.mutate()}>
                Send invitation
              </Button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div className="space-y-3">
            <Notice tone="info">{t('team.inviteUrlOnce')}</Notice>
            {inviteResult.inviteUrl ? (
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={inviteResult.inviteUrl}
                  className="font-mono text-[0.7rem]"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton value={inviteResult.inviteUrl} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={t('auth.email')} required>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teammate@organisation.edu"
                />
              )}
            </Field>
            <Field label={t('auth.name')}>
              {(id) => (
                <Input
                  id={id}
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  placeholder="Optional display name"
                />
              )}
            </Field>
            <Field
              label={t('team.role')}
              hint="Owners can only be managed by other owners; the last active owner cannot be removed."
            >
              {(id) => (
                <Select
                  id={id}
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as Role)}
                >
                  {ALL_ROLES.filter((role) => role !== 'owner').map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
      </Modal>

      {removeTarget ? (
        <Modal
          open
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          title={`Remove ${removeTarget.email}?`}
          description="They lose access immediately. Certificates they issued remain valid and attributed."
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                icon={Trash2}
                loading={remove.isPending}
                onClick={() => remove.mutate(removeTarget)}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p className="text-xs text-[var(--kdc-text-muted)]">Role: {removeTarget.role}</p>
        </Modal>
      ) : null}
    </>
  );
}
