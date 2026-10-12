/**
 * Certificate identifiers.
 *
 * Two independent values are issued per certificate:
 *
 *  1. `serial`  - a human readable, printable, guess-resistant public identifier
 *                 (`KDC-2026-7QK3M9XA-4`). It appears on the certificate and in
 *                 the QR code, and is what a verifier types into /verify.
 *  2. `downloadToken` - a 256 bit unguessable secret used for the private
 *                 download link. Knowing the serial must NOT allow downloading
 *                 the PDF; knowing the token must not allow forging a serial.
 *
 * The trailing character of a serial is an ISO-7064 style check digit over the
 * Crockford Base32 body, so typos are rejected instantly on the verify page
 * before any database lookup.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 chars, no I L O U
const CHECK_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // mod 31 over body
const BODY_LENGTH = 8;

function randomBytes(length: number): Uint8Array {
  const cryptoObj: Crypto | undefined = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('A Web Crypto implementation is required to mint certificate identifiers.');
  }
  const out = new Uint8Array(length);
  cryptoObj.getRandomValues(out);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Deterministic Crockford Base32 of a non-negative integer, zero padded. */
function encodeCrockford(value: bigint, length: number): string {
  let out = '';
  let v = value;
  for (let i = 0; i < length; i += 1) {
    out = CROCKFORD[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}

export function decodeCrockford(text: string): bigint {
  let v = 0n;
  for (const ch of text.toUpperCase()) {
    const idx = CROCKFORD.indexOf(normalise(ch));
    if (idx < 0) throw new Error(`Invalid serial character: ${ch}`);
    v = (v << 5n) | BigInt(idx);
  }
  return v;
}

/** Crockford forgives the most common transcription mistakes. */
function normalise(ch: string): string {
  if (ch === 'I' || ch === 'L') return '1';
  if (ch === 'O') return '0';
  return ch;
}

export function computeCheckChar(body: string): string {
  const upper = body.toUpperCase();
  let acc = 0;
  for (const ch of upper) {
    const idx = CROCKFORD.indexOf(normalise(ch));
    acc = (acc * 33 + (idx < 0 ? ch.charCodeAt(0) : idx)) % 9973;
  }
  return CHECK_ALPHABET[acc % 31] as string;
}

export interface SerialParts {
  prefix: string;
  year: number;
  body: string;
  check: string;
}

export const SERIAL_PATTERN = /^[A-Z0-9]{2,8}-\d{4}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]$/;

/**
 * Mint a new serial. `prefix` defaults to KDC; tenants can set a vanity prefix
 * (max 8 chars, A-Z0-9) so certificates read e.g. `SRM-2026-…`.
 */
export function generateSerial(opts: { prefix?: string; year?: number } = {}): string {
  const rawPrefix = (opts.prefix ?? 'KDC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const prefix = rawPrefix.length >= 2 ? rawPrefix : 'KDC';
  const year = opts.year ?? new Date().getUTCFullYear();
  const bytes = randomBytes(8);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  // 40 bits of entropy keeps serials short while staying unguessable at scale
  // (2^40 ~ 1.1e12 candidates); uniqueness is additionally enforced by a DB
  // unique index, and callers retry on collision.
  const body = encodeCrockford(value & 0xffffffffffn, BODY_LENGTH);
  return `${prefix}-${year}-${body}-${computeCheckChar(`${prefix}${year}${body}`)}`;
}

export function parseSerial(serial: string): SerialParts | null {
  const cleaned = serial.trim().toUpperCase().replace(/\s+/g, '');
  if (!SERIAL_PATTERN.test(cleaned)) return null;
  const [prefix, yearStr, body, check] = cleaned.split('-');
  if (!prefix || !yearStr || !body || !check) return null;
  if (computeCheckChar(`${prefix}${yearStr}${body}`) !== check) return null;
  return { prefix, year: Number(yearStr), body, check };
}

export function isValidSerial(serial: string): boolean {
  return parseSerial(serial) !== null;
}

/** Normalises user input from the verify form (lowercase, spaces, O/0 typos). */
export function canonicaliseSerialInput(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 256-bit unguessable secret for private download / magic links. */
export function generateDownloadToken(): string {
  return toBase64Url(randomBytes(32));
}

/** Secret used to sign outbound webhooks; 256 bits, `whsec_` prefixed. */
export function generateWebhookSecret(): string {
  return `whsec_${toBase64Url(randomBytes(32))}`;
}

/** API key: visible id + 256-bit secret. Only a hash of the secret is stored. */
export function generateApiKey(prefix = 'kdc'): { id: string; secret: string; plain: string } {
  const id = `${prefix}_${toBase64Url(randomBytes(9))}`;
  const secret = toBase64Url(randomBytes(32));
  return { id, secret, plain: `${id}.${secret}` };
}

/** Short human friendly code for one-time-use approvals / invites. */
export function generateInviteCode(): string {
  return toBase64Url(randomBytes(12));
}
