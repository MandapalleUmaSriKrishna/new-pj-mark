import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import type {
  Tenant,
  TenantDomain,
  TenantSettings,
  TenantBranding,
  TenantQuotaUsage,
} from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { AppException } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import {
  createTenantSchema,
  updateBrandingSchema,
  updateSettingsSchema,
  updateTenantSchema,
  type CreateTenantInput,
  type UpdateBrandingInput,
  type UpdateSettingsInput,
  type UpdateTenantInput,
} from '../auth/dto';
import { TenantsService, type ProvisionedTenant } from './tenants.service';

/** What a client may see about an organisation it belongs to. */
export interface TenantView {
  id: string;
  name: string;
  slug: string;
  type: Tenant['type'];
  country: string;
  planId: Tenant['planId'];
  status: Tenant['status'];
  ownerEmail: string;
  branding: TenantBranding;
  settings: TenantSettings;
  usage: TenantQuotaUsage;
  primaryDomain: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Organisations, branding, settings and custom domains.
 *
 * `POST /tenants` and `GET /tenants` operate on the caller's account rather than
 * a single organisation, so they carry no permission decorator - authentication
 * alone is enough. Everything under `/tenants/:tenantId` is checked against the
 * caller's role inside that tenant, and a tenant the caller does not belong to
 * returns 404 rather than 403 so its existence cannot be probed.
 */
@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an organisation (tenant) owned by the caller' })
  async create(
    @Body(new ZodValidationPipe<CreateTenantInput>(createTenantSchema, 'Organisation'))
    body: CreateTenantInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<{ tenant: TenantView; slug: string }> {
    if (!ctx.userId) throw AppException.unauthenticated();
    const provisioned: ProvisionedTenant = await this.tenants.provisionForUser(ctx.userId, body);
    return { tenant: toTenantView(provisioned.tenant), slug: provisioned.tenant.slug };
  }

  @Get()
  @ApiOperation({ summary: 'List the organisations the caller belongs to' })
  async mine(
    @AuthCtx() ctx: AuthContext,
  ): Promise<{ items: { tenant: TenantView; role: string; permissions: string[] }[] }> {
    if (!ctx.userId) throw AppException.unauthenticated();
    const rows = await this.tenants.listForUser(ctx.userId);
    return {
      items: rows.map((r) => ({
        tenant: toTenantView(r.tenant),
        role: r.role,
        permissions: r.permissions,
      })),
    };
  }

  @Get(':tenantId')
  @RequirePermissions('tenant:read')
  @ApiOperation({ summary: 'Read one organisation' })
  async one(@TenantId() tenantId: string): Promise<TenantView> {
    return toTenantView(await this.tenants.findById(tenantId));
  }

  @Patch(':tenantId')
  @RequirePermissions('tenant:update')
  @ApiOperation({ summary: 'Update organisation details' })
  async update(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<UpdateTenantInput>(updateTenantSchema, 'Organisation'))
    body: UpdateTenantInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<TenantView> {
    return toTenantView(await this.tenants.update(tenantId, body, ctx.userId ?? ''));
  }

  @Patch(':tenantId/branding')
  @RequirePermissions('branding:update')
  @ApiOperation({ summary: 'Update white-label branding' })
  async branding(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<UpdateBrandingInput>(updateBrandingSchema, 'Branding'))
    body: UpdateBrandingInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<TenantView> {
    return toTenantView(await this.tenants.updateBranding(tenantId, body, ctx.userId ?? ''));
  }

  @Patch(':tenantId/settings')
  @RequirePermissions('tenant:update')
  @ApiOperation({ summary: 'Update issuance, verification and email settings' })
  async settings(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<UpdateSettingsInput>(updateSettingsSchema, 'Settings'))
    body: UpdateSettingsInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<TenantView> {
    return toTenantView(await this.tenants.updateSettings(tenantId, body, ctx.userId ?? ''));
  }

  /* ------------------------------------------------------------ domains */

  @Get(':tenantId/domains')
  @RequirePermissions('domain:manage', 'tenant:read')
  @ApiOperation({ summary: 'List custom domains and their verification state' })
  async domains(
    @TenantId() tenantId: string,
  ): Promise<{ items: TenantDomain[]; enabled: boolean }> {
    return {
      items: await this.tenants.listDomains(tenantId),
      enabled: this.env.CUSTOM_DOMAINS_ENABLED,
    };
  }

  @Post(':tenantId/domains')
  @HttpCode(201)
  @RequirePermissions('domain:manage')
  @ApiOperation({ summary: 'Add a custom domain and get the DNS record to publish' })
  async addDomain(
    @TenantId() tenantId: string,
    @Body() body: { hostname?: string },
    @AuthCtx() ctx: AuthContext,
  ): Promise<{ domain: TenantDomain; instructions: string[] }> {
    this.assertDomainsEnabled();
    const hostname = String(body?.hostname ?? '')
      .trim()
      .toLowerCase();
    if (!hostname) throw AppException.validationFailed('A hostname is required');
    const domain = await this.tenants.addDomain(tenantId, hostname, ctx.userId ?? '');
    return { domain, instructions: domainInstructions(domain) };
  }

  @Post(':tenantId/domains/:domainId/verify')
  @HttpCode(200)
  @RequirePermissions('domain:manage')
  @ApiOperation({ summary: 'Verify a custom domain by DNS TXT lookup' })
  async verifyDomain(
    @TenantId() tenantId: string,
    @Param('domainId') domainId: string,
    @Body() body: { manual?: boolean } | undefined,
  ): Promise<TenantDomain> {
    this.assertDomainsEnabled();
    const manual = body?.manual === true;
    return this.tenants.verifyDomain(tenantId, domainId, {
      manual,
      dnsLookup: async (host, type) => {
        if (type === 'CNAME') return resolveCname(host);
        const records = await resolveTxt(host);
        // A TXT lookup returns one array per record; flatten to plain strings.
        return records.map((parts) => parts.join(''));
      },
    });
  }

  @Delete(':tenantId/domains/:domainId')
  @RequirePermissions('domain:manage')
  @ApiOperation({ summary: 'Remove a custom domain' })
  async removeDomain(
    @TenantId() tenantId: string,
    @Param('domainId') domainId: string,
  ): Promise<{ ok: true }> {
    await this.tenants.removeDomain(tenantId, domainId);
    return { ok: true };
  }

  private assertDomainsEnabled(): void {
    if (!this.env.CUSTOM_DOMAINS_ENABLED) {
      throw new AppException(
        'feature_not_available',
        'Custom domains are disabled in this deployment.',
        {
          remedy:
            'Set CUSTOM_DOMAINS_ENABLED=true and terminate TLS for the hostname at your proxy or CDN.',
        },
        503,
      );
    }
  }
}

export function toTenantView(tenant: Tenant): TenantView {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    country: tenant.country,
    planId: tenant.planId,
    status: tenant.status,
    ownerEmail: tenant.ownerEmail,
    branding: tenant.branding,
    settings: tenant.settings,
    usage: tenant.usage,
    primaryDomain: tenant.primaryDomain ?? null,
    createdAt: new Date(tenant.createdAt).toISOString(),
    updatedAt: new Date(tenant.updatedAt).toISOString(),
  };
}

/**
 * Written-out DNS steps. The records come from the domain row itself so the
 * instructions always match exactly what the verifier will look for.
 */
export function domainInstructions(domain: TenantDomain): string[] {
  const records = domain.dnsRecords.length
    ? domain.dnsRecords.map(
        (r, i) =>
          `${i + 1}. Add a ${r.type} record at ${r.host || domain.hostname} with the value ${r.value}`,
      )
    : [`1. Add a TXT record at ${domain.hostname} with the value ${domain.verificationToken}`];
  return [
    ...records,
    `${records.length + 1}. Wait for DNS to propagate (usually minutes, occasionally up to 24 hours)`,
    `${records.length + 2}. Call POST /tenants/:tenantId/domains/${domain.id}/verify to confirm ownership`,
    `${records.length + 3}. Terminate TLS for ${domain.hostname} at your load balancer or CDN - this API does not issue TLS certificates itself`,
  ];
}
