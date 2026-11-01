/**
 * In-memory session + abuse-tracking store with TTL eviction.
 *
 * Design notes
 * ------------
 *  - The browser only ever holds an opaque, signed session id. Phone numbers,
 *    pending verification SIDs and verified state live server-side, so a client
 *    can never flip its own `verified` flag.
 *  - This default store is per-process and ephemeral (state is lost on restart
 *    and is not shared between instances). That is deliberate: OTP Shield ships
 *    with zero infrastructure dependencies. For multi-instance deployments,
 *    implement the same small interface over Redis/Postgres — see README
 *    "Scaling" for the exact contract.
 *  - `sweep()` runs on an interval so memory cannot grow unbounded.
 */
import { randomBytes } from 'node:crypto';

/**
 * @typedef {Object} VerificationState
 * @property {string} sid Twilio Verification SID
 * @property {'pending'|'approved'|'expired'|'canceled'|'max_attempts_reached'} status
 * @property {number} sentAt epoch ms
 * @property {number} expiresAt epoch ms
 * @property {number} resendAvailableAt epoch ms
 * @property {number} attempts number of wrong codes checked
 * @property {number} maxAttempts
 * @property {number} sendCount sends for this verification session
 *
 * @typedef {Object} Session
 * @property {string} id
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} phone E.164
 * @property {string} phoneMasked
 * @property {string} country ISO code
 * @property {VerificationState|null} verification
 * @property {boolean} verified
 * @property {number|null} verifiedAt
 * @property {string} method
 * @property {string} provider
 *
 * @typedef {Object} AbuseRecord
 * @property {number[]} sendTimestamps
 * @property {number} lastSendAt epoch ms of the most recent send for this number
 * @property {number} consecutiveFailures
 * @property {number} lockedUntil
 */

export class MemorySessionStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
    /** @type {Map<string, AbuseRecord>} */
    this.abuse = new Map();
    this.ttlMs = ttlMs;
    this.now = now;
    this.sweepTimer = null;
    this.sweepIntervalMs = Math.min(Math.max(Math.floor(ttlMs / 4), 60_000), 15 * 60_000);
  }

  /** Start periodic eviction; unref'd so it never keeps the process alive. */
  startSweeper() {
    if (this.sweepTimer) return this;
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.sweepTimer.unref?.();
    return this;
  }

  stopSweeper() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  createSession(partial = {}) {
    const timestamp = this.now();
    const session = {
      id: randomBytes(32).toString('base64url'),
      createdAt: timestamp,
      updatedAt: timestamp,
      phone: '',
      phoneMasked: '',
      country: '',
      verification: null,
      verified: false,
      verifiedAt: null,
      method: 'sms',
      provider: 'twilio-verify',
      ...partial,
      id: partial.id ?? randomBytes(32).toString('base64url'),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** @returns {Session|undefined} */
  getSession(id) {
    if (typeof id !== 'string' || id.length < 16) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (this.isSessionExpired(session)) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  isSessionExpired(session) {
    const ttl = session.verified ? this.ttlMs : Math.min(this.ttlMs, 15 * 60 * 1000);
    return this.now() - session.updatedAt > ttl;
  }

  updateSession(id, patch) {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    Object.assign(session, patch, { updatedAt: this.now() });
    return session;
  }

  deleteSession(id) {
    return this.sessions.delete(id);
  }

  /** @returns {AbuseRecord} */
  getAbuseRecord(key) {
    let record = this.abuse.get(key);
    if (!record) {
      record = { sendTimestamps: [], lastSendAt: 0, consecutiveFailures: 0, lockedUntil: 0 };
      this.abuse.set(key, record);
    }
    return record;
  }

  /** Retain only sends inside the rolling window. */
  pruneSendTimestamps(record, windowMs) {
    const cutoff = this.now() - windowMs;
    record.sendTimestamps = record.sendTimestamps.filter((ts) => ts > cutoff);
    if (record.lockedUntil && record.lockedUntil < this.now()) record.lockedUntil = 0;
    return record;
  }

  recordSend(key) {
    const record = this.getAbuseRecord(key);
    const timestamp = this.now();
    record.sendTimestamps.push(timestamp);
    record.lastSendAt = timestamp;
    return record;
  }

  sweep() {
    const timestamp = this.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (this.isSessionExpired(session)) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    const abuseTtl = 6 * 60 * 60 * 1000;
    for (const [key, record] of this.abuse) {
      const newest = Math.max(record.sendTimestamps.at(-1) ?? 0, record.lastSendAt ?? 0);
      if (timestamp - newest > abuseTtl && record.lockedUntil < timestamp) {
        this.abuse.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  stats() {
    return {
      sessions: this.sessions.size,
      abuseRecords: this.abuse.size,
      verifiedSessions: [...this.sessions.values()].filter((s) => s.verified).length,
    };
  }
}

/**
 * Serialise work per key inside one process. Prevents two parallel "send" calls
 * for the same number from both slipping past the resend cooldown.
 */
export function createKeyedLock() {
  /** @type {Map<string, Promise<unknown>>} */
  const chains = new Map();
  return function withLock(key, task) {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    chains.set(
      key,
      next.catch(() => {}).finally(() => {
        if (chains.get(key) === next) chains.delete(key);
      }),
    );
    return next;
  };
}
