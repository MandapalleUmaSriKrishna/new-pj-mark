import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, Check, Minus } from 'lucide-react';
import { PLANS, PLAN_ORDER } from '@kdc/shared';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Four plans from a single department to unlimited government-scale issuance. Limits are enforced server-side, and manual billing says so honestly when no payment provider is configured.',
  alternates: { canonical: '/pricing' },
};

const ROWS: {
  label: string;
  value: (planId: (typeof PLAN_ORDER)[number]) => string | boolean | number;
}[] = [
  {
    label: 'Certificates / month',
    value: (id) =>
      PLANS[id].monthlyCertificateQuota === Number.MAX_SAFE_INTEGER
        ? 'Unlimited'
        : PLANS[id].monthlyCertificateQuota.toLocaleString('en-US'),
  },
  { label: 'Import rows per file', value: (id) => PLANS[id].maxImportRows.toLocaleString('en-US') },
  { label: 'Team seats included', value: (id) => PLANS[id].includedSeats },
  {
    label: 'Designs',
    value: (id) =>
      PLANS[id].maxTemplates === Number.MAX_SAFE_INTEGER ? 'Unlimited' : PLANS[id].maxTemplates,
  },
  {
    label: 'Events',
    value: (id) =>
      PLANS[id].maxEvents === Number.MAX_SAFE_INTEGER ? 'Unlimited' : PLANS[id].maxEvents,
  },
  { label: 'Approval workflows', value: (id) => PLANS[id].approvalWorkflows },
  { label: 'REST API access', value: (id) => PLANS[id].apiAccess },
  {
    label: 'Signed webhooks',
    value: (id) =>
      PLANS[id].webhooks
        ? PLANS[id].maxWebhooks === Number.MAX_SAFE_INTEGER
          ? 'Unlimited'
          : PLANS[id].maxWebhooks
        : false,
  },
  { label: 'Custom domains', value: (id) => PLANS[id].customDomains },
  { label: 'White-label branding', value: (id) => PLANS[id].whiteLabel },
  { label: 'Bulk email delivery', value: (id) => PLANS[id].bulkEmailDelivery },
  { label: 'Advanced analytics', value: (id) => PLANS[id].analyticsAdvanced },
  { label: 'Audit retention', value: (id) => `${PLANS[id].auditRetentionDays} days` },
  { label: 'Support', value: (id) => PLANS[id].support },
];

/** Server component: format cents without pulling client helpers into the RSC bundle. */
function formatMoneyServer(cents: number | null): string {
  if (cents === null) return 'Custom';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function Cell({ value }: { value: string | boolean | number }) {
  if (value === true)
    return <Check className="mx-auto size-4 text-emerald-500" aria-label="Included" />;
  if (value === false)
    return (
      <Minus
        className="mx-auto size-4 text-[var(--kdc-text-muted)] opacity-50"
        aria-label="Not included"
      />
    );
  return <span className="text-xs font-medium tabular-nums">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <div className="text-center">
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            Pricing that scales with your programme
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-[var(--kdc-text-muted)]">
            Every plan includes QR verification, private download links, the audit trail and the
            installable PWA. Higher plans raise limits and unlock automation — and every limit is
            enforced by the API, not by the UI.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((planId) => {
            const plan = PLANS[planId];
            return (
              <article
                key={planId}
                className={`kdc-card relative flex flex-col p-5 ${plan.highlighted ? 'ring-2 ring-[var(--kdc-brand)]' : ''}`}
              >
                {plan.highlighted ? (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-[var(--kdc-brand)] px-2.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-white">
                    Most popular
                  </span>
                ) : null}
                <h2 className="text-sm font-bold">{plan.name}</h2>
                <p className="mt-1 min-h-8 text-[0.7rem] text-[var(--kdc-text-muted)]">
                  {plan.tagline}
                </p>
                <p className="mt-3 text-3xl font-black tabular-nums">
                  {plan.priceMonthlyUsdCents === null
                    ? 'Custom'
                    : formatMoneyServer(plan.priceMonthlyUsdCents)}
                  {plan.priceMonthlyUsdCents === null ? null : (
                    <span className="text-xs font-semibold text-[var(--kdc-text-muted)]">
                      /month
                    </span>
                  )}
                </p>
                <ul className="mt-4 space-y-1.5 text-xs text-[var(--kdc-text-muted)]">
                  <li className="flex items-center gap-1.5">
                    <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                    {plan.monthlyCertificateQuota === Number.MAX_SAFE_INTEGER
                      ? 'Unlimited certificates'
                      : `${plan.monthlyCertificateQuota.toLocaleString('en-US')} certificates/month`}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                    {plan.includedSeats} seats included
                  </li>
                  {plan.apiAccess ? (
                    <li className="flex items-center gap-1.5">
                      <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden /> REST
                      API + webhooks
                    </li>
                  ) : null}
                  {plan.customDomains ? (
                    <li className="flex items-center gap-1.5">
                      <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />{' '}
                      Custom domains
                    </li>
                  ) : null}
                </ul>
                <div className="mt-auto pt-5">
                  <Link
                    href="/register"
                    className={`kdc-btn w-full ${plan.highlighted ? 'kdc-btn-primary' : 'kdc-btn-secondary'}`}
                  >
                    Start with {plan.name}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>

        <div className="kdc-card mt-10 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <caption className="sr-only">Plan feature comparison</caption>
            <thead>
              <tr className="border-b border-[var(--kdc-border)]">
                <th
                  scope="col"
                  className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]"
                >
                  Feature
                </th>
                {PLAN_ORDER.map((planId) => (
                  <th key={planId} scope="col" className="px-4 py-3 text-center text-xs font-bold">
                    {PLANS[planId].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-[var(--kdc-border)]/60 last:border-0"
                >
                  <th scope="row" className="px-4 py-2.5 text-left text-xs font-medium">
                    {row.label}
                  </th>
                  {PLAN_ORDER.map((planId) => (
                    <td key={planId} className="px-4 py-2.5 text-center">
                      <Cell value={row.value(planId)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-[0.7rem] leading-relaxed text-[var(--kdc-text-muted)]">
          Payments: this deployment runs billing in <strong>manual mode</strong> unless{' '}
          <code className="font-mono">BILLING_PROVIDER=stripe</code> and the Stripe keys are
          configured — plan changes are then recorded and enforced but never charged, and the
          billing page says exactly that. See <code className="font-mono">.env.example</code> for
          the full list of optional integrations.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
