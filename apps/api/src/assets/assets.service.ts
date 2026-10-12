import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Asset, AssetKind } from '@kdc/shared';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import {
  STORAGE_PORT,
  tenantKey,
  publicAssetKey,
  type StoragePort,
} from '../infra/storage/storage.port';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { newId } from '../infra/ids';
import { CryptoService } from '../infra/crypto/crypto.service';
import { AppException } from '../common/errors/app.exception';

/**
 * Uploaded binary assets: logos, signatures, seals, backgrounds and generated
 * certificate PDFs.
 *
 * Uploads are type-checked against an allow-list, size-capped, hashed and stored
 * under a tenant-namespaced key. Images are additionally sniffed by magic bytes
 * so a renamed executable cannot be served back as an image.
 */

const IMAGE_SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  {
    mime: 'image/png',
    test: (b) => b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG',
  },
  {
    mime: 'image/jpeg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  { mime: 'image/gif', test: (b) => b.length > 6 && b.subarray(0, 3).toString('latin1') === 'GIF' },
  {
    mime: 'image/webp',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const ALLOWED_UPLOAD_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'font/ttf',
  'application/font-sfnt',
  'font/otf',
  'application/x-font-ttf',
  'application/x-font-opentype',
]);

const MAX_SVG_BYTES = 2 * 1024 * 1024;

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly assets: Repository<Asset>;
  private readonly cache = new Map<string, { buffer: Buffer; at: number }>();

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly crypto: CryptoService,
  ) {
    this.assets = store.repository<Asset>('assets');
  }

  /** Validates an upload and returns the normalised mime type + safe filename. */
  validateUpload(
    file: { originalname: string; mimetype: string; buffer: Buffer },
    kind: AssetKind,
  ): { mimeType: string; filename: string } {
    const maxBytes = this.env.MAX_UPLOAD_MB * 1024 * 1024;
    if (!file.buffer || file.buffer.byteLength === 0)
      throw AppException.validationFailed('The uploaded file is empty');
    if (file.buffer.byteLength > maxBytes) {
      throw new AppException(
        'file_too_large',
        `File exceeds the ${this.env.MAX_UPLOAD_MB} MB limit`,
        undefined,
        413,
      );
    }
    const declared = (file.mimetype || '').toLowerCase().split(';')[0]!.trim();
    if (!ALLOWED_UPLOAD_MIME.has(declared)) {
      throw new AppException(
        'unsupported_file_type',
        `File type "${declared || 'unknown'}" is not allowed`,
        undefined,
        400,
      );
    }

    const sniffed = IMAGE_SIGNATURES.find((s) => s.test(file.buffer));
    if (
      declared.startsWith('image/') &&
      declared !== 'image/svg+xml' &&
      (!sniffed || sniffed.mime !== declared)
    ) {
      throw new AppException(
        'unsupported_file_type',
        `File content does not match its declared type (${declared}). Upload a genuine image.`,
        undefined,
        400,
      );
    }
    if (declared === 'image/svg+xml') {
      if (file.buffer.byteLength > MAX_SVG_BYTES) {
        throw new AppException('file_too_large', 'SVG uploads are limited to 2 MB', undefined, 413);
      }
      const text = file.buffer.toString('utf8').toLowerCase();
      // SVG is XML and can carry script; refuse the dangerous constructs rather
      // than trying to sanitise them.
      for (const forbidden of [
        '<script',
        'javascript:',
        'onload=',
        'onerror=',
        'onclick=',
        '<iframe',
        'data:text/html',
      ]) {
        if (text.includes(forbidden)) {
          throw new AppException(
            'unsupported_file_type',
            `SVG contains a disallowed construct: ${forbidden}`,
            undefined,
            400,
          );
        }
      }
      if (!text.includes('<svg'))
        throw new AppException(
          'unsupported_file_type',
          'File is not a valid SVG document',
          undefined,
          400,
        );
    }
    if (
      declared === 'application/pdf' &&
      file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-'
    ) {
      throw new AppException(
        'unsupported_file_type',
        'File is not a valid PDF document',
        undefined,
        400,
      );
    }

    const filename = sanitiseFilename(file.originalname);
    void kind;
    return { mimeType: declared, filename };
  }

  async upload(
    tenantId: string | null,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    opts: { kind: AssetKind; uploadedBy?: string | null; isPublic?: boolean },
  ): Promise<Asset> {
    const { mimeType, filename } = this.validateUpload(file, opts.kind);
    const ext = extOf(filename, mimeType);
    const id = newId();
    const key =
      tenantId && !opts.isPublic
        ? tenantKey(tenantId, opts.kind, `${id}${ext}`)
        : publicAssetKey(tenantId ?? 'platform', opts.kind, `${id}${ext}`);

    const stored = await this.storage.put(key, file.buffer, mimeType);
    const now = new Date();
    const asset: Asset = {
      id,
      tenantId,
      kind: opts.kind,
      filename,
      mimeType,
      sizeBytes: stored.sizeBytes,
      storageKey: key,
      sha256: stored.sha256,
      width: null,
      height: null,
      uploadedBy: opts.uploadedBy ?? null,
      isPublic: opts.isPublic ?? false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.assets.insert(asset);
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        // Same content uploaded twice concurrently: reuse the existing row.
        const existing = await this.assets.findOne({ storageKey: key });
        if (existing) return existing;
      }
      await this.storage.delete(key);
      throw err;
    }
    return asset;
  }

  /** Stores a generated artefact (a rendered certificate PDF). */
  async storeGenerated(
    tenantId: string,
    kind: AssetKind,
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<Asset> {
    const id = newId();
    const key = tenantKey(tenantId, kind, `${id}-${sanitiseFilename(filename)}`);
    const stored = await this.storage.put(key, buffer, mimeType);
    const now = new Date();
    const asset: Asset = {
      id,
      tenantId,
      kind,
      filename,
      mimeType,
      sizeBytes: stored.sizeBytes,
      storageKey: key,
      sha256: stored.sha256,
      width: null,
      height: null,
      uploadedBy: null,
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.assets.insert(asset);
    return asset;
  }

  async get(tenantId: string | null, assetId: string): Promise<Asset> {
    const asset = await this.assets.findById(assetId);
    if (!asset) throw AppException.notFound('Asset');
    // A public platform asset is readable by anyone; everything else is scoped.
    if (!asset.isPublic && asset.tenantId !== tenantId) throw AppException.notFound('Asset');
    return asset;
  }

  async list(tenantId: string, kind?: AssetKind): Promise<Asset[]> {
    return this.assets.find(kind ? { tenantId, kind } : { tenantId }, {
      sort: { createdAt: -1 },
      limit: 500,
    });
  }

  /** Reads bytes, with a small in-process LRU so bulk rendering reuses images. */
  async read(
    assetId: string,
    opts: { tenantId?: string | null } = {},
  ): Promise<{ asset: Asset; buffer: Buffer } | null> {
    const cached = this.cache.get(assetId);
    if (cached && Date.now() - cached.at < 60_000) {
      const asset = await this.assets.findById(assetId);
      if (asset) return { asset, buffer: cached.buffer };
    }
    const asset = await this.assets.findById(assetId);
    if (!asset) return null;
    if (!asset.isPublic && opts.tenantId !== undefined && asset.tenantId !== opts.tenantId) {
      this.logger.warn(
        `Refused cross-tenant asset read: asset ${assetId} belongs to ${asset.tenantId}, caller to ${opts.tenantId}`,
      );
      return null;
    }
    const buffer = await this.storage.get(asset.storageKey);
    if (!buffer) return null;
    if (this.cache.size > 200) this.cache.clear();
    this.cache.set(assetId, { buffer, at: Date.now() });
    return { asset, buffer };
  }

  async signedUrl(
    tenantId: string,
    assetId: string,
    ttlSeconds = 900,
    downloadName?: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const asset = await this.get(tenantId, assetId);
    const url = await this.storage.signedUrl(
      asset.storageKey,
      ttlSeconds,
      downloadName ?? asset.filename,
    );
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async remove(tenantId: string, assetId: string): Promise<{ ok: true }> {
    const asset = await this.get(tenantId, assetId);
    await this.storage.delete(asset.storageKey);
    await this.assets.deleteById(assetId);
    this.cache.delete(assetId);
    return { ok: true };
  }

  /** SHA-256 of the stored bytes, used for integrity comparisons. */
  async checksum(assetId: string): Promise<string | null> {
    const asset = await this.assets.findById(assetId);
    return asset?.sha256 ?? null;
  }

  verifyIntegrity(buffer: Buffer, expectedSha256: string): boolean {
    return this.crypto.safeEqual(this.crypto.sha256(buffer), expectedSha256);
  }
}

export function sanitiseFilename(name: string): string {
  const base = (name ?? 'file')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return base || 'file';
}

function extOf(filename: string, mimeType: string): string {
  const fromName = /\.[a-z0-9]{2,5}$/i.exec(filename)?.[0]?.toLowerCase();
  if (fromName) return fromName;
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'font/ttf': '.ttf',
    'application/x-font-ttf': '.ttf',
    'font/otf': '.otf',
    'application/font-sfnt': '.otf',
    'application/x-font-opentype': '.otf',
  };
  return map[mimeType] ?? '.bin';
}
