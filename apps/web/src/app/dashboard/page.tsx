'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BadgeCheck,
  Ban,
  CalendarDays,
  ClipboardCheck,
  Download,
  FileDown,
  Gauge,
  Palette,
  Plus,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api, API_PREFIX } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { AnalyticsOverview } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Notice,
  Progress,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import { cn, formatDate, formatNumber, formatRelative, titleCase } from '@/lib/utils';
import { writeSnapshot, readSnapshot } from '@/lib/offline';

export default function DashboardOverviewPage() {
  const { activeTenant, canAny } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';

  const analytics = useQuery({
    queryKey: ['analytics', tenantId],
    queryFn: async () => {
      const data = await api.get<AnalyticsOverview>(`${API_PREFIX}/tenants/${tenantId}/analytics`);
      writeSnapshot(`analytics:${tenantId}`, data);
      return data;
    },
    enabled: Boolean(tenantId),
    placeholderData: () => readSnapshot<AnalyticsOverview>(`analytics:${tenantId}`)?.data,
  });

  if (!tenantId) return <Spinner />;

  if (analytics.isError) {
    return (
      <ErrorState
        title="Could not load the overview"
        message={String(analytics.error.message)}
        onRetry={() => void analytics.refetch()}
      />
    );
  }

  const data = analytics.data;
  const totals = data?.totals;

  const stats = [
    {
      label: t('dash.certificates'),
      value: totals?.certificates,
      icon: BadgeCheck,
      href: '/dashboard/certificates',
    },
    {
      label: t('dash.issuedThisMonth'),
      value: totals?.issued,
      icon: TrendingUp,
      href: '/dashboard/analytics',
    },
    {
      label: t('dash.pendingApproval'),
      value: totals?.pendingApproval,
      icon: ClipboardCheck,
      href: '/dashboard/approvals',
    },
    {
      label: t('dash.revoked'),
      value: totals?.revoked,
      icon: Ban,
      href: '/dashboard/certificates?status=revoked',
    },
    {
      label: t('dash.verifications'),
      value: totals?.verifications,
      icon: ShieldCheck,
      href: '/dashboard/analytics',
    },
    {
      label: t('dash.downloads'),
      value: totals?.downloads,
      icon: Download,
      href: '/dashboard/analytics',
    },
  ];

  const series = (data?.series ?? []).slice(-30);

  return (
    <>
      <PageHeader
        title={activeTenant?.name ?? t('dash.title')}
        description={`${titleCase(activeTenant?.type ?? 'organisation')} · ${titleCase(activeTenant?.planId ?? 'free')} plan · ${activeTenant?.slug ?? ''}`}
        icon={Gauge}
        actions={
          <>
            {canAny(['import:create']) ? (
              <Link
                href="/dashboard/import"
                className="kdc-btn kdc-btn-secondary !min-h-9 !py-1.5 !text-xs"
              >
                <FileDown className="size-3.5" aria-hidden /> {t('dash.importCsv')}
              </Link>
            ) : null}
            {canAny(['event:create']) ? (
              <Link
                href="/dashboard/events?new=1"
                className="kdc-btn kdc-btn-secondary !min-h-9 !py-1.5 !text-xs"
              >
                <CalendarDays className="size-3.5" aria-hidden /> {t('dash.newEvent')}
              </Link>
            ) : null}
            {canAny(['certificate:issue']) ? (
              <Link
                href="/dashboard/certificates?issue=1"
                className="kdc-btn kdc-btn-primary !min-h-9 !py-1.5 !text-xs"
              >
                <Plus className="size-3.5" aria-hidden /> {t('dash.quickIssue')}
              </Link>
            ) : null}
          </>
        }
      />

      {analytics.isPending && !data ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-[var(--kdc-surface)]" />
          ))}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <Link
                  key={stat.label}
                  href={stat.href}
                  className="kdc-card group p-4 transition-shadow hover:shadow-[var(--shadow-pop)]"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="size-4 text-[var(--kdc-brand)]" aria-hidden />
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)] group-hover:text-[var(--kdc-text)]">
                      →
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-black tabular-nums tracking-tight">
                    {formatNumber(stat.value ?? 0, locale)}
                  </p>
                  <p className="mt-0.5 truncate text-[0.7rem] text-[var(--kdc-text-muted)]">
                    {stat.label}
                  </p>
                </Link>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader
                title={t('dash.issuanceTrend')}
                description="Certificates issued, verified and revoked per day (last 30 days)"
                icon={TrendingUp}
              />
              <CardBody className="h-64">
                {series.length === 0 ? (
                  <p className="grid h-full place-items-center text-xs text-[var(--kdc-text-muted)]">
                    No activity in this window yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="issuedFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--kdc-brand)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--kdc-brand)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--kdc-border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(value: string) => value.slice(5)}
                        stroke="var(--kdc-text-muted)"
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="var(--kdc-text-muted)"
                        allowDecimals={false}
                      />
                      <ChartTooltip
                        contentStyle={{
                          fontSize: 11,
                          borderRadius: 8,
                          border: '1px solid var(--kdc-border)',
                          background: 'var(--kdc-surface)',
                        }}
                        labelFormatter={(value) => formatDate(String(value), locale)}
                      />
                      <Area
                        type="monotone"
                        dataKey="issued"
                        stroke="var(--kdc-brand)"
                        strokeWidth={2}
                        fill="url(#issuedFill)"
                        name="Issued"
                      />
                      <Area
                        type="monotone"
                        dataKey="verified"
                        stroke="#16a34a"
                        strokeWidth={1.5}
                        fill="transparent"
                        name="Verified"
                      />
                      <Area
                        type="monotone"
                        dataKey="revoked"
                        stroke="#dc2626"
                        strokeWidth={1.5}
                        fill="transparent"
                        name="Revoked"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title={t('dash.quota')} icon={Gauge} />
                <CardBody className="space-y-2">
                  <div className="flex items-end justify-between">
                    <p className="text-2xl font-black tabular-nums">
                      {formatNumber(data.quota.used, locale)}
                      <span className="text-sm font-semibold text-[var(--kdc-text-muted)]">
                        {' '}
                        / {data.quota.limit < 0 ? '∞' : formatNumber(data.quota.limit, locale)}
                      </span>
                    </p>
                    <Badge
                      tone={
                        data.quota.percent >= 90
                          ? 'danger'
                          : data.quota.percent >= 70
                            ? 'warn'
                            : 'ok'
                      }
                    >
                      {data.quota.percent}%
                    </Badge>
                  </div>
                  <Progress
                    value={data.quota.used}
                    max={data.quota.limit < 0 ? Math.max(data.quota.used, 1) : data.quota.limit}
                    label={t('dash.quota')}
                  />
                  <p className="text-[0.7rem] text-[var(--kdc-text-muted)]">
                    {t('dash.quotaUsed', {
                      used: formatNumber(data.quota.used, locale),
                      limit:
                        data.quota.limit < 0 ? 'unlimited' : formatNumber(data.quota.limit, locale),
                    })}{' '}
                    · resets {formatDate(data.quota.resetsOn, locale)}
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Delivery status" icon={Download} />
                <CardBody>
                  <ul className="space-y-1.5">
                    {Object.entries(data.deliveries).map(([status, count]) => (
                      <li key={status} className="flex items-center justify-between text-xs">
                        <StatusBadge status={status} />
                        <span className="font-semibold tabular-nums">
                          {formatNumber(count, locale)}
                        </span>
                      </li>
                    ))}
                    {Object.keys(data.deliveries).length === 0 ? (
                      <li className="text-xs text-[var(--kdc-text-muted)]">No deliveries yet.</li>
                    ) : null}
                  </ul>
                </CardBody>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={t('dash.recentActivity')}
                icon={BadgeCheck}
                action={
                  <Link
                    className="text-xs font-semibold text-[var(--kdc-brand)] hover:underline"
                    href="/dashboard/certificates"
                  >
                    View all
                  </Link>
                }
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--kdc-border)]">
                  {data.recentActivity.slice(0, 8).map((row) => (
                    <li
                      key={`${row.serial}-${row.at}`}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs"
                    >
                      <StatusBadge status={row.status} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{row.recipientName}</p>
                        <p className="truncate text-[var(--kdc-text-muted)]">{row.eventName}</p>
                      </div>
                      <span className="shrink-0 font-mono text-[0.65rem] text-[var(--kdc-text-muted)]">
                        {row.serial}
                      </span>
                      <span className="shrink-0 text-[var(--kdc-text-muted)]">
                        {formatRelative(row.at, locale)}
                      </span>
                    </li>
                  ))}
                  {data.recentActivity.length === 0 ? (
                    <li className="px-4 py-6 text-center text-xs text-[var(--kdc-text-muted)]">
                      Nothing issued yet — create an event and issue your first certificate.
                    </li>
                  ) : null}
                </ul>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Top events"
                icon={CalendarDays}
                action={
                  <Link
                    className="text-xs font-semibold text-[var(--kdc-brand)] hover:underline"
                    href="/dashboard/events"
                  >
                    Manage
                  </Link>
                }
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--kdc-border)]">
                  {data.topEvents.slice(0, 6).map((event) => (
                    <li key={event.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{event.name}</p>
                        <p className="text-[var(--kdc-text-muted)]">
                          {formatNumber(event.issued, locale)} issued ·{' '}
                          {formatNumber(event.pending, locale)} pending ·{' '}
                          {formatNumber(event.revoked, locale)} revoked
                        </p>
                      </div>
                      <span
                        className={cn(
                          'text-sm font-black tabular-nums',
                          event.issued > 0
                            ? 'text-[var(--kdc-brand)]'
                            : 'text-[var(--kdc-text-muted)]',
                        )}
                      >
                        {formatNumber(event.issued, locale)}
                      </span>
                    </li>
                  ))}
                  {data.topEvents.length === 0 ? (
                    <li className="px-4 py-6 text-center text-xs text-[var(--kdc-text-muted)]">
                      No events yet.
                    </li>
                  ) : null}
                </ul>
              </CardBody>
            </Card>
          </div>

          {canAny(['template:create']) ? (
            <Notice tone="info" className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <Palette className="mr-1 inline size-3.5" aria-hidden />
                Designs define what certificates look like. Start from a starter template, then make
                it yours in the designer.
              </span>
              <Link
                href="/dashboard/designs"
                className="font-semibold text-[var(--kdc-brand)] underline-offset-2 hover:underline"
              >
                Open the design gallery
              </Link>
            </Notice>
          ) : null}

          <Card>
            <CardHeader
              title="Team"
              icon={Users}
              action={
                <Link
                  className="text-xs font-semibold text-[var(--kdc-brand)] hover:underline"
                  href="/dashboard/team"
                >
                  Manage
                </Link>
              }
            />
            <CardBody>
              <p className="text-xs text-[var(--kdc-text-muted)]">
                {formatNumber(data.totals.members, locale)} member(s) ·{' '}
                {formatNumber(data.totals.templates, locale)} design(s) ·{' '}
                {formatNumber(data.totals.events, locale)} event(s)
              </p>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </>
  );
}
