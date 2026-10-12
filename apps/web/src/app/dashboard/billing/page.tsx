'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, ChartColumn, CreditCard, ReceiptText } from 'lucide-react';
import { PLANS, PLAN_ORDER, type PlanId } from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { BillingSummary, InvoiceListResult, PlanChangeResult } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Notice,
  Progress,
} from '@/components/ui';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';

export default function BillingPage() {
  const { activeTenant } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();

  const billing = useQuery({
    queryKey: ['billing', tenantId],
    queryFn: () => api.get<BillingSummary>(`${API_PREFIX}/tenants/${tenantId}/billing`),
    enabled: Boolean(tenantId),
  });

  const invoices = useQuery({
    queryKey: ['billing', 'invoices', tenantId],
    queryFn: () => api.get<InvoiceListResult>(`${API_PREFIX}/tenants/${tenantId}/billing/invoices`),
    enabled: Boolean(tenantId),
  });

  const changePlan = useMutation({
    mutationFn: (planId: PlanId) =>
      api.post<PlanChangeResult>(`${API_PREFIX}/tenants/${tenantId}/billing/plan`, { planId }),
    onSuccess: (result) => {
      toast.success(result.notice);
      void queryClient.invalidateQueries({ queryKey: ['billing', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Plan change failed'),
  });

  if (billing.isError) {
    return (
      <ErrorState
        message={
          billing.error instanceof ApiError ? billing.error.message : 'Could not load billing'
        }
        onRetry={() => void billing.refetch()}
      />
    );
  }

  const summary = billing.data;
  const currentPlan = summary?.plan.id ?? activeTenant?.planId ?? 'free';

  return (
    <>
      <PageHeader
        title={t('nav.billing')}
        description="Plan, usage and invoices. Plan limits are enforced server-side on every write."
        icon={ChartColumn}
      />

      {!summary ? (
        <div className="grid gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-xl bg-[var(--kdc-surface)]" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {!summary.paymentConfigured ? (
            <Notice tone="info" className="flex items-start gap-2">
              <CreditCard className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {t('billing.providerManual')} Provider: <strong>{summary.provider}</strong>.
                {summary.notice ? ` ${summary.notice}` : ''}
              </span>
            </Notice>
          ) : null}

          {summary.blockers.length > 0 ? (
            <Notice tone="warn">
              <ul className="list-inside list-disc">
                {summary.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-4">
            {PLAN_ORDER.map((planId) => {
              const plan = PLANS[planId];
              const isCurrent = planId === currentPlan;
              const index = PLAN_ORDER.indexOf(currentPlan);
              const planIndex = PLAN_ORDER.indexOf(planId);
              return (
                <Card
                  key={planId}
                  className={cn(
                    'relative flex flex-col',
                    isCurrent && 'ring-2 ring-[var(--kdc-brand)]',
                  )}
                >
                  {plan.highlighted ? (
                    <span className="absolute -top-2.5 left-4 rounded-full bg-[var(--kdc-brand)] px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-[var(--kdc-brand-ink)]">
                      Popular
                    </span>
                  ) : null}
                  <CardBody className="flex flex-1 flex-col gap-3">
                    <div>
                      <p className="text-sm font-bold">{plan.name}</p>
                      <p className="mt-0.5 text-[0.7rem] text-[var(--kdc-text-muted)]">
                        {plan.tagline}
                      </p>
                    </div>
                    <p className="text-2xl font-black tabular-nums">
                      {formatMoney(plan.priceMonthlyUsdCents, 'USD', locale)}
                      <span className="text-xs font-semibold text-[var(--kdc-text-muted)]">
                        {t('billing.perMonth')}
                      </span>
                    </p>
                    <ul className="space-y-1 text-[0.7rem] text-[var(--kdc-text-muted)]">
                      <li className="flex items-center gap-1.5">
                        <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                        {plan.monthlyCertificateQuota === Number.MAX_SAFE_INTEGER
                          ? 'Unlimited'
                          : formatNumber(plan.monthlyCertificateQuota, locale)}{' '}
                        certificates/month
                      </li>
                      <li className="flex items-center gap-1.5">
                        <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                        {formatNumber(plan.maxImportRows, locale)}-row imports
                      </li>
                      <li className="flex items-center gap-1.5">
                        <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                        {plan.includedSeats} seats included
                      </li>
                      {plan.apiAccess ? (
                        <li className="flex items-center gap-1.5">
                          <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />{' '}
                          REST API + webhooks
                        </li>
                      ) : null}
                      {plan.customDomains ? (
                        <li className="flex items-center gap-1.5">
                          <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />{' '}
                          Custom domains
                        </li>
                      ) : null}
                      {plan.whiteLabel ? (
                        <li className="flex items-center gap-1.5">
                          <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />{' '}
                          White-label (hide branding)
                        </li>
                      ) : null}
                    </ul>
                    <div className="mt-auto pt-2">
                      {isCurrent ? (
                        <Badge tone="ok" className="w-full justify-center !py-1.5">
                          {t('billing.currentPlan')}
                        </Badge>
                      ) : (
                        <Button
                          variant={planIndex > index ? 'primary' : 'secondary'}
                          size="sm"
                          className="w-full"
                          loading={changePlan.isPending && changePlan.variables === planId}
                          onClick={() => changePlan.mutate(planId)}
                        >
                          {planIndex > index ? t('billing.upgrade') : t('billing.downgrade')}
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Usage this period" icon={ChartColumn} />
              <CardBody className="space-y-2">
                <div className="flex items-end justify-between">
                  <p className="text-xl font-black tabular-nums">
                    {formatNumber(summary.usage.certificatesThisMonth, locale)}
                    <span className="text-sm font-semibold text-[var(--kdc-text-muted)]">
                      {' '}
                      / {summary.usage.quota < 0 ? '∞' : formatNumber(summary.usage.quota, locale)}
                    </span>
                  </p>
                  <Badge
                    tone={
                      summary.usage.percent >= 90
                        ? 'danger'
                        : summary.usage.percent >= 70
                          ? 'warn'
                          : 'ok'
                    }
                  >
                    {summary.usage.percent}%
                  </Badge>
                </div>
                <Progress
                  value={summary.usage.certificatesThisMonth}
                  max={
                    summary.usage.quota < 0
                      ? Math.max(summary.usage.certificatesThisMonth, 1)
                      : summary.usage.quota
                  }
                  label="Quota"
                />
                <p className="text-[0.7rem] text-[var(--kdc-text-muted)]">
                  Resets {formatDate(summary.usage.resetsOn, locale)}
                </p>
                {summary.subscription ? (
                  <p className="text-[0.7rem] text-[var(--kdc-text-muted)]">
                    Subscription: {summary.subscription.status} · {summary.subscription.seats} seats
                    · period ends {formatDate(summary.subscription.currentPeriodEnd, locale)}
                    {summary.subscription.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
                  </p>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('billing.invoices')} icon={ReceiptText} />
              <CardBody>
                {invoices.data?.configured ? (
                  <ul className="space-y-1.5 text-xs">
                    {(invoices.data.items as { id?: string; number?: string }[])
                      .slice(0, 8)
                      .map((invoice, index) => (
                        <li key={invoice.id ?? index} className="font-mono text-[0.7rem]">
                          {invoice.number ?? invoice.id}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--kdc-text-muted)]">
                    {invoices.data?.reason ??
                      'Invoices are produced by the payment provider once one is configured.'}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          {summary.upgrades.length > 0 ? (
            <Card>
              <CardHeader title="What you would unlock" />
              <CardBody>
                <ul className="space-y-1.5 text-xs text-[var(--kdc-text-muted)]">
                  {summary.upgrades.map((upgrade) => (
                    <li key={upgrade.id}>
                      <strong className="font-semibold text-[var(--kdc-text)]">
                        {upgrade.name}:
                      </strong>{' '}
                      {upgrade.reason}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
