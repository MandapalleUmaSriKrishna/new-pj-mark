import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { ApprovalRequest, Certificate } from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { AllowApiKey, RequirePermissions } from '../common/decorators/permissions.decorator';
import {
  CertificatesService,
  type IssueContext,
  type PublicCertificate,
} from './certificates.service';
import { QrService } from '../pdf/qr.service';
import {
  approveSchema,
  issueBulkSchema,
  issueOneSchema,
  listCertificatesSchema,
  rejectSchema,
  resendSchema,
  revokeSchema,
  type ApproveInput,
  type IssueBulkInput,
  type IssueOneInput,
  type ListCertificatesInput,
  type RejectInput,
  type ResendInput,
  type RevokeInput,
} from './dto';

/**
 * Certificate issuance, retrieval, approval and revocation.
 *
 * Reads are open to API keys (`@AllowApiKey`) so an institution's student system
 * can pull results; every write requires a session or a key with the matching
 * scope and is recorded in the hash-chained audit log by the service layer.
 */
/** `PublicCertificate` plus the one-time private download link. */
export type IssuedCertificateResponse = PublicCertificate & {
  downloadToken: string;
  downloadUrl: string;
};

@ApiTags('certificates')
@Controller('tenants/:tenantId/certificates')
export class CertificatesController {
  constructor(
    private readonly certificates: CertificatesService,
    private readonly qr: QrService,
  ) {}

  @Get()
  @RequirePermissions('certificate:read')
  @AllowApiKey('certificates:read')
  @ApiOperation({ summary: 'List certificates with filtering, search and pagination' })
  async list(@TenantId() tenantId: string, @Query() query: Record<string, unknown>) {
    const input = listCertificatesSchema.parse(query) as ListCertificatesInput;
    return this.certificates.list(tenantId, input);
  }

  @Get('stats')
  @RequirePermissions('certificate:read')
  @AllowApiKey('analytics:read')
  @ApiOperation({ summary: 'Issuance counters by status' })
  async stats(@TenantId() tenantId: string) {
    return this.certificates.stats(tenantId);
  }

  @Get('approvals')
  @RequirePermissions('certificate:approve', 'certificate:reject')
  @ApiOperation({ summary: 'Approval queue' })
  async approvals(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
  ): Promise<{ items: (ApprovalRequest & { certificate?: Certificate })[] }> {
    const allowed = ['pending', 'approved', 'rejected'];
    const value =
      status && allowed.includes(status)
        ? (status as 'pending' | 'approved' | 'rejected')
        : 'pending';
    return { items: await this.certificates.listApprovals(tenantId, value) };
  }

  @Get('serial/:serial')
  @RequirePermissions('certificate:read')
  @AllowApiKey('certificates:read')
  @ApiOperation({ summary: 'Look a certificate up by its printed serial' })
  async bySerial(
    @TenantId() tenantId: string,
    @Param('serial') serial: string,
  ): Promise<PublicCertificate> {
    return this.certificates.toPublic(await this.certificates.findBySerial(tenantId, serial));
  }

  @Post('issue')
  @HttpCode(201)
  @RequirePermissions('certificate:issue')
  @AllowApiKey('certificates:write')
  @ApiOperation({ summary: 'Issue a single certificate' })
  async issueOne(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<IssueOneInput>(issueOneSchema, 'Issuance')) body: IssueOneInput,
    @AuthCtx() ctx: AuthContext,
    @Req() req: Request,
  ): Promise<IssuedCertificateResponse> {
    const input = body;
    const issued = await this.certificates.issueOne(
      tenantId,
      input,
      this.issueContext(ctx, req, input.issuedAt),
    );
    const view = await this.certificates.toPublic(issued);
    // Shown once and never stored in plaintext: only the SHA-256 hash is kept.
    return { ...view, downloadToken: issued.downloadToken, downloadUrl: issued.downloadUrl };
  }

  @Post('issue-bulk')
  @HttpCode(202)
  @RequirePermissions('certificate:bulk_issue')
  @ApiOperation({ summary: 'Queue a bulk issuance run and return the job to watch' })
  async issueBulk(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<IssueBulkInput>(issueBulkSchema, 'Bulk issuance'))
    body: IssueBulkInput,
    @AuthCtx() ctx: AuthContext,
    @Req() req: Request,
  ) {
    const input = body;
    return this.certificates.issueBulk(
      tenantId,
      input,
      this.issueContext(ctx, req, input.issuedAt),
    );
  }

  @Get(':certificateId')
  @RequirePermissions('certificate:read')
  @AllowApiKey('certificates:read')
  @ApiOperation({ summary: 'Read one certificate' })
  async one(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
  ): Promise<PublicCertificate & { integrityOk: boolean }> {
    const certificate = await this.certificates.get(tenantId, certificateId);
    const [pub, integrityOk] = await Promise.all([
      this.certificates.toPublic(certificate),
      this.certificates.checkIntegrity(certificate),
    ]);
    return { ...pub, integrityOk };
  }

  /**
   * Streams the PDF. A member with `certificate:download` gets it directly; the
   * public route requires the private token instead. The stored SHA-256 is
   * re-verified before the bytes leave the server, so a corrupted or tampered
   * object is never served.
   */
  @Get(':certificateId/pdf')
  @RequirePermissions('certificate:download')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Download the certificate PDF' })
  async pdf(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
    @AuthCtx() ctx: AuthContext,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const existing = await this.certificates.get(tenantId, certificateId);
    const outcome = await this.certificates.download(existing.id, {
      actorId: ctx.userId,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.setHeader('Content-Type', outcome.mimeType);
    res.setHeader('Content-Length', String(outcome.buffer.byteLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${outcome.filename.replace(/"/g, '')}"`,
    );
    res.setHeader('X-KDC-Serial', outcome.certificate.serial);
    res.setHeader('X-KDC-SHA256', outcome.sha256);
    res.status(200).end(outcome.buffer);
  }

  @Get(':certificateId/qr')
  @RequirePermissions('certificate:read')
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({ summary: 'QR code (PNG) pointing at the public verification page' })
  async qrPng(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const certificate = await this.certificates.get(tenantId, certificateId);
    const pixels = Math.max(64, Math.min(1024, Number.parseInt(size ?? '256', 10) || 256));
    const png = await this.qr.toPngBuffer({
      text: this.certificates.verifyUrlFor(certificate.serial),
      sizePoints: pixels,
      errorLevel: 'M',
      marginModules: 2,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(png.byteLength));
    res.status(200).end(png);
  }

  @Post(':certificateId/render')
  @HttpCode(202)
  @RequirePermissions('certificate:issue')
  @ApiOperation({ summary: 'Re-render the PDF (after a design change or a failed render)' })
  async render(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
    @Body() body: { watermark?: 'draft' | 'specimen' | 'revoked' } | undefined,
  ) {
    const certificate = await this.certificates.get(tenantId, certificateId);
    const outcome = await this.certificates.renderCertificate(certificate.id, {
      watermark: body?.watermark ?? null,
    });
    return {
      assetId: outcome.assetId,
      bytes: outcome.bytes,
      sha256: outcome.sha256,
      warnings: outcome.warnings,
    };
  }

  @Post(':certificateId/approve')
  @HttpCode(200)
  @RequirePermissions('certificate:approve')
  @ApiOperation({ summary: 'Approve a pending certificate (issues it)' })
  async approve(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
    @Body(new ZodValidationPipe<ApproveInput>(approveSchema, 'Approval')) body: ApproveInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<PublicCertificate> {
    if (!ctx.userId) throw AppException.unauthenticated();
    const certificate = await this.certificates.get(tenantId, certificateId);
    return this.certificates.toPublic(
      await this.certificates.approve(tenantId, certificate.id, ctx.userId, body),
    );
  }

  @Post(':certificateId/reject')
  @HttpCode(200)
  @RequirePermissions('certificate:reject')
  @ApiOperation({ summary: 'Reject a pending certificate' })
  async reject(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
    @Body(new ZodValidationPipe<RejectInput>(rejectSchema, 'Rejection')) body: RejectInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<PublicCertificate> {
    if (!ctx.userId) throw AppException.unauthenticated();
    const certificate = await this.certificates.get(tenantId, certificateId);
    return this.certificates.toPublic(
      await this.certificates.reject(tenantId, certificate.id, ctx.userId, body),
    );
  }

  @Post(':certificateId/revoke')
  @HttpCode(200)
  @RequirePermissions('certificate:revoke')
  @ApiOperation({ summary: 'Revoke a certificate; verification immediately reports it' })
  async revoke(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
    @Body(new ZodValidationPipe<RevokeInput>(revokeSchema, 'Revocation')) body: RevokeInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<PublicCertificate> {
    if (!ctx.userId) throw AppException.unauthenticated();
    const certificate = await this.certificates.get(tenantId, certificateId);
    return this.certificates.toPublic(
      await this.certificates.revoke(tenantId, certificate.id, ctx.userId, body),
    );
  }

  @Post(':certificateId/resend')
  @HttpCode(202)
  @RequirePermissions('certificate:resend')
  @ApiOperation({ summary: 'Re-send the certificate email' })
  async resend(
    @TenantId() tenantId: string,
    @Param('certificateId') certificateId: string,
    @Body(new ZodValidationPipe<ResendInput>(resendSchema, 'Resend')) body: ResendInput,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    const certificate = await this.certificates.get(tenantId, certificateId);
    return this.certificates.resend(tenantId, certificate.id, ctx.userId, body);
  }

  private issueContext(ctx: AuthContext, req: Request, issuedAt?: Date): IssueContext {
    if (!ctx.userId) throw AppException.unauthenticated();
    return {
      actorId: ctx.userId,
      requestId: ctx.requestId,
      ip: req.ip ?? ctx.ip,
      userAgent: req.headers['user-agent'] ?? ctx.userAgent,
      issuedAt: issuedAt ?? null,
    };
  }
}
