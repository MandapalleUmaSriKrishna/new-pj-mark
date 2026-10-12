import { Controller, Get, Header, Inject, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { STORAGE_PORT, type StoragePort } from '../infra/storage/storage.port';
import { AppException } from '../common/errors/app.exception';
import { Public, RateLimit } from '../common/decorators/permissions.decorator';

/**
 * Signed object download.
 *
 * Used by the local storage driver, whose `signedUrl` points here. The signature
 * covers `key:expires`, so a URL cannot be replayed after expiry or rewritten to
 * a different key. Keys are always tenant-namespaced, and the key is never taken
 * from user input without signature verification - which is what stops someone
 * from walking the storage tree by editing a path.
 */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  @Public()
  @Get('download')
  @RateLimit(120, 60)
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({ summary: 'Download an object using a signed, expiring URL' })
  async download(
    @Query('key') key: string | undefined,
    @Query('expires') expires: string | undefined,
    @Query('sig') sig: string | undefined,
    @Query('filename') filename: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!key || !expires || !sig) {
      throw AppException.validationFailed(
        'A signed download link requires key, expires and sig parameters',
      );
    }
    if (!this.storage.signsThroughApp) {
      // Object storage signs for direct access; this route must not proxy it.
      throw new AppException(
        'storage_not_configured',
        'This deployment serves downloads directly from object storage; the proxy route is disabled.',
        undefined,
        503,
      );
    }
    if (!this.storage.verifySignedUrl(key, expires, sig)) {
      throw AppException.forbidden('That download link is invalid or has expired');
    }
    // Refuse path traversal even though keys are generated internally.
    if (key.includes('..') || key.startsWith('/')) {
      throw AppException.forbidden('That download link is invalid');
    }
    const buffer = await this.storage.get(key);
    if (!buffer) throw AppException.notFound('File');

    const safeName = (filename ?? key.split('/').pop() ?? 'download').replace(/["\\\r\n]/g, '');
    const isPdf = key.toLowerCase().endsWith('.pdf');
    res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.byteLength));
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.status(200).end(buffer);
  }
}
