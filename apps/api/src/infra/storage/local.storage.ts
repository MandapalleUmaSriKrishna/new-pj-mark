import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, rename, stat, unlink, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Logger } from '@nestjs/common';
import { isSafeKey, type StoragePort, type StoredObject } from './storage.port';

/**
 * Local filesystem storage adapter - the default, and the one that needs no
 * external service at all.
 *
 * Objects are written under `STORAGE_LOCAL_DIR` and ENCRYPTED AT REST with
 * AES-256-GCM using a key derived from `ENCRYPTION_MASTER_KEY`. A leaked
 * directory, a stray backup or a mis-mounted volume therefore does not hand
 * over certificate PDFs and branding assets in the clear. The object key is
 * bound in as additional authenticated data, so a ciphertext cannot be moved to
 * a different key and still decrypt.
 *
 * Container layout (all big-endian):
 *
 *   magic   5 bytes  "KDCS1"
 *   iv     12 bytes  random per object
 *   tag    16 bytes  GCM authentication tag
 *   mimeLen 2 bytes  length of the mime type
 *   mime    n bytes  stored so a read can report the original content type
 *   body    rest     ciphertext
 *
 * Writes go to a temporary file in the same directory and are then renamed, so
 * a crash mid-write leaves the previous object intact rather than a truncated
 * one. Reads that fail the magic or the auth tag resolve to `null` and log -
 * they never throw a partial buffer at a caller and never leak which of the two
 * checks failed.
 *
 * `signedUrl` points at this API's `GET /files/download`, which is why
 * `signsThroughApp` is true: the signature is an HMAC over `key\nexpires` and
 * the app is the only party that can verify it.
 *
 * LIMITATIONS, honestly: this driver stores bytes on one machine. It is right
 * for development and for a single-node deployment with a persistent volume;
 * behind more than one replica use STORAGE_DRIVER=s3, or every node will serve
 * a different subset of files.
 */

const MAGIC = Buffer.from('KDCS1', 'latin1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';
const SCRYPT_N = 16384;
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES + 2;

export class LocalStorage implements StoragePort {
  readonly driver = 'local' as const;
  readonly signsThroughApp = true;

  private readonly logger = new Logger('LocalStorage');
  private readonly root: string;
  private readonly apiUrl: string;
  private readonly apiPrefix: string;
  private readonly objectKey: Buffer;
  private readonly signingKey: Buffer;
  private ready: Promise<void> | null = null;

  /**
   * @param rootDir   directory that holds the objects (created on first write)
   * @param masterKey passphrase the object and URL-signing keys are derived from
   * @param apiUrl    public base URL of the API, used to build download links
   * @param apiPrefix route prefix; defaults to `API_PREFIX` so changing the
   *                  prefix does not break newly issued signed URLs
   */
  constructor(rootDir: string, masterKey: string, apiUrl: string, apiPrefix?: string) {
    // A missing secret must fail loudly here rather than encrypt with an empty
    // key; env.ts already defaults it, so this is defence in depth.
    if (!masterKey)
      throw new Error('LocalStorage requires a master key to encrypt objects at rest');
    this.root = resolve(rootDir);
    this.apiUrl = String(apiUrl || 'http://localhost:4000').replace(/\/+$/, '');
    this.apiPrefix = String(apiPrefix ?? process.env.API_PREFIX ?? 'api/v1').replace(
      /^\/+|\/+$/g,
      '',
    );
    this.objectKey = this.deriveKey(masterKey, 'kdc-storage-object');
    this.signingKey = this.deriveKey(masterKey, 'kdc-storage-url');
  }

  /** Deterministic 256-bit key derivation, matching CryptoService's scheme. */
  private deriveKey(secret: string, context: string): Buffer {
    return scryptSync(Buffer.from(secret, 'utf8'), Buffer.from(`kdc:${context}`, 'utf8'), 32, {
      N: SCRYPT_N,
      r: 8,
      p: 1,
      maxmem: 128 * SCRYPT_N * 8 * 2,
    });
  }

  /** Creates the storage root once, concurrently-safe. */
  private ensureRoot(): Promise<void> {
    this.ready ??= mkdir(this.root, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  /**
   * Maps a key to an absolute path and refuses anything that would escape the
   * storage root. Keys are generated internally, but this is the last gate
   * before the filesystem, so it does not trust that.
   */
  private pathFor(key: string): string {
    if (!isSafeKey(key)) {
      throw new Error(
        `Refusing to resolve an unsafe storage key: ${JSON.stringify(key).slice(0, 120)}`,
      );
    }
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Refusing to resolve a storage key outside the storage root');
    }
    return full;
  }

  private seal(key: string, plaintext: Buffer, mimeType: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.objectKey, iv);
    cipher.setAAD(Buffer.from(key, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const mime = Buffer.from(mimeType || 'application/octet-stream', 'utf8');
    const mimeLen = Buffer.alloc(2);
    mimeLen.writeUInt16BE(Math.min(mime.length, 0xffff), 0);
    return Buffer.concat([MAGIC, iv, tag, mimeLen, mime.subarray(0, 0xffff), body]);
  }

  /** Returns null when the container is not ours or the auth tag does not verify. */
  private open(key: string, sealed: Buffer): { plaintext: Buffer; mimeType: string } | null {
    if (sealed.length < HEADER_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC))
      return null;
    const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
    const tag = sealed.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
    const mimeLen = sealed.readUInt16BE(MAGIC.length + IV_BYTES + TAG_BYTES);
    const mimeStart = MAGIC.length + IV_BYTES + TAG_BYTES + 2;
    const mimeType = sealed.subarray(mimeStart, mimeStart + mimeLen).toString('utf8');
    const body = sealed.subarray(mimeStart + mimeLen);
    try {
      const decipher = createDecipheriv(ALGO, this.objectKey, iv);
      decipher.setAAD(Buffer.from(key, 'utf8'));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
      return { plaintext, mimeType: mimeType || 'application/octet-stream' };
    } catch {
      // Wrong key, tampered file, or an object written under a different key.
      return null;
    }
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await this.ensureRoot();
    await mkdir(dirname(path), { recursive: true });
    const sealed = this.seal(key, buffer, mimeType);
    // Same directory, so the rename is atomic on the same filesystem.
    const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, sealed, { mode: 0o600 });
    try {
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
    return {
      key,
      sizeBytes: buffer.byteLength,
      // Plain SHA-256 of the plaintext, so AssetsService.verifyIntegrity can
      // compare it against CryptoService.sha256 of a freshly rendered PDF.
      sha256: createHash('sha256').update(buffer).digest('hex'),
      mimeType,
      locator: path,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    let path: string;
    try {
      path = this.pathFor(key);
    } catch (err) {
      this.logger.warn((err as Error).message);
      return null;
    }
    let sealed: Buffer;
    try {
      sealed = await readFile(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not read ${key}: ${(err as Error).message}`);
      }
      return null;
    }
    const opened = this.open(key, sealed);
    if (!opened) {
      this.logger.warn(`Object ${key} failed its integrity check and was not returned`);
      return null;
    }
    return opened.plaintext;
  }

  async delete(key: string): Promise<void> {
    let path: string;
    try {
      path = this.pathFor(key);
    } catch (err) {
      this.logger.warn((err as Error).message);
      return;
    }
    try {
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  private sign(key: string, expires: string): string {
    return createHmac('sha256', this.signingKey).update(`${key}\n${expires}`).digest('base64url');
  }

  async signedUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string> {
    // Validate up front: a URL that cannot be verified must never be handed out.
    this.pathFor(key);
    const ttl = Math.max(1, Math.floor(Number(ttlSeconds) || 0));
    const expires = String(Date.now() + ttl * 1000);
    const params = new URLSearchParams({ key, expires, sig: this.sign(key, expires) });
    if (downloadName) params.set('filename', downloadName);
    return `${this.apiUrl}/${this.apiPrefix}/files/download?${params.toString()}`;
  }

  verifySignedUrl(key: string, expires: string, signature: string): boolean {
    if (!isSafeKey(key) || typeof signature !== 'string' || signature.length === 0) return false;
    const expiresMs = Number(expires);
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false;
    const expected = Buffer.from(this.sign(key, String(expiresMs)), 'utf8');
    const provided = Buffer.from(signature, 'utf8');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  /**
   * Writes, reads back and removes a probe object, so "up" means the whole
   * encrypt/write/decrypt path works - not merely that a directory exists.
   */
  async ping(): Promise<{ ok: boolean; detail?: string }> {
    const key = 'health/write-probe.txt';
    const payload = Buffer.from(`kdc local storage probe ${new Date().toISOString()}`, 'utf8');
    try {
      await this.ensureRoot();
      const stored = await this.put(key, payload, 'text/plain');
      const readBack = await this.get(key);
      await this.delete(key);
      if (!readBack || !readBack.equals(payload)) {
        return { ok: false, detail: `${this.root}: round-trip mismatch` };
      }
      return { ok: true, detail: `${this.root} (${stored.sizeBytes} byte round-trip)` };
    } catch (err) {
      return { ok: false, detail: `${this.root}: ${(err as Error).message}` };
    }
  }

  /** Absolute path an object lives at. Exposed for diagnostics and tests. */
  resolveKey(key: string): string {
    return join(this.root, key);
  }
}
