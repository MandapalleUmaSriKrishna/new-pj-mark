import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Body,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { AppException } from '../common/errors/app.exception';
import { Public, RateLimit } from '../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CertificatesService, type VerificationResult } from '../certificates/certificates.service';
import { verifySchema, type VerifyInput } from '../certificates/dto';
import { TenantsService } from '../tenants/tenants.service';
import { AssetsService } from '../assets/assets.service';
import type { Tenant } from '@kdc/shared';

/** Fields safe to expose to anyone who can read a certificate serial. */
export interface PublicTenantBranding {
  slug: string;
  name: string;
  locale: string;
  branding: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    tagline: string | null;
    hidePoweredBy: boolean;
    websiteUrl: string | null;
    supportEmail: string | null;
  };
}

/**
 * The unauthenticated surface: certificate verification and tenant resolution
 * for custom domains.
 *
 * Everything here is reachable by any scanner on the internet, so it is
 * rate-limited per IP, reveals the minimum needed to prove a certificate is
 * genuine, and records each lookup as a `VerificationEvent` so an organisation
 * can see who checked what and when.
 */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly certificates: CertificatesService,
    private readonly tenants: TenantsService,
    private readonly assets: AssetsService,
  ) {}

  @Public()
  @Get('verify')
  @RateLimit(30, 60)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Verify a certificate serial (QR target)' })
  async verifyGet(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<VerificationResult> {
    const input = verifySchema.parse(query) as VerifyInput;
    return this.certificates.verify(input.serial, {
      email: input.email ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      referer: req.headers.referer ?? null,
    });
  }

  @Public()
  @Post('verify')
  @RateLimit(30, 60)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Verify a certificate serial (form post)' })
  async verifyPost(@Body() body: unknown, @Req() req: Request): Promise<VerificationResult> {
    const input = new ZodValidationPipe<VerifyInput>(verifySchema, 'Verification').transform(body, {
      type: 'body',
      metatype: Object,
      data: undefined,
    });
    return this.certificates.verify(input.serial, {
      email: input.email ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      referer: req.headers.referer ?? null,
    });
  }

  /**
   * Private download by serial + unguessable token.
   *
   * The token is a 256-bit random value issued with the certificate email and
   * stored only as a hash, so a serial alone is never enough. `email` is
   * additionally required when the tenant turns on email-gated downloads.
   */
  @Public()
  @Get('certificates/:serial.pdf')
  @RateLimit(20, 60)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Download a certificate PDF with a signed private link' })
  async downloadPdf(
    @Param('serial') serial: string,
    @Query('token') token: string | undefined,
    @Query('email') email: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const certificate = await this.certificates.resolvePublicSerial(serial);
    const outcome = await this.certificates.download(certificate.id, {
      actorId: null,
      downloadToken: token ?? null,
      requireEmail: email ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.setHeader('Content-Type', outcome.mimeType);
    res.setHeader('Content-Length', String(outcome.buffer.byteLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${outcome.filename.replace(/"/g, '')}"`,
    );
    res.setHeader('X-KDC-SHA256', outcome.sha256);
    res.status(200).end(outcome.buffer);
  }

  /**
   * Resolves the organisation behind a custom domain so the web app can paint
   * white-label branding before the user signs in. Returns 404 rather than a
   * tenant list, so domains cannot be enumerated.
   */
  @Public()
  @Get('tenant-by-host')
  @RateLimit(60, 60)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Resolve a custom hostname to its organisation branding' })
  async tenantByHost(@Query('host') host: string | undefined): Promise<PublicTenantBranding> {
    if (!this.env.CUSTOM_DOMAINS_ENABLED) {
      throw new AppException(
        'feature_not_available',
        'Custom domains are disabled in this deployment (set CUSTOM_DOMAINS_ENABLED=true to enable them).',
        undefined,
        503,
      );
    }
    const hostname = (host ?? '')
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
      throw AppException.validationFailed('A valid hostname is required');
    }
    const tenant = await this.tenants.findByHostname(hostname);
    if (!tenant || tenant.deletedAt || tenant.status === 'suspended')
      throw AppException.notFound('Organisation');
    return this.toPublicBranding(tenant);
  }

  /**
   * Branding an anonymous visitor may see. Asset ids are turned into short-lived
   * signed URLs so the browser can paint the logo without an authenticated
   * session; nothing else about the tenant is exposed.
   */
  private async toPublicBranding(tenant: Tenant): Promise<PublicTenantBranding> {
    const [logoUrl, faviconUrl] = await Promise.all([
      this.publicAssetUrl(tenant.id, tenant.branding.logoAssetId),
      this.publicAssetUrl(tenant.id, tenant.branding.faviconAssetId),
    ]);
    return {
      slug: tenant.slug,
      name: tenant.name,
      locale: tenant.settings?.locale ?? 'en',
      branding: {
        primaryColor: tenant.branding.primaryColor,
        secondaryColor: tenant.branding.secondaryColor,
        accentColor: tenant.branding.accentColor,
        logoUrl,
        faviconUrl,
        tagline: tenant.branding.tagline ?? null,
        hidePoweredBy: tenant.branding.hidePoweredBy === true,
        websiteUrl: tenant.branding.website ?? null,
        supportEmail: tenant.branding.supportEmail ?? null,
      },
    };
  }

  private async publicAssetUrl(
    tenantId: string,
    assetId: string | null | undefined,
  ): Promise<string | null> {
    if (!assetId) return null;
    try {
      const { url } = await this.assets.signedUrl(tenantId, assetId, BRANDING_URL_TTL_SECONDS);
      return url;
    } catch {
      // A missing or unauthorised asset must not break branding resolution.
      return null;
    }
  }
}
/** How long a branding image URL stays valid; logos are not secrets. */
const BRANDING_URL_TTL_SECONDS = 24 * 3600;
