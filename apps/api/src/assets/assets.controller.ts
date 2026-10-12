import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type { Asset, AssetKind } from '@kdc/shared';
import { ASSET_KINDS } from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AssetsService } from './assets.service';
import { AuditService } from '../audit/audit.service';

/** Kinds a member may upload directly; generated kinds are system-only. */
const UPLOADABLE_KINDS: AssetKind[] = [
  'logo',
  'signature',
  'seal',
  'background',
  'template_image',
  'font',
];

const MIME_FILTER = (
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, accept: boolean) => void,
): void => {
  const ok =
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf' ||
    file.mimetype.includes('font') ||
    file.mimetype === 'application/octet-stream';
  cb(ok ? null : new BadRequestException(`Unsupported file type "${file.mimetype}"`), ok);
};

/** Branding images, signatures, seals and custom fonts used by the designer. */
@ApiTags('assets')
@Controller('tenants/:tenantId/assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('tenant:read', 'template:read')
  @ApiOperation({ summary: 'List uploaded assets' })
  async list(
    @TenantId() tenantId: string,
    @Query('kind') kind?: string,
  ): Promise<{ items: Asset[]; kinds: AssetKind[] }> {
    const valid = kind && ASSET_KINDS.includes(kind as AssetKind) ? (kind as AssetKind) : undefined;
    return { items: await this.assets.list(tenantId, valid), kinds: UPLOADABLE_KINDS };
  }

  @Get(':assetId')
  @RequirePermissions('tenant:read', 'template:read')
  @ApiOperation({ summary: 'Asset metadata' })
  async one(@TenantId() tenantId: string, @Param('assetId') assetId: string): Promise<Asset> {
    return this.assets.get(tenantId, assetId);
  }

  @Get(':assetId/url')
  @RequirePermissions('tenant:read', 'template:read')
  @ApiOperation({ summary: 'Short-lived signed URL for the asset bytes' })
  async url(
    @TenantId() tenantId: string,
    @Param('assetId') assetId: string,
    @Query('ttl') ttl?: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const seconds = Math.max(30, Math.min(86_400, Number.parseInt(ttl ?? '900', 10) || 900));
    const result = await this.assets.signedUrl(tenantId, assetId, seconds);
    return { url: result.url, expiresAt: result.expiresAt.toISOString() };
  }

  /** Streams the bytes directly, for the designer canvas which cannot use signed URLs offline. */
  @Get(':assetId/download')
  @RequirePermissions('tenant:read', 'template:read')
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Stream the asset bytes' })
  async download(
    @TenantId() tenantId: string,
    @Param('assetId') assetId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.assets.get(tenantId, assetId);
    const read = await this.assets.read(assetId, { tenantId });
    if (!read) throw AppException.notFound('Asset bytes');
    res.setHeader('Content-Type', read.asset.mimeType);
    res.setHeader('Content-Length', String(read.buffer.byteLength));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${read.asset.filename.replace(/"/g, '')}"`,
    );
    res.status(200).end(read.buffer);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('branding:update', 'template:create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image, logo, signature, seal or font' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
      fileFilter: MIME_FILTER as never,
    }),
  )
  async upload(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string | undefined>,
    @AuthCtx() ctx: AuthContext,
  ): Promise<Asset> {
    if (!file?.buffer?.length)
      throw AppException.validationFailed('A file must be uploaded in the "file" field');
    if (!ctx.userId) throw AppException.unauthenticated();
    const kind = (body?.kind ?? 'template_image') as AssetKind;
    if (!UPLOADABLE_KINDS.includes(kind)) {
      throw AppException.validationFailed(`kind must be one of ${UPLOADABLE_KINDS.join(', ')}`);
    }
    const asset = await this.assets.upload(tenantId, file, {
      kind,
      uploadedBy: ctx.userId,
      isPublic: body?.isPublic === 'true',
    });
    await this.audit.record({
      tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role ?? 'admin',
      action: 'asset.uploaded',
      entityType: 'asset',
      entityId: asset.id,
      payload: {
        filename: asset.filename,
        kind,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
        sha256: asset.sha256,
      },
    });
    return asset;
  }

  @Delete(':assetId')
  @RequirePermissions('branding:update', 'template:delete')
  @ApiOperation({ summary: 'Delete an asset' })
  async remove(
    @TenantId() tenantId: string,
    @Param('assetId') assetId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    const asset = await this.assets.get(tenantId, assetId);
    const result = await this.assets.remove(tenantId, assetId);
    await this.audit.record({
      tenantId,
      actorId: ctx.userId ?? undefined,
      actorRole: ctx.role ?? 'admin',
      action: 'asset.deleted',
      entityType: 'asset',
      entityId: assetId,
      payload: { filename: asset.filename, kind: asset.kind },
      severity: 'warning',
    });
    return result;
  }
}
