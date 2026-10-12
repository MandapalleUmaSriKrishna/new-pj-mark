'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Plug, Send, Trash2, Webhook } from 'lucide-react';
import type { ApiKey, WebhookDelivery, WebhookEvent } from '@kdc/shared';
import { WEBHOOK_EVENTS } from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type {
  ApiKeyCreateResult,
  ApiKeyScopes,
  ListResult,
  RedactedWebhook,
  WebhookCreateResult,
  WebhookTestResult,
} from '@/lib/types';
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
  StatusBadge,
  type Column,
} from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/utils';

export default function IntegrationsPage() {
  const { activeTenant, can } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();

  const [hookOpen, setHookOpen] = useState(false);
  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState<WebhookEvent[]>(['certificate.issued']);
  const [hookSecret, setHookSecret] = useState<WebhookCreateResult | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['certificates:read']);
  const [keySecret, setKeySecret] = useState<ApiKeyCreateResult | null>(null);

  const webhooks = useQuery({
    queryKey: ['webhooks', tenantId],
    queryFn: () =>
      api.get<ListResult<RedactedWebhook>>(`${API_PREFIX}/tenants/${tenantId}/webhooks`),
    enabled: Boolean(tenantId) && can(['webhook:manage']),
  });

  const deliveries = useQuery({
    queryKey: ['webhooks', 'deliveries', tenantId],
    queryFn: () =>
      api.get<ListResult<WebhookDelivery>>(`${API_PREFIX}/tenants/${tenantId}/webhooks/deliveries`),
    enabled: Boolean(tenantId) && can(['webhook:manage']),
  });

  const apiKeys = useQuery({
    queryKey: ['apikeys', tenantId],
    queryFn: () => api.get<ListResult<ApiKey>>(`${API_PREFIX}/tenants/${tenantId}/api-keys`),
    enabled: Boolean(tenantId) && can(['apikey:manage']),
  });

  const scopes = useQuery({
    queryKey: ['apikeys', 'scopes', tenantId],
    queryFn: () => api.get<ApiKeyScopes>(`${API_PREFIX}/tenants/${tenantId}/api-keys/scopes`),
    enabled: Boolean(tenantId) && can(['apikey:manage']),
  });

  const createHook = useMutation({
    mutationFn: () =>
      api.post<WebhookCreateResult>(`${API_PREFIX}/tenants/${tenantId}/webhooks`, {
        url: hookUrl,
        events: hookEvents,
      }),
    onSuccess: (result) => {
      setHookSecret(result);
      setHookUrl('');
      void queryClient.invalidateQueries({ queryKey: ['webhooks', tenantId] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.isPlanGate)
          toast.error(
            `${error.message} — ${t('errors.planGate', { plan: error.requiredPlan ?? 'starter' })}`,
          );
        else toast.error(error.message);
      } else toast.error('Could not create the endpoint');
    },
  });

  const testHook = useMutation({
    mutationFn: (hook: RedactedWebhook) =>
      api.post<WebhookTestResult>(`${API_PREFIX}/tenants/${tenantId}/webhooks/${hook.id}/test`, {}),
    onSuccess: (result) => {
      toast.message(`Test delivery ${result.deliveryId.slice(0, 8)}… queued (${result.status})`);
      void queryClient.invalidateQueries({ queryKey: ['webhooks', 'deliveries', tenantId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Test failed'),
  });

  const deleteHook = useMutation({
    mutationFn: (hook: RedactedWebhook) =>
      api.del(`${API_PREFIX}/tenants/${tenantId}/webhooks/${hook.id}`),
    onSuccess: () => {
      toast.success('Endpoint deleted');
      void queryClient.invalidateQueries({ queryKey: ['webhooks', tenantId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Delete failed'),
  });

  const createKey = useMutation({
    mutationFn: () =>
      api.post<ApiKeyCreateResult>(`${API_PREFIX}/tenants/${tenantId}/api-keys`, {
        name: keyName,
        scopes: keyScopes,
      }),
    onSuccess: (result) => {
      setKeySecret(result);
      setKeyName('');
      void queryClient.invalidateQueries({ queryKey: ['apikeys', tenantId] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.isPlanGate)
          toast.error(
            `${error.message} — ${t('errors.planGate', { plan: error.requiredPlan ?? 'starter' })}`,
          );
        else toast.error(error.message);
      } else toast.error('Could not create the key');
    },
  });

  const revokeKey = useMutation({
    mutationFn: (key: ApiKey) => api.del(`${API_PREFIX}/tenants/${tenantId}/api-keys/${key.id}`),
    onSuccess: () => {
      toast.success('Key revoked');
      void queryClient.invalidateQueries({ queryKey: ['apikeys', tenantId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Revoke failed'),
  });

  const hookColumns: Column<RedactedWebhook>[] = [
    {
      key: 'url',
      header: 'URL',
      render: (row) => <span className="break-all font-mono text-[0.7rem]">{row.url}</span>,
    },
    {
      key: 'events',
      header: 'Events',
      hideBelow: 'md',
      render: (row) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {row.events.map((event) => (
            <Badge key={event} tone="muted">
              {event}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('certificates.status'),
      render: (row) => <StatusBadge status={row.active ? 'active' : 'suspended'} />,
    },
    {
      key: 'secret',
      header: 'Secret',
      hideBelow: 'lg',
      render: (row) => (
        <span className="font-mono text-[0.68rem] text-[var(--kdc-text-muted)]">
          {row.secretPreview}
        </span>
      ),
    },
    {
      key: 'last',
      header: 'Last delivery',
      hideBelow: 'md',
      render: (row) => (
        <span className="text-xs text-[var(--kdc-text-muted)]">
          {row.lastDeliveryAt
            ? `${row.lastStatus ?? ''} ${formatRelative(row.lastDeliveryAt, locale)}`
            : 'never'}
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
            aria-label={`Send test to ${row.url}`}
            onClick={() => testHook.mutate(row)}
          >
            <Send className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-red-500"
            aria-label={`Delete ${row.url}`}
            onClick={() => deleteHook.mutate(row)}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  const keyColumns: Column<ApiKey>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span className="text-xs font-medium">{row.name}</span>,
    },
    {
      key: 'prefix',
      header: 'Key',
      render: (row) => (
        <span className="font-mono text-[0.7rem] text-[var(--kdc-text-muted)]">{row.prefix}…</span>
      ),
    },
    {
      key: 'scopes',
      header: t('apikeys.scopes'),
      hideBelow: 'md',
      render: (row) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {row.scopes.map((scope) => (
            <Badge key={scope} tone="info">
              {scope}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'lastUsed',
      header: 'Last used',
      hideBelow: 'md',
      render: (row) => (
        <span className="text-xs text-[var(--kdc-text-muted)]">
          {row.lastUsedAt ? formatRelative(row.lastUsedAt, locale) : 'never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-red-500"
          icon={Trash2}
          onClick={() => revokeKey.mutate(row)}
        >
          {t('apikeys.revoke')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.integrations')}
        description="Outbound signed webhooks and inbound scoped API keys. Both are plan-gated and honestly reported when gated."
        icon={Plug}
      />

      <div className="space-y-5">
        <Card className="overflow-hidden p-0">
          <CardHeader
            title={t('webhooks.endpoints')}
            icon={Webhook}
            description="HMAC-SHA256 signed, 300s replay tolerance, automatic retries with re-signing."
            action={
              can(['webhook:manage']) ? (
                <Button size="sm" icon={Webhook} onClick={() => setHookOpen(true)}>
                  {t('webhooks.new')}
                </Button>
              ) : null
            }
          />
          {webhooks.isError ? (
            <CardBody>
              <ErrorState
                message={
                  webhooks.error instanceof ApiError
                    ? webhooks.error.message
                    : 'Could not load endpoints'
                }
              />
            </CardBody>
          ) : (
            <DataTable
              rows={webhooks.data?.items ?? []}
              columns={hookColumns}
              keyOf={(row) => row.id}
              loading={webhooks.isPending}
              empty={
                <p className="py-8 text-center text-xs text-[var(--kdc-text-muted)]">
                  No webhook endpoints yet.
                </p>
              }
            />
          )}
        </Card>

        <Card className="overflow-hidden p-0">
          <CardHeader
            title={t('webhooks.deliveries')}
            description="Most recent attempts across all endpoints"
          />
          <ul className="divide-y divide-[var(--kdc-border)]">
            {(deliveries.data?.items ?? []).slice(0, 12).map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs"
              >
                <StatusBadge status={delivery.status} />
                <Badge tone="muted">{delivery.event}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-[0.68rem] text-[var(--kdc-text-muted)]">
                  {delivery.webhookId.slice(0, 8)}… · {delivery.event}
                </span>
                <span className="text-[var(--kdc-text-muted)]">
                  {delivery.responseStatus ? `HTTP ${delivery.responseStatus} · ` : ''}
                  {delivery.lastError ? `${delivery.lastError} · ` : ''}
                  {formatDateTime(delivery.createdAt, locale)} · attempts {delivery.attempts}/
                  {delivery.maxAttempts}
                </span>
              </li>
            ))}
            {(deliveries.data?.items ?? []).length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-[var(--kdc-text-muted)]">
                No deliveries yet.
              </li>
            ) : null}
          </ul>
        </Card>

        <Card className="overflow-hidden p-0">
          <CardHeader
            title={t('nav.apiKeys')}
            icon={KeyRound}
            description="Hashed at rest, compared in constant time, scoped per route family."
            action={
              can(['apikey:manage']) ? (
                <Button size="sm" icon={KeyRound} onClick={() => setKeyOpen(true)}>
                  {t('apikeys.new')}
                </Button>
              ) : null
            }
          />
          {apiKeys.isError ? (
            <CardBody>
              <ErrorState
                message={
                  apiKeys.error instanceof ApiError ? apiKeys.error.message : 'Could not load keys'
                }
              />
            </CardBody>
          ) : (
            <DataTable
              rows={apiKeys.data?.items ?? []}
              columns={keyColumns}
              keyOf={(row) => row.id}
              loading={apiKeys.isPending}
              empty={
                <p className="py-8 text-center text-xs text-[var(--kdc-text-muted)]">
                  No API keys yet.
                </p>
              }
            />
          )}
        </Card>
      </div>

      {/* Webhook create */}
      <Modal
        open={hookOpen}
        onOpenChange={(open) => {
          setHookOpen(open);
          if (!open) setHookSecret(null);
        }}
        title={t('webhooks.new')}
        description={t('webhooks.privateBlocked')}
        footer={
          hookSecret ? (
            <Button onClick={() => setHookSecret(null)}>{t('common.close')}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setHookOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                icon={Webhook}
                loading={createHook.isPending}
                onClick={() => createHook.mutate()}
              >
                {t('common.create')}
              </Button>
            </>
          )
        }
      >
        {hookSecret ? (
          <div className="space-y-3">
            <Notice tone="warn">{t('webhooks.secretOnce')}</Notice>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={hookSecret.secret}
                className="font-mono text-[0.7rem]"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton value={hookSecret.secret} />
            </div>
            <p className="text-[0.68rem] text-[var(--kdc-text-muted)]">
              Sign requests with{' '}
              <code className="font-mono">x-kdc-signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>{' '}
              over <code className="font-mono">{'{timestamp}.{body}'}</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={t('webhooks.url')} required hint="Must be a public https:// address.">
              {(id) => (
                <Input
                  id={id}
                  value={hookUrl}
                  onChange={(event) => setHookUrl(event.target.value)}
                  placeholder="https://api.example.org/hooks/kdc"
                />
              )}
            </Field>
            <Field label={t('webhooks.events')} required>
              {() => (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label key={event} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded border-[var(--kdc-border)]"
                        checked={hookEvents.includes(event)}
                        onChange={(change) =>
                          setHookEvents((previous) =>
                            change.target.checked
                              ? [...previous, event]
                              : previous.filter((entry) => entry !== event),
                          )
                        }
                      />
                      <span className="font-mono text-[0.68rem]">{event}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
          </div>
        )}
      </Modal>

      {/* API key create */}
      <Modal
        open={keyOpen}
        onOpenChange={(open) => {
          setKeyOpen(open);
          if (!open) setKeySecret(null);
        }}
        title={t('apikeys.new')}
        description="Send it as Authorization: Bearer &lt;key&gt; or X-API-Key on routes that allow keys."
        footer={
          keySecret ? (
            <Button onClick={() => setKeySecret(null)}>{t('common.close')}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setKeyOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                icon={KeyRound}
                loading={createKey.isPending}
                onClick={() => createKey.mutate()}
              >
                {t('common.create')}
              </Button>
            </>
          )
        }
      >
        {keySecret ? (
          <div className="space-y-3">
            <Notice tone="warn">{t('apikeys.plaintextOnce')}</Notice>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={keySecret.plaintext}
                className="font-mono text-[0.7rem]"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton value={keySecret.plaintext} />
            </div>
            <p className="text-[0.68rem] text-[var(--kdc-text-muted)]">{keySecret.usage}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Name" required>
              {(id) => (
                <Input
                  id={id}
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  placeholder="Student information system"
                />
              )}
            </Field>
            <Field label={t('apikeys.scopes')} required>
              {() => (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {(scopes.data?.scopes ?? []).map((scope) => (
                    <label key={scope} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded border-[var(--kdc-border)]"
                        checked={keyScopes.includes(scope)}
                        onChange={(change) =>
                          setKeyScopes((previous) =>
                            change.target.checked
                              ? [...previous, scope]
                              : previous.filter((entry) => entry !== scope),
                          )
                        }
                      />
                      <span className="font-mono text-[0.68rem]">{scope}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
