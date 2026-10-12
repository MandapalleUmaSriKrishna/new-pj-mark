import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Membership,
  NotificationPreference,
  PlanId,
  Subscription,
  Template,
  Tenant,
  TenantDomain,
  TenantType,
  User,
} from '@kdc/shared';
import {
  DEFAULT_LOCALE,
  STARTER_DESIGNS,
  getPlan,
  generateInviteCode,
  permissionsForRole,
  planAllowsFeature,
  type FeatureKey,
} from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { CryptoService } from '../infra/crypto/crypto.service';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import { monthKey, newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import type {
  CreateTenantInput,
  UpdateBrandingInput,
  UpdateSettingsInput,
  UpdateTenantInput,
} from '../auth/dto';

export interface ProvisionedTenant {
  tenant: Tenant;
  membership: Membership;
  subscription: Subscription;
  templates: Template[];
}

const RESERVED_SLUGS = new Set([
  'app',
  'api',
  'www',
  'admin',
  'verify',
  'v',
  'docs',
  'status',
  'mail',
  'cdn',
  'assets',
  'static',
  'login',
  'register',
  'signup',
  'signin',
  'account',
  'billing',
  'support',
  'help',
  'krishna',
  'kdc',
  'new',
  'beta',
  'dev',
  'staging',
  'test',
  'demo',
  'localhost',
]);

/**
 * Tenant lifecycle: creation, white-label branding, settings, vanity domains and
 * plan/quota enforcement.
 *
 * Every tenant row carries its own wrapped data-encryption key, its own branding
 * and its own settings, which is what makes 1,000+ independent organisations
 * share one deployment without seeing each other.
 */
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);
  private readonly tenants: Repository<Tenant>;
  private readonly domains: Repository<TenantDomain>;
  private readonly memberships: Repository<Membership>;
  private readonly templates: Repository<Template>;
  private readonly subscriptions: Repository<Subscription>;
  private readonly prefs: Repository<NotificationPreference>;
  private readonly users: Repository<User>;

  constructor(
    @Inject(DATA_STORE) private readonly store: DataStore,
    private readonly crypto: CryptoService,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {
    this.tenants = store.repository<Tenant>('tenants');
    this.domains = store.repository<TenantDomain>('tenant_domains');
    this.memberships = store.repository<Membership>('memberships');
    this.templates = store.repository<Template>('templates');
    this.subscriptions = store.repository<Subscription>('subscriptions');
    this.prefs = store.repository<NotificationPreference>('notification_preferences');
    this.users = store.repository<User>('users');
  }

  /* ------------------------------------------------------------- creation */

  slugify(name: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return base.length >= 2 ? base : 'org';
  }

  private async uniqueSlug(preferred: string | undefined, name: string): Promise<string> {
    const base = this.slugify(preferred ?? name);
    if (RESERVED_SLUGS.has(base)) return `${base}-org`;
    let candidate = base;
    for (let i = 0; i < 25; i += 1) {
      const taken = await this.tenants.exists({ slug: candidate });
      if (!taken) return candidate;
      candidate = `${base}-${generateInviteCode().slice(0, 4).toLowerCase()}`;
    }
    throw AppException.conflict(
      'Could not derive a unique organisation URL; choose one explicitly',
    );
  }

  /** Loads the acting user and provisions an organisation owned by them. */
  async provisionForUser(userId: string, input: CreateTenantInput): Promise<ProvisionedTenant> {
    const owner = await this.users.findById(userId);
    if (!owner) throw AppException.unauthenticated();
    return this.provision(owner, input);
  }

  async provision(owner: User, input: CreateTenantInput): Promise<ProvisionedTenant> {
    const slug = await this.uniqueSlug(input.slug, input.name);
    const now = new Date();
    const wrapped = this.crypto.wrapNewDek();
    const locale = input.locale ?? DEFAULT_LOCALE;

    const tenant: Tenant = {
      id: newId(),
      name: input.name.trim(),
      slug,
      type: (input.type ?? 'other') as TenantType,
      ownerEmail: owner.email,
      country: (input.country ?? 'IN').toUpperCase(),
      planId: 'free',
      branding: {
        primaryColor: '#1f3a5f',
        secondaryColor: '#c8a44d',
        accentColor: '#2563eb',
        tagline: null,
        website: null,
        supportEmail: owner.email,
        logoAssetId: null,
        faviconAssetId: null,
        emailBannerAssetId: null,
        fontFamily: null,
        certificateFooterText: null,
        hidePoweredBy: false,
      },
      settings: {
        locale,
        timezone: input.timezone ?? 'Asia/Kolkata',
        serialPrefix: input.serialPrefix ?? 'KDC',
        requireApproval: false,
        autoDeliverEmail: true,
        allowSelfDownload: true,
        selfDownloadRequiresEmail: true,
        downloadLinkTtlDays: this.env.DOWNLOAD_LINK_TTL_DAYS,
        verificationPublic: true,
        watermarkDrafts: true,
        defaultEmailSubject: 'Your certificate from {{tenant.name}}',
        defaultEmailBody:
          'Dear {{recipient.name}},\n\n' +
          'Congratulations! Your certificate for {{event.name}} is ready.\n\n' +
          'Certificate ID: {{certificate.serial}}\n' +
          'View and download: {{certificate.download_url}}\n' +
          'Anyone can verify its authenticity at {{verify.url}}\n\n' +
          'Regards,\n{{tenant.name}}',
      },
      usage: { certificatesThisMonth: 0, monthKey: monthKey(now) },
      wrappedDek: wrapped.wrapped,
      status: 'active',
      primaryDomain: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.tenants.insert(tenant);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('That organisation URL is already taken');
      throw err;
    }

    const membership: Membership = {
      id: newId(),
      tenantId: tenant.id,
      userId: owner.id,
      role: 'owner',
      status: 'active',
      invitedBy: owner.id,
      joinedAt: now,
      inviteToken: null,
      inviteExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.memberships.insert(membership);

    const subscription: Subscription = {
      id: newId(),
      tenantId: tenant.id,
      planId: 'free',
      status: 'trialing',
      seats: getPlan('free').includedSeats,
      interval: 'month',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
      provider:
        this.env.BILLING_PROVIDER === 'stripe' && this.env.STRIPE_SECRET_KEY ? 'stripe' : 'manual',
      providerSubscriptionId: null,
      trialEndsAt: new Date(now.getTime() + 14 * 86_400_000),
      createdAt: now,
      updatedAt: now,
    };
    await this.subscriptions.insert(subscription);

    await this.prefs.insert({
      id: newId(),
      tenantId: tenant.id,
      userId: owner.id,
      emailIssuanceComplete: true,
      emailApprovalNeeded: true,
      emailQuotaWarning: true,
      emailWeeklyDigest: true,
      webhookFailures: true,
      createdAt: now,
      updatedAt: now,
    });

    // Seed the starter designs so a new organisation can issue immediately.
    const templates: Template[] = [];
    for (const design of STARTER_DESIGNS) {
      const template: Template = {
        id: newId(),
        tenantId: tenant.id,
        name: design.name,
        description: design.description,
        doc: design.build(),
        thumbnailAssetId: null,
        category: design.category,
        isStarter: true,
        version: 1,
        createdBy: owner.id,
        locked: false,
        createdAt: now,
        updatedAt: now,
      };
      await this.templates.insert(template);
      templates.push(template);
    }

    this.logger.log(
      `Provisioned tenant "${tenant.name}" (${tenant.slug}) with ${templates.length} starter templates`,
    );
    return { tenant, membership, subscription, templates };
  }

  /* ---------------------------------------------------------------- reads */

  async findById(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.deletedAt) throw AppException.tenantNotFound();
    return tenant;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const tenant = await this.tenants.findOne({ slug });
    if (!tenant || tenant.deletedAt) return null;
    return tenant;
  }

  /** Resolves the tenant that owns a hostname, for white-label vanity domains. */
  async findByHostname(hostname: string): Promise<Tenant | null> {
    const normalised = hostname
      .toLowerCase()
      .trim()
      .replace(/^www\./, '');
    const domain = await this.domains.findOne({ hostname: normalised, status: 'verified' });
    if (domain) return this.tenants.findById(domain.tenantId);
    const tenant = await this.tenants.findOne({ primaryDomain: normalised });
    return tenant && !tenant.deletedAt ? tenant : null;
  }

  async listForUser(
    userId: string,
  ): Promise<{ tenant: Tenant; role: Membership['role']; permissions: string[] }[]> {
    const memberships = await this.memberships.find(
      { userId, status: 'active' },
      { sort: { createdAt: 1 } },
    );
    const out: { tenant: Tenant; role: Membership['role']; permissions: string[] }[] = [];
    for (const m of memberships) {
      const tenant = await this.tenants.findById(m.tenantId);
      if (!tenant || tenant.deletedAt) continue;
      out.push({ tenant, role: m.role, permissions: permissionsForRole(m.role) });
    }
    return out;
  }

  /* -------------------------------------------------------------- updates */

  async update(tenantId: string, input: UpdateTenantInput, actorId: string): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== tenant.name) patch.name = input.name.trim();
    if (input.type !== undefined) patch.type = input.type;
    if (input.country !== undefined) patch.country = input.country;
    if (input.serialPrefix !== undefined) {
      const prefix = (input.serialPrefix || 'KDC').toUpperCase();
      if (prefix.length < 2 || prefix.length > 8) {
        throw AppException.validationFailed('Certificate prefix must be 2-8 letters or digits');
      }
      patch['settings.serialPrefix'] = prefix;
    }
    if (input.locale !== undefined) patch['settings.locale'] = input.locale;
    if (input.timezone !== undefined) patch['settings.timezone'] = input.timezone;
    if (Object.keys(patch).length === 0) return tenant;
    const updated = await this.tenants.updateById(tenantId, patch);
    if (!updated) throw AppException.tenantNotFound();
    this.logger.log(`Tenant ${tenantId} updated by ${actorId}`);
    return updated;
  }

  async updateBranding(
    tenantId: string,
    input: UpdateBrandingInput,
    actorId: string,
  ): Promise<Tenant> {
    await this.findById(tenantId);
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      if (key === 'hidePoweredBy' && value === true) {
        // Removing the platform mark is a paid white-label feature.
        this.assertFeature(await this.planOf(tenantId), 'whiteLabel');
      }
      patch[`branding.${key}`] = value === null ? null : value;
    }
    if (Object.keys(patch).length === 0) return this.findById(tenantId);
    const updated = await this.tenants.updateById(tenantId, patch);
    if (!updated) throw AppException.tenantNotFound();
    this.logger.log(`Branding updated for tenant ${tenantId} by ${actorId}`);
    return updated;
  }

  async updateSettings(
    tenantId: string,
    input: UpdateSettingsInput,
    actorId: string,
  ): Promise<Tenant> {
    await this.findById(tenantId);
    const plan = await this.planOf(tenantId);
    if (input.requireApproval === true) this.assertFeature(plan, 'approvalWorkflows');
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      patch[`settings.${key}`] = value;
    }
    if (Object.keys(patch).length === 0) return this.findById(tenantId);
    const updated = await this.tenants.updateById(tenantId, patch);
    if (!updated) throw AppException.tenantNotFound();
    this.logger.log(`Settings updated for tenant ${tenantId} by ${actorId}`);
    return updated;
  }

  /* --------------------------------------------------------------- domains */

  async addDomain(tenantId: string, hostname: string, actorId: string): Promise<TenantDomain> {
    const tenant = await this.findById(tenantId);
    this.assertFeature(await this.planOf(tenantId), 'customDomains');
    const normalised = hostname
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(normalised)) {
      throw AppException.validationFailed('Enter a valid hostname such as certs.college.edu');
    }
    if (normalised.length > 253) throw AppException.validationFailed('Hostname is too long');
    if (RESERVED_SLUGS.has(normalised.split('.')[0]!)) {
      throw AppException.validationFailed('That hostname is reserved by the platform');
    }
    const existing = await this.domains.findOne({ hostname: normalised });
    if (existing) {
      throw existing.tenantId === tenantId
        ? AppException.conflict('That domain is already registered for this organisation')
        : AppException.conflict('That domain is already registered to another organisation');
    }

    const verificationToken = `${this.env.DOMAIN_VERIFICATION_TXT_PREFIX}${generateInviteCode()}`;
    const cnameTarget = new URL(this.env.APP_URL).hostname;
    const domain: TenantDomain = {
      id: newId(),
      tenantId,
      hostname: normalised,
      status: 'pending',
      verificationToken,
      sslStatus: 'none',
      isPrimary: tenant.primaryDomain === null,
      lastCheckedAt: null,
      dnsRecords: [
        { type: 'CNAME', host: normalised, value: cnameTarget },
        { type: 'TXT', host: normalised, value: verificationToken },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.domains.insert(domain);
    this.logger.log(`Domain ${normalised} registered for tenant ${tenantId} by ${actorId}`);
    return domain;
  }

  async listDomains(tenantId: string): Promise<TenantDomain[]> {
    return this.domains.find({ tenantId }, { sort: { createdAt: 1 } });
  }

  /**
   * Marks a domain verified.
   *
   * Real DNS TXT verification needs a resolver that can reach the internet. When
   * `ALLOW_MANUAL_DOMAIN_VERIFICATION=true` (or NODE_ENV is not production) the
   * check can be confirmed manually by an operator; otherwise this throws so a
   * domain can never be marked verified without proof of control.
   */
  async verifyDomain(
    tenantId: string,
    domainId: string,
    opts: {
      dnsLookup?: (host: string, type: 'TXT' | 'CNAME') => Promise<string[]>;
      manual?: boolean;
    },
  ): Promise<TenantDomain> {
    const domain = await this.domains.findById(domainId);
    if (!domain || domain.tenantId !== tenantId) throw AppException.notFound('Domain');

    if (opts.manual) {
      const allowManual =
        process.env.ALLOW_MANUAL_DOMAIN_VERIFICATION === 'true' ||
        this.env.NODE_ENV !== 'production';
      if (!allowManual) {
        throw AppException.forbidden(
          'Manual domain verification is disabled in production; configure a DNS resolver',
        );
      }
      return this.markVerified(domain, 'manual');
    }
    if (!opts.dnsLookup) {
      throw AppException.serviceUnavailable(
        'DNS verification requires a resolver. Pass a lookup function or enable ALLOW_MANUAL_DOMAIN_VERIFICATION.',
      );
    }
    const records = await opts.dnsLookup(domain.hostname, 'TXT');
    const ok = records.some((r) => r.replace(/"/g, '').trim() === domain.verificationToken);
    if (!ok) {
      await this.domains.updateById(domain.id, { status: 'failed', lastCheckedAt: new Date() });
      throw AppException.conflict(
        `The TXT record for ${domain.hostname} does not match the expected value yet`,
      );
    }
    return this.markVerified(domain, 'dns');
  }

  private async markVerified(domain: TenantDomain, _how: 'dns' | 'manual'): Promise<TenantDomain> {
    const updated = await this.domains.updateById(domain.id, {
      status: 'verified',
      lastCheckedAt: new Date(),
      sslStatus: this.env.CUSTOM_DOMAINS_ENABLED ? 'provisioning' : 'none',
    });
    if (!updated) throw AppException.notFound('Domain');
    if (domain.isPrimary)
      await this.tenants.updateById(domain.tenantId, { primaryDomain: domain.hostname });
    this.logger.log(`Domain ${domain.hostname} verified for tenant ${domain.tenantId}`);
    return updated;
  }

  async removeDomain(tenantId: string, domainId: string): Promise<void> {
    const domain = await this.domains.findById(domainId);
    if (!domain || domain.tenantId !== tenantId) throw AppException.notFound('Domain');
    await this.domains.deleteById(domainId);
    if (domain.isPrimary) await this.tenants.updateById(tenantId, { primaryDomain: null });
  }

  /* ------------------------------------------------------- plan & quotas */

  async planOf(tenantId: string): Promise<PlanId> {
    const subscription = await this.subscriptions.findOne({ tenantId });
    const tenant = await this.tenants.findById(tenantId);
    return subscription?.planId ?? tenant?.planId ?? 'free';
  }

  async changePlan(tenantId: string, planId: PlanId, actorId: string): Promise<Subscription> {
    const existing = await this.subscriptions.findOne({ tenantId });
    const now = new Date();
    const plan = getPlan(planId);
    if (this.env.BILLING_PROVIDER !== 'stripe' || !this.env.STRIPE_SECRET_KEY) {
      // No PSP is attached: the change is recorded and enforced, but nothing is
      // charged. The response says so explicitly.
      this.logger.warn(
        `Plan for tenant ${tenantId} changed to ${planId} by ${actorId} in MANUAL billing mode - no payment was taken`,
      );
    }
    const patch: Record<string, unknown> = {
      planId,
      status: planId === 'free' ? 'active' : 'active',
      seats: plan.includedSeats,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
      provider:
        this.env.BILLING_PROVIDER === 'stripe' && this.env.STRIPE_SECRET_KEY ? 'stripe' : 'manual',
      trialEndsAt: null,
    };
    if (existing) {
      const updated = await this.subscriptions.updateById(existing.id, patch);
      if (!updated) throw AppException.notFound('Subscription');
      await this.tenants.updateById(tenantId, { planId });
      return updated;
    }
    const created: Subscription = {
      id: newId(),
      tenantId,
      ...(patch as Omit<Subscription, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'interval'>),
      interval: 'month',
      createdAt: now,
      updatedAt: now,
    };
    await this.subscriptions.insert(created);
    await this.tenants.updateById(tenantId, { planId });
    return created;
  }

  assertFeature(plan: PlanId, feature: FeatureKey): void {
    if (!planAllowsFeature(plan, feature)) {
      const upgrade = plan === 'free' ? 'starter' : plan === 'starter' ? 'growth' : 'enterprise';
      throw AppException.featureNotAvailable(
        feature.replace(/([A-Z])/g, ' $1').toLowerCase(),
        upgrade,
      );
    }
  }

  /** Rolls the monthly counter over if needed and returns fresh usage. */
  async currentUsage(
    tenantId: string,
  ): Promise<{ certificatesThisMonth: number; monthKey: string }> {
    const tenant = await this.findById(tenantId);
    const key = monthKey();
    if (tenant.usage?.monthKey === key) return { ...tenant.usage };
    const counted = await this.store
      .repository<{
        tenantId: string;
        status: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
      }>('certificates')
      .count({
        tenantId,
        status: { $in: ['issued', 'delivered'] },
        createdAt: { $gte: new Date(`${key}-01T00:00:00.000Z`) },
      });
    await this.tenants.updateById(tenantId, {
      usage: { certificatesThisMonth: counted, monthKey: key },
    });
    return { certificatesThisMonth: counted, monthKey: key };
  }

  async incrementUsage(tenantId: string, by = 1): Promise<number> {
    const usage = await this.currentUsage(tenantId);
    const next = usage.certificatesThisMonth + by;
    await this.tenants.updateById(tenantId, {
      usage: { certificatesThisMonth: next, monthKey: usage.monthKey },
    });
    return next;
  }

  /** Throws 402 when the tenant has no quota left this month. */
  async assertQuota(
    tenantId: string,
    requested: number,
  ): Promise<{ plan: PlanId; used: number; quota: number; remaining: number }> {
    const plan = await this.planOf(tenantId);
    const quota = getPlan(plan).monthlyCertificateQuota;
    const usage = await this.currentUsage(tenantId);
    const remaining = Math.max(0, quota - usage.certificatesThisMonth);
    if (requested > remaining) {
      const upgrade = plan === 'free' ? 'starter' : plan === 'starter' ? 'growth' : 'enterprise';
      throw AppException.quotaExceeded(
        `This request needs ${requested} certificates but only ${remaining} of the ${quota} monthly allowance remain.`,
        upgrade,
      );
    }
    return { plan, used: usage.certificatesThisMonth, quota, remaining };
  }

  /**
   * Enforces the per-plan ceiling on child resources.
   *
   * `kind` maps to the collection that actually holds the resource, so the count
   * is always the real one rather than a denormalised counter that could drift.
   */
  async assertHeadroom(
    tenantId: string,
    kind: 'templates' | 'events' | 'members' | 'webhooks' | 'apiKeys',
  ): Promise<void> {
    const plan = await this.planOf(tenantId);
    const entitlements = getPlan(plan);
    const limits = {
      templates: entitlements.maxTemplates,
      events: entitlements.maxEvents,
      members: entitlements.maxMembers,
      webhooks: entitlements.maxWebhooks,
      apiKeys: entitlements.maxApiKeys,
    } as const;
    const collections = {
      templates: 'templates',
      events: 'events',
      members: 'memberships',
      webhooks: 'webhook_endpoints',
      apiKeys: 'api_keys',
    } as const;
    const limit = limits[kind];
    const count = await this.store
      .repository<{ tenantId: string; id: string; createdAt: Date; updatedAt: Date }>(
        collections[kind],
      )
      .count({ tenantId });
    if (count >= limit) {
      const upgrade = plan === 'free' ? 'starter' : plan === 'starter' ? 'growth' : 'enterprise';
      const labels = {
        templates: 'certificate designs',
        events: 'events',
        members: 'team members',
        webhooks: 'webhook endpoints',
        apiKeys: 'API keys',
      } as const;
      throw AppException.quotaExceeded(
        `The ${plan} plan allows up to ${limit} ${labels[kind]} and this organisation already has ${count}.`,
        upgrade,
      );
    }
  }
}
