import { CryptoService } from './crypto.service';
import type { Env } from '../../config/config.tokens';

/**
 * The crypto service is the security core of the platform, so its guarantees
 * are pinned here: round-trip integrity, ciphertext non-determinism (random IV
 * per value), deterministic blind indexes for lookup, and webhook signatures
 * with the documented tolerance.
 */

function makeService(): CryptoService {
  const service = new CryptoService({
    ENCRYPTION_MASTER_KEY: 'unit-test-master-key-not-for-production',
    NODE_ENV: 'test',
  } as Env);
  service.onModuleInit();
  return service;
}

describe('CryptoService', () => {
  const service = makeService();

  it('wraps and unwraps a DEK losslessly', () => {
    const { dek, wrapped } = service.wrapNewDek();
    expect(dek).toHaveLength(32);
    expect(service.unwrapDek(wrapped).equals(dek)).toBe(true);
  });

  it('produces a different wrapped blob for the same DEK (random nonce)', () => {
    const { dek } = service.wrapNewDek();
    expect(service.wrapDek(dek)).not.toEqual(service.wrapDek(dek));
  });

  it('encrypts and decrypts a field value', () => {
    const { dek } = service.wrapNewDek();
    const plaintext = 'jane.public@example.edu';
    const sealed = service.encrypt(plaintext, dek);
    expect(sealed).not.toBeNull();
    expect(sealed).not.toContain(plaintext);
    expect(service.decrypt(sealed, dek)).toBe(plaintext);
  });

  it('never produces identical ciphertext for identical plaintext', () => {
    const { dek } = service.wrapNewDek();
    expect(service.encrypt('same-value', dek)).not.toEqual(service.encrypt('same-value', dek));
  });

  it('treats null as null rather than encrypting the string "null"', () => {
    const { dek } = service.wrapNewDek();
    expect(service.encrypt(null, dek)).toBeNull();
    expect(service.decrypt(null, dek)).toBeNull();
  });

  it('blind indexes are deterministic and value-specific', () => {
    const { dek } = service.wrapNewDek();
    expect(service.blindIndex('JANE@Example.edu', dek)).toBe(
      service.blindIndex('jane@example.edu', dek),
    );
    expect(service.blindIndex('jane@example.edu', dek)).not.toBe(
      service.blindIndex('other@example.edu', dek),
    );
  });

  it('returns null (never garbage) when decrypting with the wrong key', () => {
    const first = service.wrapNewDek();
    const second = service.wrapNewDek();
    const sealed = service.encrypt('secret', first.dek);
    expect(sealed).not.toBeNull();
    const ciphertext = sealed as string;
    expect(service.decrypt(ciphertext, second.dek)).toBeNull();
    // Tampering with the ciphertext must fail the GCM auth tag the same way.
    const tampered = `${ciphertext.slice(0, -4)}AAAA`;
    expect(service.decrypt(tampered, first.dek)).toBeNull();
    // A malformed envelope is a hard error, not a silent null.
    expect(() => service.decrypt('not-a-ciphertext', first.dek)).toThrow('Malformed ciphertext');
  });

  it('hashes and verifies passwords with argon2id', async () => {
    const hash = await service.hashPassword('Correct-Horse-9!battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verifyPassword(hash, 'Correct-Horse-9!battery')).resolves.toBe(true);
    await expect(service.verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
    expect(service.needsRehash(hash)).toBe(false);
  });

  it('compares secrets in constant time without leaking equality of length', () => {
    expect(service.safeEqual('abc', 'abc')).toBe(true);
    expect(service.safeEqual('abc', 'abd')).toBe(false);
    expect(service.safeEqual('abc', 'abcd')).toBe(false);
  });

  it('signs webhook payloads in the documented header format', () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ event: 'certificate.issued' });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = service.signWebhookPayload(secret, timestamp, body);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(service.verifyWebhookSignature(secret, header, body)).toBe(true);
  });

  it('rejects webhook signatures outside the tolerance window', () => {
    const secret = 'whsec_test';
    const stale = Math.floor(Date.now() / 1000) - 600;
    const header = service.signWebhookPayload(secret, stale, 'body');
    expect(service.verifyWebhookSignature(secret, header, 'body')).toBe(false);
  });

  it('rejects webhook signatures over a tampered body', () => {
    const secret = 'whsec_test';
    const header = service.signWebhookPayload(secret, Math.floor(Date.now() / 1000), 'body');
    expect(service.verifyWebhookSignature(secret, header, 'body2')).toBe(false);
  });

  it('computs certificate integrity signatures over the documented tuple', () => {
    const { dek } = service.wrapNewDek();
    const parts = [
      't1',
      'e1',
      'KDC-2026-AAAAAAAA-0',
      'A Name',
      'a@b.c',
      '2026-01-01T00:00:00.000Z',
    ];
    const signature = service.signIntegrity(dek, parts);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(service.signIntegrity(dek, parts)).toBe(signature);
    expect(service.signIntegrity(dek, [...parts, 'x'])).not.toBe(signature);
  });

  it('hashes API keys so plaintext never survives', () => {
    const hash = service.hashApiKey('kdc_abcdef');
    expect(hash).not.toContain('kdc_abcdef');
    expect(service.hashApiKey('kdc_abcdef')).toBe(hash);
  });

  it('generates unguessable tokens of the requested strength', () => {
    const token = service.randomToken(32);
    expect(token).toHaveLength(43); // base64url of 32 bytes
    expect(service.randomToken(32)).not.toEqual(token);
  });
});
