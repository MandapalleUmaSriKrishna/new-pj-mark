'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartColumn, Download } from 'lucide-react';
import { toast } from 'sonner';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { AnalyticsOverview } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Select } from '@/components/ui';
import { formatDate, formatNumber, saveBlobResponse, titleCase } from '@/lib/utils';

export default function AnalyticsPage() {
  const { activeTenant } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const [days, setDays] = useState(30);

  const analytics = useQuery({
    queryKey: ['analytics', tenantId, days],
    queryFn: () =>
      api.get<AnalyticsOverview>(`${API_PREFIX}/tenants/${tenantId}/analytics`, {
        query: { days },
      }),
    enabled: Boolean(tenantId),
  });

  const exportCsv = async () => {
    try {
      const response = await api.raw(`${API_PREFIX}/tenants/${tenantId}/analytics/export.csv`, {
        query: { days },
      });
      await saveBlobResponse(response, `analytics-${days}d.csv`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Export failed');
    }
  };

  if (analytics.isError) {
    return (
      <ErrorState
        message={
          analytics.error instanceof ApiError ? analytics.error.message : 'Could not load analytics'
        }
        onRetry={() => void analytics.refetch()}
      />
    );
  }

  const data = analytics.data;

  return (
    <>
      <PageHeader
        title={t('nav.analytics')}
        description="Issuance, verification and delivery across the organisation. Quota figures come from the plan, not from a guess."
        icon={ChartColumn}
        actions={
          <>
            <Select
              value={String(days)}
              onChange={(event) => setDays(Number(event.target.value))}
              className="!min-h-9 !w-32 !py-1.5 !text-xs"
              aria-label="Window"
            >
              {[7, 30, 90, 365].map((value) => (
                <option key={value} value={value}>
                  Last {value} days
                </option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" icon={Download} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </>
        }
      />

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl bg-[var(--kdc-surface)]" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('dash.certificates')} value={data.totals.certificates} />
            <Stat label={t('dash.issuedThisMonth')} value={data.totals.issued} />
            <Stat label={t('dash.verifications')} value={data.totals.verifications} />
            <Stat label={t('dash.downloads')} value={data.totals.downloads} />
          </div>

          <Card>
            <CardHeader
              title="Issued vs verified vs revoked"
              description={`Daily counts over the last ${days} days`}
            />
            <CardBody className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="issued"
                    fill="var(--kdc-brand)"
                    name="Issued"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar dataKey="verified" fill="#16a34a" name="Verified" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="revoked" fill="#dc2626" name="Revoked" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Verification outcomes" description="What verifiers actually saw" />
              <CardBody>
                <ul className="space-y-2">
                  {Object.entries(data.verificationResults).map(([result, count]) => (
                    <li key={result} className="flex items-center justify-between text-xs">
                      <Badge
                        tone={result === 'valid' ? 'ok' : result === 'revoked' ? 'danger' : 'muted'}
                      >
                        {titleCase(result)}
                      </Badge>
                      <span className="font-semibold tabular-nums">
                        {formatNumber(count, locale)}
                      </span>
                    </li>
                  ))}
                  {Object.keys(data.verificationResults).length === 0 ? (
                    <li className="text-xs text-[var(--kdc-text-muted)]">
                      No verifications recorded yet.
                    </li>
                  ) : null}
                </ul>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Quota & plan"
                description={`Plan: ${titleCase(data.quota.plan)}`}
              />
              <CardBody className="space-y-1.5 text-xs">
                <p>
                  Used{' '}
                  <strong className="tabular-nums">{formatNumber(data.quota.used, locale)}</strong>{' '}
                  of{' '}
                  <strong className="tabular-nums">
                    {data.quota.limit < 0 ? 'unlimited' : formatNumber(data.quota.limit, locale)}
                  </strong>{' '}
                  this month ({data.quota.percent}%)
                </p>
                <p className="text-[var(--kdc-text-muted)]">
                  Resets {formatDate(data.quota.resetsOn, locale)}
                </p>
                <p className="text-[var(--kdc-text-muted)]">
                  Deliveries:{' '}
                  {Object.entries(data.deliveries)
                    .map(([status, count]) => `${status} ${count}`)
                    .join(' · ') || 'none yet'}
                </p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Top events" />
            <CardBody className="p-0">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--kdc-border)] text-[0.68rem] uppercase tracking-wide text-[var(--kdc-text-muted)]">
                    <th className="px-4 py-2 font-semibold">Event</th>
                    <th className="px-4 py-2 text-right font-semibold">Issued</th>
                    <th className="px-4 py-2 text-right font-semibold">Pending</th>
                    <th className="px-4 py-2 text-right font-semibold">Revoked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topEvents.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-[var(--kdc-border)]/60 last:border-0"
                    >
                      <td className="px-4 py-2 font-medium">{event.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatNumber(event.issued, locale)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatNumber(event.pending, locale)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatNumber(event.revoked, locale)}
                      </td>
                    </tr>
                  ))}
                  {data.topEvents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center text-[var(--kdc-text-muted)]"
                      >
                        No events yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const { locale } = useI18n();
  return (
    <Card className="p-4">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black tabular-nums">{formatNumber(value, locale)}</p>
    </Card>
  );
}
