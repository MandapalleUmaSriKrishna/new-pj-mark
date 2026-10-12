import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ENV_CONFIG, type Env } from '../../config/config.tokens';

/**
 * Cryptographic primitives.
 *
 * - Field level encryption: AES-256-GCM with a random 96-bit IV per value. The
 *   output is `v1.<iv>.<tag>.<ciphertext>`, base64url, so the version can be
 *   rotated later without a schema change.
 * - Key hierarchy: a single master key (KEK) from the environment wraps a
 *   per-tenant data key (DEK). Rotating the master key therefore only requires
 *   re-wrapping 256-bit DEKs, not re-encrypting every certificate row.
 * - Passwords: Argon2id (memory hard) with a bcrypt-compatible cost profile.
 * - Integrity: HMAC-SHA256 for certificate signatures, webhook signatures and
 *   the tamper-evident audit chain.
 * - All comparisons of secrets are constant time.
 */

const ENC_VERSION = 'v1';
const IV_BYTES = 12;
const ALGO = 'aes-256-gcm';
const SCRYPT_N = 16384;

export interface WrappedKey {
  wrapped: string;
}

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private kek!: Buffer;

  constructor(@Inject(ENV_CONFIG) private readonly env: Env) {}

  onModuleInit(): void {
    this.kek = this.deriveKey(this.env.ENCRYPTION_MASTER_KEY, 'kdc-kek');
    if (this.env.NODE_ENV !== 'test') {
      this.logger.log(
        'Crypto service initialised (AES-256-GCM field encryption, Argon2id password hashing)',
      );
    }
  }

  /* ------------------------------- keys -------------------------------- */

  /** Deterministic 256-bit key derivation from a passphrase + context. */
  private deriveKey(secret: string, context: string): Buffer {
    return scryptSync(Buffer.from(secret, 'utf8'), Buffer.from(`kdc:${context}`, 'utf8'), 32, {
      N: SCRYPT_N,
      r: 8,
      p: 1,
      maxmem: 128 * SCRYPT_N * 8 * 2,
    });
  }

  /** Generates a fresh 256-bit tenant DEK and wraps it with the KEK. */
  wrapNewDek(): WrappedKey & { dek: Buffer } {
    const dek = randomBytes(32);
    return { wrapped: this.wrapDek(dek), dek };
  }

  wrapDek(dek: Buffer): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.kek, iv);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENC_VERSION, b64url(iv), b64url(tag), b64url(ct)].join('.');
  }

  unwrapDek(wrapped: string): Buffer {
    const [version, ivPart, tagPart, ctPart] = wrapped.split('.');
    if (version !== ENC_VERSION || !ivPart || !tagPart || !ctPart) {
      throw new Error('Malformed or unsupported wrapped key');
    }
    const decipher = createDecipheriv(ALGO, this.kek, fromB64url(ivPart));
    decipher.setAuthTag(fromB64url(tagPart));
    return Buffer.concat([decipher.update(fromB64url(ctPart)), decipher.final()]);
  }

  /* ------------------------- field encryption -------------------------- */

  /** Encrypts a string with the tenant DEK. Returns null for empty input. */
  encrypt(plaintext: string | null | undefined, dek: Buffer): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, dek, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    return [ENC_VERSION, b64url(iv), b64url(cipher.getAuthTag()), b64url(ct)].join('.');
  }

  decrypt(payload: string | null | undefined, dek: Buffer): string | null {
    if (!payload) return null;
    const [version, ivPart, tagPart, ctPart] = payload.split('.');
    if (version !== ENC_VERSION || !ivPart || !tagPart || !ctPart) {
      throw new Error('Malformed ciphertext');
    }
    try {
      const decipher = createDecipheriv(ALGO, dek, fromB64url(ivPart));
      decipher.setAuthTag(fromB64url(tagPart));
      return Buffer.concat([decipher.update(fromB64url(ctPart)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      // A wrong key or tampered value must not leak padding/oracle details.
      return null;
    }
  }

  /** Blind index: lets us look up an encrypted value without decrypting rows. */
  blindIndex(value: string, dek: Buffer): string {
    return createHmac('sha256', dek).update(`blind:${value.toLowerCase().trim()}`).digest('hex');
  }

  /* ------------------------------- hashing ------------------------------ */

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456, // 19 MiB - OWASP recommended baseline
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** True when a stored hash uses weaker parameters and should be rehashed on login. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    } catch {
      return true;
    }
  }

  sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  hmacSha256(secret: string | Buffer, payload: string | Buffer): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  hmacBase64(secret: string | Buffer, payload: string | Buffer): string {
    return createHmac('sha256', secret).update(payload).digest('base64');
  }

  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  /** HMAC-SHA256 over a canonical payload - the certificate integrity signature. */
  signIntegrity(dek: Buffer, parts: (string | number | null | undefined)[]): string {
    const payload = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
    return this.hmacSha256(dek, `kdc-cert-integrity:${payload}`);
  }

  /** Webhook signature header value: `t=<unix>,v1=<hex hmac>`. */
  signWebhookPayload(secret: string, timestamp: number, body: string): string {
    const signedPayload = `${timestamp}.${body}`;
    return `t=${timestamp},v1=${this.hmacSha256(secret, signedPayload)}`;
  }

  verifyWebhookSignature(
    secret: string,
    headerValue: string,
    body: string,
    toleranceSeconds = 300,
  ): boolean {
    const parts = Object.fromEntries(
      headerValue.split(',').map((p) => p.split('=').map((s) => s.trim()) as [string, string]),
    );
    const t = Number(parts.t);
    const v1 = parts.v1;
    if (!Number.isFinite(t) || !v1) return false;
    const age = Math.abs(Date.now() / 1000 - t);
    if (age > toleranceSeconds) return false;
    const expected = this.hmacSha256(secret, `${t}.${body}`);
    return this.safeEqual(expected, v1);
  }

  /** API keys are stored as SHA-256 hashes; the plaintext is shown only once. */
  hashApiKey(plainSecret: string): string {
    return createHash('sha256').update(plainSecret).digest('hex');
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
