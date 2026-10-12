'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Globe2, Palette, Save, Settings2 } from 'lucide-react';
import {
  SUPPORTED_LOCALES,
  type Locale,
  type TenantBranding,
  type TenantSettings,
} from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n, LOCALE_LABELS } from '@/lib/i18n';
import type { DomainListResult, TenantView } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '@/components/ui';
import { isSafeColor } from '@/lib/branding';

export default function SettingsPage() {
  const { activeTenant, can } = useSession();
  const { t } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();

  const tenant = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => api.get<TenantView>(`${API_PREFIX}/tenants/${tenantId}`),
    enabled: Boolean(tenantId),
  });

  const domains = useQuery({
    queryKey: ['domains', tenantId],
    queryFn: () => api.get<DomainListResult>(`${API_PREFIX}/tenants/${tenantId}/domains`),
    enabled: Boolean(tenantId),
  });

  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [settings, setSettings] = useState<TenantSettings | null>(null);

  useEffect(() => {
    if (tenant.data) {
      setBranding(tenant.data.branding);
      setSettings(tenant.data.settings);
    }
  }, [tenant.data]);

  const saveBranding = useMutation({
    mutationFn: () =>
      api.patch<TenantView>(`${API_PREFIX}/tenants/${tenantId}/branding`, branding ?? {}),
    onSuccess: (view) => {
      toast.success('Branding saved');
      setBranding(view.branding);
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.fields.map((field) => `${field.field}: ${field.message}`).join(' · ') ||
              error.message
          : 'Save failed',
      ),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api.patch<TenantView>(`${API_PREFIX}/tenants/${tenantId}/settings`, settings ?? {}),
    onSuccess: (view) => {
      toast.success('Settings saved');
      setSettings(view.settings);
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.fields.map((field) => `${field.field}: ${field.message}`).join(' · ') ||
              error.message
          : 'Save failed',
      ),
  });

  if (tenant.isError) {
    return (
      <ErrorState
        message={
          tenant.error instanceof ApiError ? tenant.error.message : 'Could not load settings'
        }
        onRetry={() => void tenant.refetch()}
      />
    );
  }

  if (!branding || !settings) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner />
      </div>
    );
  }

  const canBrand = can(['branding:update']);
  const canSettings = can(['tenant:update']);
  const whiteLabelGated =
    !activeTenant?.planId || activeTenant.planId === 'free' || activeTenant.planId === 'starter';

  return (
    <>
      <PageHeader
        title={t('nav.settings')}
        description="Organisation identity, issuance defaults and custom domains."
        icon={Settings2}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('settings.branding')}
            icon={Palette}
            action={
              canBrand ? (
                <Button
                  size="sm"
                  icon={Save}
                  loading={saveBranding.isPending}
                  onClick={() => saveBranding.mutate()}
                >
                  {t('common.save')}
                </Button>
              ) : null
            }
          />
          <CardBody className="space-y-3">
            {whiteLabelGated ? (
              <Notice tone="info">
                Hiding the “powered by” line and using your own verification domain are white-label
                features on higher plans; colours and logos work on every plan.
              </Notice>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.primaryColor')}>
                {(id) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      type="color"
                      value={isSafeColor(branding.primaryColor) ? branding.primaryColor : '#1d40f0'}
                      onChange={(event) =>
                        setBranding({ ...branding, primaryColor: event.target.value })
                      }
                      className="!h-9 !w-12 !p-1"
                    />
                    <Input
                      value={branding.primaryColor}
                      onChange={(event) =>
                        setBranding({ ...branding, primaryColor: event.target.value })
                      }
                      className="font-mono !text-xs"
                      aria-label="Primary colour hex"
                    />
                  </div>
                )}
              </Field>
              <Field label={t('settings.secondaryColor')}>
                {(id) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      type="color"
                      value={
                        isSafeColor(branding.secondaryColor) ? branding.secondaryColor : '#d4a94a'
                      }
                      onChange={(event) =>
                        setBranding({ ...branding, secondaryColor: event.target.value })
                      }
                      className="!h-9 !w-12 !p-1"
                    />
                    <Input
                      value={branding.secondaryColor ?? ''}
                      onChange={(event) =>
                        setBranding({ ...branding, secondaryColor: event.target.value })
                      }
                      className="font-mono !text-xs"
                      aria-label="Secondary colour hex"
                    />
                  </div>
                )}
              </Field>
            </div>
            <Field label={t('settings.tagline')}>
              {(id) => (
                <Input
                  id={id}
                  value={branding.tagline ?? ''}
                  onChange={(event) => setBranding({ ...branding, tagline: event.target.value })}
                  placeholder="Excellence in Education"
                />
              )}
            </Field>
            <Field label="Support email">
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={branding.supportEmail ?? ''}
                  onChange={(event) =>
                    setBranding({ ...branding, supportEmail: event.target.value })
                  }
                />
              )}
            </Field>
            <Field label="Website">
              {(id) => (
                <Input
                  id={id}
                  value={branding.website ?? ''}
                  onChange={(event) => setBranding({ ...branding, website: event.target.value })}
                  placeholder="https://…"
                />
              )}
            </Field>
            <Field label={t('settings.footerText')}>
              {(id) => (
                <Input
                  id={id}
                  value={branding.certificateFooterText ?? ''}
                  onChange={(event) =>
                    setBranding({ ...branding, certificateFooterText: event.target.value })
                  }
                  placeholder="Printed at the foot of every certificate"
                />
              )}
            </Field>
            <div className="flex items-center gap-2.5">
              <Switch
                checked={branding.hidePoweredBy}
                onCheckedChange={(value) => setBranding({ ...branding, hidePoweredBy: value })}
                label={t('settings.hidePoweredBy')}
                disabled={whiteLabelGated}
              />
              <span className="text-xs">{t('settings.hidePoweredBy')}</span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Issuance & verification defaults"
            icon={Settings2}
            action={
              canSettings ? (
                <Button
                  size="sm"
                  icon={Save}
                  loading={saveSettings.isPending}
                  onClick={() => saveSettings.mutate()}
                >
                  {t('common.save')}
                </Button>
              ) : null
            }
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.locale')}>
                {(id) => (
                  <Select
                    id={id}
                    value={settings.locale}
                    onChange={(event) =>
                      setSettings({ ...settings, locale: event.target.value as Locale })
                    }
                  >
                    {SUPPORTED_LOCALES.map((locale) => (
                      <option key={locale} value={locale}>
                        {LOCALE_LABELS[locale].label} ({locale})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('settings.timezone')}>
                {(id) => (
                  <Input
                    id={id}
                    value={settings.timezone}
                    onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
                    placeholder="Asia/Kolkata"
                  />
                )}
              </Field>
              <Field label={t('settings.serialPrefix')} hint="2–6 letters, e.g. KDC">
                {(id) => (
                  <Input
                    id={id}
                    value={settings.serialPrefix}
                    onChange={(event) =>
                      setSettings({ ...settings, serialPrefix: event.target.value.toUpperCase() })
                    }
                    className="font-mono"
                  />
                )}
              </Field>
              <Field label={t('settings.downloadTtl')}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={365}
                    value={settings.downloadLinkTtlDays}
                    onChange={(event) =>
                      setSettings({ ...settings, downloadLinkTtlDays: Number(event.target.value) })
                    }
                  />
                )}
              </Field>
            </div>

            <div className="space-y-2.5 border-t border-[var(--kdc-border)] pt-3">
              {(
                [
                  ['requireApproval', t('events.requireApproval')],
                  ['autoDeliverEmail', t('events.autoDeliver')],
                  ['allowSelfDownload', t('settings.selfDownload')],
                  ['selfDownloadRequiresEmail', t('settings.requireEmail')],
                  ['verificationPublic', t('settings.publicVerification')],
                  ['watermarkDrafts', 'Watermark un-issued drafts'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2.5">
                  <Switch
                    checked={Boolean(settings[key])}
                    onCheckedChange={(value) => setSettings({ ...settings, [key]: value })}
                    label={label}
                  />
                  <span className="text-xs">{label}</span>
                </div>
              ))}
            </div>

            <Field
              label={t('settings.emailSubject')}
              hint="Merge tokens like {{tenant.name}} and {{recipient.name}} are substituted per recipient."
            >
              {(id) => (
                <Input
                  id={id}
                  value={settings.defaultEmailSubject}
                  onChange={(event) =>
                    setSettings({ ...settings, defaultEmailSubject: event.target.value })
                  }
                />
              )}
            </Field>
            <Field label={t('settings.emailBody')}>
              {(id) => (
                <Textarea
                  id={id}
                  value={settings.defaultEmailBody}
                  onChange={(event) =>
                    setSettings({ ...settings, defaultEmailBody: event.target.value })
                  }
                  className="!min-h-32 font-mono !text-xs"
                />
              )}
            </Field>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t('settings.domains')}
          icon={Globe2}
          description="Serve verification and downloads from your own hostname."
        />
        <CardBody className="space-y-3">
          {domains.data && !domains.data.enabled ? (
            <Notice tone="warn">{t('settings.domainsDisabled')}</Notice>
          ) : (
            <ul className="space-y-2">
              {(domains.data?.items ?? []).map((domain) => (
                <li
                  key={domain.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--kdc-border)] px-3 py-2 text-xs"
                >
                  <span className="font-mono">{domain.hostname}</span>
                  <Badge tone={domain.status === 'verified' ? 'ok' : 'warn'}>{domain.status}</Badge>
                </li>
              ))}
              {(domains.data?.items ?? []).length === 0 ? (
                <li className="text-xs text-[var(--kdc-text-muted)]">
                  No custom domains configured.
                </li>
              ) : null}
            </ul>
          )}
          <p className="text-[0.68rem] text-[var(--kdc-text-muted)]">
            Primary domain today:{' '}
            <span className="font-mono">
              {tenant.data?.primaryDomain ?? 'the shared app domain'}
            </span>
          </p>
        </CardBody>
      </Card>
    </>
  );
}
