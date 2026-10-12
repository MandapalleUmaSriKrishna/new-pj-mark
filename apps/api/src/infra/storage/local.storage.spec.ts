import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from './local.storage';
import { isSafeKey, publicAssetKey, tenantKey } from './storage.port';

/**
 * The local storage adapter holds every rendered certificate PDF and every
 * uploaded branding asset, so its guarantees are pinned here rather than left to
 * manual checking:
 *
 *   - lossless round-trip, and a SHA-256 of the PLAINTEXT that callers can
 *     compare against a freshly rendered document;
 *   - encryption at rest: the plaintext never appears in the file, the same
 *     bytes never produce the same container (random IV), and the object key is
 *     bound in as AAD so a file cannot be moved to another key and still open;
 *   - failures resolve to `null` instead of throwing or returning partial bytes;
 *   - signed URLs are verifiable, expire, and cannot be rewritten to a
 *     different key;
 *   - keys that would escape the storage root are refused outright.
 */

const MASTER_KEY = 'unit-test-master-key-not-for-production';
const API_URL = 'https://api.example.test';

describe('LocalStorage', () => {
  const root = mkdtempSync(join(tmpdir(), 'kdc-storage-'));
  const storage = new LocalStorage(root, MASTER_KEY, API_URL, 'api/v1');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports itself as the local driver that signs through the app', () => {
    expect(storage.driver).toBe('local');
    expect(storage.signsThroughApp).toBe(true);
  });

  it('refuses to be constructed without a master key', () => {
    expect(() => new LocalStorage(root, '', API_URL)).toThrow(/master key/);
  });

  it('round-trips bytes losslessly and reports the plaintext checksum', async () => {
    const key = tenantKey('tenant-1', 'certificate_pdf', 'cert.pdf');
    const payload = randomBytes(4096);
    const stored = await storage.put(key, payload, 'application/pdf');

    expect(stored.sizeBytes).toBe(payload.byteLength);
    expect(stored.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
    expect(stored.mimeType).toBe('application/pdf');
    expect(await storage.get(key)).toEqual(payload);
    expect(await storage.exists(key)).toBe(true);
  });

  it('never writes the plaintext to disk', async () => {
    const key = tenantKey('tenant-1', 'logo', 'secret-logo.png');
    const marker = `KDC-PLAINTEXT-MARKER-${randomBytes(8).toString('hex')}`;
    await storage.put(key, Buffer.from(marker, 'utf8'), 'image/png');

    const sealed = readFileSync(storage.resolveKey(key));
    expect(sealed.subarray(0, 5).toString('latin1')).toBe('KDCS1');
    expect(sealed.includes(Buffer.from(marker, 'utf8'))).toBe(false);
  });

  it('produces a different container for identical bytes (random IV)', async () => {
    const payload = Buffer.from('identical-content', 'utf8');
    const a = tenantKey('tenant-1', 'seal', 'a.bin');
    const b = tenantKey('tenant-1', 'seal', 'b.bin');
    await storage.put(a, payload, 'application/octet-stream');
    await storage.put(b, payload, 'application/octet-stream');

    expect(readFileSync(storage.resolveKey(a)).equals(readFileSync(storage.resolveKey(b)))).toBe(
      false,
    );
    expect(await storage.get(a)).toEqual(payload);
    expect(await storage.get(b)).toEqual(payload);
  });

  it('binds the object key in as AAD, so a file cannot be moved to another key', async () => {
    const source = tenantKey('tenant-1', 'signature', 'original.bin');
    const target = tenantKey('tenant-2', 'signature', 'stolen.bin');
    const payload = Buffer.from('tenant-1 private bytes', 'utf8');
    await storage.put(source, payload, 'application/octet-stream');
    // Write the target first so its directory exists, then overwrite it with a
    // byte-for-byte copy of the source container.
    await storage.put(target, Buffer.from('decoy'), 'application/octet-stream');
    copyFileSync(storage.resolveKey(source), storage.resolveKey(target));

    // The copy is byte-identical but was sealed for a different key.
    expect(
      readFileSync(storage.resolveKey(target)).equals(readFileSync(storage.resolveKey(source))),
    ).toBe(true);
    expect(await storage.get(target)).toBeNull();
    expect(await storage.get(source)).toEqual(payload);
  });

  it('returns null for a tampered container instead of partial bytes', async () => {
    const key = tenantKey('tenant-1', 'background', 'tampered.bin');
    await storage.put(key, Buffer.from('authentic content', 'utf8'), 'image/png');

    const path = storage.resolveKey(key);
    const sealed = readFileSync(path);
    sealed[sealed.byteLength - 1] ^= 0xff; // flip a ciphertext bit
    writeFileSync(path, sealed);

    expect(await storage.get(key)).toBeNull();
  });

  it('treats a missing object as null rather than an error', async () => {
    expect(await storage.get(tenantKey('tenant-1', 'logo', 'never-written.png'))).toBeNull();
    expect(await storage.exists(tenantKey('tenant-1', 'logo', 'never-written.png'))).toBe(false);
    await expect(
      storage.delete(tenantKey('tenant-1', 'logo', 'never-written.png')),
    ).resolves.toBeUndefined();
  });

  it('issues a signed URL the app can verify, and rejects a rewritten key', async () => {
    const key = tenantKey('tenant-1', 'certificate_pdf', 'signed.pdf');
    await storage.put(key, Buffer.from('%PDF-1.4 signed', 'utf8'), 'application/pdf');

    const url = new URL(await storage.signedUrl(key, 300, 'My Certificate.pdf'));
    expect(url.origin).toBe(API_URL);
    expect(url.pathname).toBe('/api/v1/files/download');
    expect(url.searchParams.get('key')).toBe(key);
    expect(url.searchParams.get('filename')).toBe('My Certificate.pdf');

    const expires = url.searchParams.get('expires')!;
    const sig = url.searchParams.get('sig')!;
    expect(storage.verifySignedUrl(key, expires, sig)).toBe(true);
    expect(
      storage.verifySignedUrl(tenantKey('tenant-2', 'certificate_pdf', 'other.pdf'), expires, sig),
    ).toBe(false);
    expect(storage.verifySignedUrl(key, String(Date.now() - 1000), sig)).toBe(false);
    expect(storage.verifySignedUrl(key, expires, `${sig}x`)).toBe(false);
    expect(storage.verifySignedUrl(key, 'not-a-number', sig)).toBe(false);
    expect(storage.verifySignedUrl('../escape', expires, sig)).toBe(false);
  });

  it('builds the signed URL from API_PREFIX so a custom prefix still works', async () => {
    const custom = new LocalStorage(root, MASTER_KEY, `${API_URL}/`, 'v9/custom');
    const url = new URL(await custom.signedUrl(tenantKey('tenant-1', 'logo', 'x.png'), 60));
    expect(url.pathname).toBe('/v9/custom/files/download');
  });

  it('refuses keys that would escape the storage root', async () => {
    const evil = [
      '../../etc/passwd',
      '/etc/passwd',
      'tenants/../../secret',
      'a\\..\\b',
      'tenants//x',
    ];
    for (const key of evil) {
      expect(isSafeKey(key)).toBe(false);
      await expect(storage.put(key, Buffer.from('nope'), 'text/plain')).rejects.toThrow(
        /unsafe storage key|outside the storage root/,
      );
      expect(await storage.get(key)).toBeNull();
    }
    // The files above must never have been created anywhere near the root.
    expect(isSafeKey(tenantKey('tenant-1', 'logo', 'fine.png'))).toBe(true);
  });

  it('proves it can write, read back and delete in ping()', async () => {
    const result = await storage.ping();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain(root);
  });

  it('reports an unusable root as down rather than claiming health', async () => {
    // Put a regular file where the storage root directory has to be.
    const blocker = join(root, 'not-a-directory');
    writeFileSync(blocker, 'a file where a directory must be');
    const broken = new LocalStorage(blocker, MASTER_KEY, API_URL);
    const result = await broken.ping();
    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
  });
});

describe('storage key helpers', () => {
  it('namespaces tenant keys by tenant, then kind', () => {
    expect(tenantKey('t-123', 'certificate_pdf', 'a.pdf')).toBe(
      'tenants/t-123/certificate_pdf/a.pdf',
    );
  });

  it('keeps public assets in a separate namespace', () => {
    expect(publicAssetKey('platform', 'background', 'bg.png')).toBe(
      'public/platform/background/bg.png',
    );
  });

  it('sanitises hostile components instead of trusting them', () => {
    expect(tenantKey('../../root', 'logo', '..%2f..%2fetc/passwd')).not.toContain('..');
    expect(tenantKey('a/b', 'logo', 'x')).toBe('tenants/a_b/logo/x');
    expect(publicAssetKey('...', 'logo', '.hidden')).not.toMatch(/(^|\/)\.\.(\/|$)/);
    expect(isSafeKey(tenantKey('../../root', 'logo', '..%2f..%2fetc/passwd'))).toBe(true);
  });

  it('rejects structurally invalid keys', () => {
    expect(isSafeKey('')).toBe(false);
    expect(isSafeKey('a/'.padEnd(600, 'x'))).toBe(false);
    expect(isSafeKey('tenants/a/logo/lead.png')).toBe(true);
    expect(isSafeKey('tenants/./logo/x.png')).toBe(false);
    expect(isSafeKey(null)).toBe(false);
    expect(isSafeKey(42)).toBe(false);
  });
});
