import type { PlanId } from './enums';

/**
 * Subscription plans and their entitlements.
 *
 * NOTE ON BILLING: the plan catalogue below is enforced by the application
 * (quotas + feature gates) and is fully functional. Payment collection itself
 * requires a live PSP. No payment provider credentials are bundled, so the
 * `billing` module runs in `manual` mode: plan changes are recorded and
 * enforced, but no money moves and nothing is presented as a live charge.
 * See docs/DEPLOYMENT.md -> "Payments".
 */
export interface PlanEntitlements {
  /** Maximum active members per tenant. */
  maxMembers: number;
  /** Maximum certificates that may be issued per calendar month. */
  monthlyCertificateQuota: number;
  /** Maximum rows accepted in a single CSV/XLSX import. */
  maxImportRows: number;
  /** Maximum number of certificate templates. */
  maxTemplates: number;
  /** Maximum number of concurrent events/campaigns. */
  maxEvents: number;
  /** Custom vanity domains (e.g. certs.college.edu). */
  customDomains: boolean;
  /** Remove the "Powered by Krishna Digital Certificate" mark from certificates. */
  whiteLabel: boolean;
  /** Require a second person to approve before issuing. */
  approvalWorkflows: boolean;
  /** Programmatic REST access with API keys. */
  apiAccess: boolean;
  /** Outbound signed webhooks. */
  webhooks: boolean;
  /** Number of webhook endpoints. */
  maxWebhooks: number;
  /** Number of API keys. */
  maxApiKeys: number;
  /** Bulk e-mail delivery of certificates to recipients. */
  bulkEmailDelivery: boolean;
  /** Retention of immutable audit logs, in days. */
  auditRetentionDays: number;
  /** Certificate validity verification page branding. */
  analyticsAdvanced: boolean;
  /** Seats included in the base price. */
  includedSeats: number;
  /** Support channel. */
  support: 'community' | 'email' | 'priority' | 'dedicated';
  /** Monthly price in USD cents. `null` = contact sales. */
  priceMonthlyUsdCents: number | null;
  /** Yearly price in USD cents. `null` = contact sales. */
  priceYearlyUsdCents: number | null;
}

export interface Plan extends PlanEntitlements {
  id: PlanId;
  name: string;
  tagline: string;
  highlighted: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'For a single department trying digital certificates out.',
    highlighted: false,
    maxMembers: 3,
    monthlyCertificateQuota: 100,
    maxImportRows: 200,
    maxTemplates: 3,
    maxEvents: 3,
    customDomains: false,
    whiteLabel: false,
    approvalWorkflows: false,
    apiAccess: false,
    webhooks: false,
    maxWebhooks: 0,
    maxApiKeys: 0,
    bulkEmailDelivery: false,
    auditRetentionDays: 30,
    analyticsAdvanced: false,
    includedSeats: 3,
    support: 'community',
    priceMonthlyUsdCents: 0,
    priceYearlyUsdCents: 0,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'For schools and small teams issuing every month.',
    highlighted: false,
    maxMembers: 15,
    monthlyCertificateQuota: 2_500,
    maxImportRows: 2_000,
    maxTemplates: 15,
    maxEvents: 20,
    customDomains: false,
    whiteLabel: true,
    approvalWorkflows: true,
    apiAccess: true,
    webhooks: true,
    maxWebhooks: 3,
    maxApiKeys: 2,
    bulkEmailDelivery: true,
    auditRetentionDays: 180,
    analyticsAdvanced: false,
    includedSeats: 15,
    support: 'email',
    priceMonthlyUsdCents: 2900,
    priceYearlyUsdCents: 29000,
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    tagline: 'For colleges, NGOs and companies at convocation scale.',
    highlighted: true,
    maxMembers: 100,
    monthlyCertificateQuota: 25_000,
    maxImportRows: 25_000,
    maxTemplates: 100,
    maxEvents: 200,
    customDomains: true,
    whiteLabel: true,
    approvalWorkflows: true,
    apiAccess: true,
    webhooks: true,
    maxWebhooks: 10,
    maxApiKeys: 10,
    bulkEmailDelivery: true,
    auditRetentionDays: 730,
    analyticsAdvanced: true,
    includedSeats: 100,
    support: 'priority',
    priceMonthlyUsdCents: 9900,
    priceYearlyUsdCents: 99000,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Government and multi-campus deployments with SSO and SLAs.',
    highlighted: false,
    maxMembers: Number.MAX_SAFE_INTEGER,
    monthlyCertificateQuota: Number.MAX_SAFE_INTEGER,
    maxImportRows: 500_000,
    maxTemplates: Number.MAX_SAFE_INTEGER,
    maxEvents: Number.MAX_SAFE_INTEGER,
    customDomains: true,
    whiteLabel: true,
    approvalWorkflows: true,
    apiAccess: true,
    webhooks: true,
    maxWebhooks: 50,
    maxApiKeys: 50,
    bulkEmailDelivery: true,
    auditRetentionDays: 3650,
    analyticsAdvanced: true,
    includedSeats: 1000,
    support: 'dedicated',
    priceMonthlyUsdCents: null,
    priceYearlyUsdCents: null,
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'growth', 'enterprise'];

export function getPlan(id: PlanId): Plan {
  return PLANS[id] ?? PLANS.free;
}

export function entitlementsFor(id: PlanId): PlanEntitlements {
  const { id: _id, name: _n, tagline: _t, highlighted: _h, ...rest } = getPlan(id);
  void _id;
  void _n;
  void _t;
  void _h;
  return rest;
}

export type FeatureKey =
  | 'customDomains'
  | 'whiteLabel'
  | 'approvalWorkflows'
  | 'apiAccess'
  | 'webhooks'
  | 'bulkEmailDelivery'
  | 'analyticsAdvanced';

export function planAllowsFeature(plan: PlanId, feature: FeatureKey): boolean {
  return getPlan(plan)[feature] === true;
}
