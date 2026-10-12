import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Subscription } from '@kdc/shared';
import { PLANS, getPlan, planAllowsFeature, type Plan, type PlanId } from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { DATA_STORE, type DataStore, type Repository } from '../infra/persistence/repository';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';

export interface BillingSummary {
  plan: Plan;
  subscription: Subscription | null;
  provider: 'manual' | 'stripe';
  usage: { certificatesThisMonth: number; quota: number; percent: number; resetsOn: string };
  upgrades: { id: PlanId; name: string; reason: string }[];
  /** Set when the tenant is blocked by a limit; the UI shows the exact remedy. */
  blockers: string[];
  paymentConfigured: boolean;
  notice: string | null;
}

/**
 * Subscriptions and plan enforcement.
 *
 * `BILLING_PROVIDER=stripe` plus `STRIPE_SECRET_KEY` enables real charging; with
 * neither configured the service runs in MANUAL mode, which is what this repo
 * ships as because no payment credentials are bundled. Manual mode still
 * enforces every plan limit and records the change in the audit log, but it
 * takes no money and says so in the response rather than pretending otherwise.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly subscriptions: Repository<Subscription>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {
    this.subscriptions = store.repository<Subscription>('subscriptions');
  }

  get paymentConfigured(): boolean {
    return (
      this.env.BILLING_PROVIDER === 'stripe' &&
      Boolean(this.env.STRIPE_SECRET_KEY) &&
      Boolean(this.env.STRIPE_WEBHOOK_SECRET)
    );
  }

  plans(): Plan[] {
    return Object.values(PLANS);
  }

  async summary(tenantId: string): Promise<BillingSummary> {
    const planId = await this.tenants.planOf(tenantId);
    const subscription = await this.subscriptions.findOne({ tenantId });
    const usage = await this.tenants.currentUsage(tenantId);
    const entitlements = getPlan(planId);
    const finiteQuota =
      Number.isFinite(entitlements.monthlyCertificateQuota) &&
      entitlements.monthlyCertificateQuota < Number.MAX_SAFE_INTEGER;
    const quota = finiteQuota ? entitlements.monthlyCertificateQuota : -1;
    const percent = quota > 0 ? Math.round((usage.certificatesThisMonth / quota) * 100) : 0;

    const blockers: string[] = [];
    if (quota > 0 && usage.certificatesThisMonth >= quota) {
      blockers.push(
        `Monthly certificate allowance reached (${usage.certificatesThisMonth}/${quota}).`,
      );
    }
    const order: PlanId[] = ['free', 'starter', 'growth', 'enterprise'];
    const currentIndex = order.indexOf(planId);
    const upgrades = order.slice(currentIndex + 1).map((id) => {
      const next = getPlan(id);
      const reasons: string[] = [];
      if (!planAllowsFeature(planId, 'apiAccess') && planAllowsFeature(id, 'apiAccess'))
        reasons.push('REST API access');
      if (!planAllowsFeature(planId, 'webhooks') && planAllowsFeature(id, 'webhooks'))
        reasons.push('webhooks');
      if (!planAllowsFeature(planId, 'customDomains') && planAllowsFeature(id, 'customDomains'))
        reasons.push('custom domains');
      if (
        !planAllowsFeature(planId, 'approvalWorkflows') &&
        planAllowsFeature(id, 'approvalWorkflows')
      )
        reasons.push('approval workflows');
      if (!planAllowsFeature(planId, 'whiteLabel') && planAllowsFeature(id, 'whiteLabel'))
        reasons.push('white-label branding');
      if (next.monthlyCertificateQuota > entitlements.monthlyCertificateQuota) {
        reasons.push(
          `${next.monthlyCertificateQuota === Number.MAX_SAFE_INTEGER ? 'unlimited' : next.monthlyCertificateQuota.toLocaleString('en-US')} certificates/month`,
        );
      }
      if (next.maxImportRows > entitlements.maxImportRows)
        reasons.push(`${next.maxImportRows.toLocaleString('en-US')}-row imports`);
      return { id, name: next.name, reason: reasons.slice(0, 3).join(', ') || 'Higher limits' };
    });

    return {
      plan: entitlements,
      subscription: subscription ?? null,
      provider: this.paymentConfigured ? 'stripe' : 'manual',
      usage: {
        certificatesThisMonth: usage.certificatesThisMonth,
        quota,
        percent,
        resetsOn: new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
        ).toISOString(),
      },
      upgrades,
      blockers,
      paymentConfigured: this.paymentConfigured,
      notice: this.paymentConfigured
        ? null
        : 'No payment provider is configured (set BILLING_PROVIDER=stripe with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET). Plan changes are applied and enforced immediately but nothing is charged. See docs/DEPLOYMENT.md.',
    };
  }

  async changePlan(
    tenantId: string,
    planId: PlanId,
    actorId: string,
  ): Promise<{ subscription: Subscription; charged: boolean; notice: string }> {
    if (!(planId in PLANS)) throw AppException.validationFailed(`Unknown plan "${planId}"`);
    const target = getPlan(planId);
    if (target.id === 'enterprise' && !this.paymentConfigured) {
      // Enterprise is sold through a contract; the app must not silently grant it.
      throw new AppException(
        'billing_not_configured',
        'The enterprise plan requires a payment provider or a signed contract. Contact the platform operator.',
        {
          remedy:
            'Set BILLING_PROVIDER=stripe and supply STRIPE_SECRET_KEY, or have an operator change the plan in the database.',
        },
        503,
      );
    }
    const subscription = await this.tenants.changePlan(tenantId, planId, actorId);
    await this.audit.record({
      tenantId,
      actorId,
      actorRole: 'owner',
      action: 'subscription.changed',
      entityType: 'subscription',
      entityId: subscription.id,
      payload: { planId, provider: subscription.provider, charged: this.paymentConfigured },
      severity: 'warning',
    });
    this.logger.warn(
      `Tenant ${tenantId} moved to plan ${planId} (provider=${subscription.provider}, charged=${this.paymentConfigured})`,
    );
    return {
      subscription,
      charged: this.paymentConfigured,
      notice: this.paymentConfigured
        ? 'Plan change submitted to the payment provider.'
        : 'Plan applied in manual mode: limits take effect now, but no payment was taken because no PSP is configured.',
    };
  }

  async cancelAtPeriodEnd(tenantId: string, actorId: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findOne({ tenantId });
    if (!subscription) throw AppException.notFound('Subscription');
    const updated = await this.subscriptions.updateById(subscription.id, {
      cancelAtPeriodEnd: true,
    });
    if (!updated) throw AppException.notFound('Subscription');
    await this.audit.record({
      tenantId,
      actorId,
      actorRole: 'owner',
      action: 'subscription.changed',
      entityType: 'subscription',
      entityId: subscription.id,
      payload: { cancelAtPeriodEnd: true },
      severity: 'warning',
    });
    return updated;
  }

  /**
   * Invoices.
   *
   * Returns an empty list with an explicit reason when no PSP is attached,
   * instead of fabricating billing history.
   */
  async invoices(
    _tenantId: string,
  ): Promise<{ items: never[]; configured: boolean; reason: string | null }> {
    if (!this.paymentConfigured) {
      return {
        items: [],
        configured: false,
        reason:
          'Invoices are produced by the payment provider. Configure BILLING_PROVIDER=stripe with STRIPE_SECRET_KEY to enable them.',
      };
    }
    // With Stripe configured, invoice retrieval is a provider call. It is
    // deliberately not stubbed with sample data.
    throw new AppException(
      'billing_not_implemented',
      'Invoice retrieval from the configured provider is not wired up in this deployment. Fetch invoices from the provider dashboard.',
      undefined,
      501,
    );
  }
}
