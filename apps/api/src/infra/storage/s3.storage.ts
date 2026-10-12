import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isSafeKey, type StoragePort, type StoredObject } from './storage.port';

/**
 * S3 (and S3-compatible) storage adapter: MinIO, Cloudflare R2, Backblaze B2,
 * Wasabi - anything that speaks the S3 API.
 *
 * Selected with `STORAGE_DRIVER=s3`; `S3_BUCKET` and `S3_REGION` are then
 * required and boot fails with a clear message if they are missing. This is the
 * driver to use behind more than one replica, because the local driver stores
 * bytes on whichever node wrote them.
 *
 * Credentials are optional ON PURPOSE. When `S3_ACCESS_KEY_ID` and
 * `S3_SECRET_ACCESS_KEY` are both set they are used; when they are not, the
 * client falls back to the AWS SDK's ambient credential chain (IAM role on EC2,
 * IRSA on EKS, task role on ECS, `~/.aws/credentials`, environment). On AWS that
 * is the recommended setup - long-lived keys in env vars are the thing to avoid.
 *
 * Signed URLs are PRESIGNED FOR DIRECT OBJECT ACCESS, so `signsThroughApp` is
 * false and `GET /files/download` answers 503 `storage_not_configured` instead
 * of proxying. Downloads go from the client straight to the bucket: that is the
 * point of presigning, and it keeps large PDFs off the app tier.
 *
 * Objects are NOT additionally encrypted here: at-rest encryption is the bucket's
 * job (SSE-S3 by default on AWS, SSE-KMS or SSE-C when you need key control).
 * Enable default encryption on the bucket and block public ACLs - a presigned
 * URL is an authorisation decision, not a substitute for a private bucket.
 */

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Custom endpoint for S3-compatible services. Leave unset for AWS. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Required by most non-AWS services, which address buckets by path. */
  forcePathStyle?: boolean;
}

export class S3Storage implements StoragePort {
  readonly driver = 's3' as const;
  readonly signsThroughApp = false;

  private readonly logger = new Logger('S3Storage');
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(options: S3StorageOptions) {
    if (!options.bucket) throw new Error('S3Storage requires a bucket');
    if (!options.region) throw new Error('S3Storage requires a region');
    this.bucket = options.bucket;
    this.region = options.region;

    const hasStaticCredentials = Boolean(options.accessKeyId && options.secretAccessKey);
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: Boolean(options.forcePathStyle),
      ...(hasStaticCredentials
        ? {
            credentials: {
              accessKeyId: options.accessKeyId!,
              secretAccessKey: options.secretAccessKey!,
            },
          }
        : {}),
    });
    this.logger.log(
      `S3 storage ready (bucket=${this.bucket} region=${this.region} ` +
        `endpoint=${options.endpoint ?? 'aws-default'} credentials=${hasStaticCredentials ? 'static' : 'ambient-chain'})`,
    );
  }

  /** Guards a key before it reaches the object store. */
  private assertKey(key: string): void {
    if (!isSafeKey(key)) {
      throw new Error(
        `Refusing to use an unsafe storage key: ${JSON.stringify(key).slice(0, 120)}`,
      );
    }
  }

  /** True for the "it isn't there" family of S3 errors, which are not failures. */
  private isMissing(err: unknown): boolean {
    if (err instanceof NoSuchKey || err instanceof NotFound) return true;
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    return status === 404;
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<StoredObject> {
    this.assertKey(key);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // A fresh view avoids any chance of writing the whole pooled ArrayBuffer.
        Body: new Uint8Array(buffer),
        ContentType: mimeType || 'application/octet-stream',
        // Belt and braces on top of the bucket's own public-access block.
        ACL: 'private',
      }),
    );
    return {
      key,
      sizeBytes: buffer.byteLength,
      // Hash of the plaintext, comparable across drivers and rotations.
      sha256: createHash('sha256').update(buffer).digest('hex'),
      mimeType,
      locator: result.ETag
        ? `s3://${this.bucket}/${key}#${result.ETag}`
        : `s3://${this.bucket}/${key}`,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    this.assertKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      const bytes = await result.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      if (this.isMissing(err)) return null;
      // A permission or network failure is NOT a missing object: surface it, so
      // the caller returns a 500 and monitoring sees the real cause instead of a
      // misleading 404.
      this.logger.error(`S3 read failed for ${key}: ${(err as Error).message}`);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    try {
      // S3 DELETE is already idempotent; the catch is only for transport errors.
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (this.isMissing(err)) return;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    this.assertKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (this.isMissing(err)) return false;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (status === 403) {
        // Cannot distinguish "absent" from "not allowed to look"; report absent
        // and say why rather than guessing.
        this.logger.warn(`S3 HEAD denied for ${key}; treating as absent`);
        return false;
      }
      throw err;
    }
  }

  async signedUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string> {
    this.assertKey(key);
    const ttl = Math.max(1, Math.min(Math.floor(Number(ttlSeconds) || 0), 7 * 24 * 3600));
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(downloadName ? { ResponseContentDisposition: contentDisposition(downloadName) } : {}),
      }),
      { expiresIn: ttl },
    );
  }

  /**
   * Always false: this driver never signs through the app, so there is no
   * app-side signature to verify. The files controller checks `signsThroughApp`
   * first and answers 503, which is why this can stay a constant.
   */
  verifySignedUrl(): boolean {
    return false;
  }

  /**
   * HeadBucket is the cheapest honest reachability probe: it exercises DNS, TLS,
   * credentials and bucket existence in one call. A 403 means the bucket is
   * there and reachable but the policy does not grant `s3:ListBucket`, which is a
   * common and perfectly workable setup - so that reports UP with the reason
   * attached instead of falsely alarming an operator.
   */
  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, detail: `s3://${this.bucket} (${this.region})` };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (status === 403) {
        return { ok: true, detail: `s3://${this.bucket}: reachable, HeadBucket denied by policy` };
      }
      if (status === 404 || err instanceof NotFound) {
        return { ok: false, detail: `s3://${this.bucket}: bucket not found in ${this.region}` };
      }
      return { ok: false, detail: `s3://${this.bucket}: ${(err as Error).message}` };
    }
  }
}

/**
 * Builds a Content-Disposition value that cannot break out of its header.
 *
 * Quotes, backslashes and CR/LF are removed (a filename containing `"` or a
 * newline would otherwise let a caller inject headers), and anything non-ASCII
 * is additionally supplied as RFC 5987 `filename*` so accented and non-Latin
 * names still arrive intact in modern browsers.
 */
export function contentDisposition(filename: string): string {
  const ascii = String(filename ?? 'download')
    .replace(/["\\\r\n]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .slice(0, 180)
    .trim();
  const base = `attachment; filename="${ascii || 'download'}"`;
  const needsStar = String(filename ?? '') !== ascii;
  return needsStar
    ? `${base}; filename*=UTF-8''${encodeURIComponent(String(filename)).slice(0, 240)}`
    : base;
}
