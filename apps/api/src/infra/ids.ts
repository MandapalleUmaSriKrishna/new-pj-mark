import { randomBytes, randomUUID } from 'node:crypto';

/** RFC 4122 v4 identifiers for every persisted document. */
export function newId(): string {
  return randomUUID();
}

const B32 = '0123456789abcdefghjkmnpqrstvwxyz'; // lowercase Crockford, no i l o u

/** Short, URL-safe, human-typable identifier (used for invite codes, slugs). */
export function shortId(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += B32[(bytes[i] as number) % 32];
  return out;
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function monthKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function dayKey(date: Date = new Date()): string {
  return `${monthKey(date)}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
