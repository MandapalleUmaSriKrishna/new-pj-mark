import type { AssetKind } from '@kdc/shared';

/**
 * Object storage port: rendered certificate PDFs, uploaded branding assets
 * (logos, seals, signatures, backgrounds, fonts) and import/export files.
 *
 * Two adapters implement it and the choice is made once, at boot, from
 * `STORAGE_DRIVER`:
 *
 *   local - encrypted files under STORAGE_LOCAL_DIR. Good for development, a
 *           single node, or a mounted persistent volume. Signed URLs point back
 *           at `GET /files/download`, so the API streams the bytes.
 *   s3    - S3 or an S3-compatible service (MinIO, Cloudflare R2, Backblaze B2).
 *           Signed URLs are presigned for DIRECT object access, which is why
 *           `signsThroughApp` is false and the proxy route refuses to serve.
 *
 * Nothing above this port knows which one is live, so switching drivers never
 * changes a controller, a service or the public API surface.
 *
 * Keys are ALWAYS produced by `tenantKey` / `publicAssetKey` and never built
 * from user input. They are tenant-namespaced and sanitised, which is what makes
 * it safe to expose a public signed-download route at all: there is no key an
 * attacker can guess that belongs to somebody else, and no key that escapes the
 * storage root.
 */

/** What a successful `put` reports back to the caller. */
export interface StoredObject {
  key: string;
  sizeBytes: number;
  /**
   * SHA-256 of the PLAINTEXT bytes. Computed before any at-rest encryption so
   * the value stays comparable across drivers and across a key rotation.
   */
  sha256: string;
  mimeType: string;
  /** Driver-specific locator (S3 ETag, local file path). Diagnostic only. */
  locator?: string | null;
}

export interface StoragePort {
  readonly driver: 'local' | 's3';

  /**
   * True when `signedUrl()` returns a URL served by THIS API
   * (`/files/download`), false when it presigns direct object-storage access.
   * The files controller uses it to fail closed: proxying an S3 deployment
   * would defeat the purpose of presigning and silently route every download
   * through the app tier.
   */
  readonly signsThroughApp: boolean;

  /** Writes (overwriting) and returns the stored object's metadata. */
  put(key: string, buffer: Buffer, mimeType: string): Promise<StoredObject>;

  /**
   * Reads plaintext bytes. Resolves to `null` - never throws - when the object
   * is missing, unreadable or fails its integrity check, so callers can decide
   * between a 404 and "send the email without the attachment".
   */
  get(key: string): Promise<Buffer | null>;

  /** Idempotent: deleting an absent object is not an error. */
  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /**
   * A time-limited URL for one object. `downloadName` sets the suggested
   * filename when the driver can influence Content-Disposition.
   */
  signedUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string>;

  /**
   * Verifies a signature produced by `signedUrl` for drivers that serve bytes
   * themselves. Drivers that presign directly always return false.
   */
  verifySignedUrl(key: string, expires: string, signature: string): boolean;

  /** Genuine reachability probe, reported by `GET /health`. */
  ping(): Promise<{ ok: boolean; detail?: string }>;
}

export const STORAGE_PORT = Symbol('KDC_STORAGE_PORT');

/** Longest key we are willing to store or resolve. */
const MAX_KEY_LENGTH = 512;

/**
 * Reduces one path component to a conservative, filesystem- and URL-safe token.
 *
 * Everything outside `[A-Za-z0-9._-]` becomes `_`, leading dots are stripped (so
 * no component can ever be `.` or `..`), and the result is length-capped. This
 * runs on values that originate from user uploads - filenames especially - so it
 * is the first line of defence against traversal, not the last.
 */
function safeComponent(value: string, maxLength = 128): string {
  const cleaned = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    // Collapse dot runs so no component can ever contain "..": a generated key
    // must always satisfy isSafeKey, and "../../x" must not survive as ".._.._x".
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, maxLength);
  return cleaned || '_';
}

/**
 * Tenant-private object key: `tenants/<tenantId>/<kind>/<filename>`.
 *
 * The tenant id is the first path segment after the namespace, so a bucket or
 * directory listing is grouped by tenant and a lifecycle/backup rule can be
 * scoped per tenant.
 */
export function tenantKey(tenantId: string, kind: AssetKind, filename: string): string {
  return `tenants/${safeComponent(tenantId)}/${safeComponent(kind, 32)}/${safeComponent(filename)}`;
}

/**
 * Public (unauthenticated-read) object key: `public/<scope>/<kind>/<filename>`.
 *
 * `scope` is the owning tenant, or `platform` for assets that belong to the
 * installation itself (default templates, sample backgrounds). Kept in a
 * separate namespace so "public" is a property of the key prefix, not a flag
 * somebody has to remember to check.
 */
export function publicAssetKey(scope: string, kind: AssetKind, filename: string): string {
  return `public/${safeComponent(scope)}/${safeComponent(kind, 32)}/${safeComponent(filename)}`;
}

/**
 * Structural check for a key that arrived from outside the process (a signed
 * download URL). Adapters MUST call this before touching the filesystem or an
 * object store, because a valid signature only proves the URL was not altered -
 * not that the key inside it is sane.
 */
export function isSafeKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  if (key.includes('..')) return false;
  if (key.startsWith('/') || key.startsWith('\\')) return false;
  if (key.includes('\\')) return false;
  if (key.includes('//')) return false;
  // Reject control characters, NUL and anything non-ASCII: keys are generated
  // from safeComponent, so a real key never contains them.
  if (/[^\x20-\x7e]/.test(key)) return false;
  return key.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}
