/**
 * Verification orchestration — the security-critical core.
 *
 * Invariants enforced here (and covered by the test-suite):
 *  1. A code is only sent after strict E.164 validation.
 *  2. Verification state lives server-side; the client cannot assert success.
 *  3. A successful check happens ONLY when Twilio Verify returns
 *     `status: "approved"` (a wrong code is answered with `pending`, and that is
 *     treated as a failed attempt — never as success).
 *  4. Resend cooldowns, per-number send caps and per-verification attempt caps
 *     are enforced before/after every provider call.
 *  5. Expired codes are rejected locally and cancelled at the provider.
 */

import { errors } from '../errors.js';
import { normalisePhoneNumber, maskPhoneNumber, formatPhoneForDisplay } from './phone.js';
import { ProviderError, ProviderErrorKind } from './verify-provider.js';
import { createKeyedLock } from './session-store.js';

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const secondsUntil = (target, now) => Math.max(0, Math.ceil((target - now) / 1000));

/** Map a provider failure onto a safe, actionable API error. */
function toApiError(providerError, { context }) {
  const kind = providerError?.kind ?? ProviderErrorKind.UNKNOWN;
  switch (kind) {
    case ProviderErrorKind.NOT_CONFIGURED:
      return errors.providerNotConfigured();
    case ProviderErrorKind.INVALID_NUMBER:
      return errors.invalidPhone(
        'The SMS provider rejected this number. Double-check it and try again.',
      );
    case ProviderErrorKind.UNSUPPORTED_NUMBER:
      return errors.unsupportedNumber();
    case ProviderErrorKind.MAX_ATTEMPTS:
      return errors.attemptsExhausted();
    case ProviderErrorKind.RATE_LIMITED:
      return errors.providerRateLimited(providerError.retryAfterSeconds ?? 120);
    case ProviderErrorKind.NOT_FOUND:
      return context === 'check' ? errors.verificationNotFound() : errors.codeExpired();
    case ProviderErrorKind.AUTH_FAILED:
      return errors.providerAuthFailed();
    case ProviderErrorKind.CHANNEL_DISABLED:
      return errors.providerUnavailable(
        'SMS delivery is disabled for this account. Please contact the administrator.',
      );
    case ProviderErrorKind.BLOCKED:
      return errors.providerUnavailable(
        'The SMS provider blocked this message. Try a different number or contact support.',
      );
    case ProviderErrorKind.TIMEOUT:
      return errors.providerUnavailable(
        'The SMS provider did not respond in time. No code was verified — please try again.',
      );
    case ProviderErrorKind.NETWORK:
      return errors.providerUnavailable(
        'We could not reach the SMS provider. No code was verified — please try again.',
      );
    default:
      return errors.providerUnavailable();
  }
}

export class VerificationService {
  /**
   * @param {{
   *   provider: ReturnType<typeof import('./verify-provider.js').createTwilioVerifyProvider>,
   *   store: import('./session-store.js').MemorySessionStore,
   *   config: ReturnType<import('../config.js').loadConfig>,
   *   logger: import('../logger.js').createLogger,
   *   now?: () => number,
   * }} deps
   */
  constructor({ provider, store, config, logger, now = () => Date.now() }) {
    this.provider = provider;
    this.store = store;
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.withLock = createKeyedLock();
  }

  get providerConfigured() {
    return Boolean(this.provider.configured);
  }

  /**
   * Send (or resend) a verification code.
   * @param {{ sessionId?: string|null, phone: string, country: string, ip?: string, requestId?: string }} input
   */
  async sendCode({ sessionId, phone, country, ip, requestId }) {
    const normalised = normalisePhoneNumber(phone, country);

    const allowed = this.config.otp.allowedCountries;
    if (allowed.length > 0 && !allowed.includes(normalised.country)) {
      throw errors.countryNotAllowed(allowed);
    }
    if (!this.providerConfigured) {
      throw errors.providerNotConfigured();
    }

    return this.withLock(`send:${normalised.e164}`, async () => {
      const now = this.now();
      const existing = sessionId ? this.store.getSession(sessionId) : undefined;

      if (existing?.verified) throw errors.alreadyVerified();

      // Rolling per-number send cap (defence in depth on top of Twilio's own
      // per-service limit of ~5 sends per 10 minutes).
      const windowMs = this.config.otp.sendWindowSeconds * 1000;
      const abuse = this.store.pruneSendTimestamps(
        this.store.getAbuseRecord(normalised.e164),
        windowMs,
      );
      if (abuse.lockedUntil > now) {
        throw errors.tooManySends(secondsUntil(abuse.lockedUntil, now));
      }

      // Short cooldown between sends for the same phone number. Enforced per
      // number (not per session) so a client that drops its cookie cannot bypass
      // the cooldown by starting a brand-new session.
      const cooldownMs = this.config.otp.resendCooldownSeconds * 1000;
      if (abuse.lastSendAt > 0 && now - abuse.lastSendAt < cooldownMs) {
        throw errors.resendTooSoon(Math.ceil((cooldownMs - (now - abuse.lastSendAt)) / 1000));
      }

      // Session-scoped cooldown keeps the message accurate for an in-flight flow.
      if (existing?.verification && existing.phone === normalised.e164) {
        const retryAfter = secondsUntil(existing.verification.resendAvailableAt, now);
        if (retryAfter > 0) throw errors.resendTooSoon(retryAfter);
      }

      if (abuse.sendTimestamps.length >= this.config.otp.maxSendsPerWindow) {
        const unlockAt = abuse.sendTimestamps[0] + windowMs;
        abuse.lockedUntil = unlockAt;
        throw errors.tooManySends(secondsUntil(unlockAt, now));
      }

      const issuedAt = this.now();
      let providerResult;
      try {
        providerResult = await this.provider.startVerification({ to: normalised.e164 });
      } catch (error) {
        if (error instanceof ProviderError) {
          throw toApiError(error, { context: 'send' });
        }
        this.logger.error('verification.start.unexpected', {
          error,
          requestId,
          ip,
        });
        throw errors.providerUnavailable();
      }

      this.store.recordSend(normalised.e164);

      // Fresh session per phone: never reuse a session that belongs to a
      // different number (prevents cross-number state confusion).
      let session = existing;
      if (!session || session.phone !== normalised.e164) {
        if (session) this.store.deleteSession(session.id);
        session = this.store.createSession({
          phone: normalised.e164,
          phoneMasked: maskPhoneNumber(normalised.e164),
          country: normalised.country,
        });
      }

      const previousSends = session.verification?.sendCount ?? 0;
      this.store.updateSession(session.id, {
        phone: normalised.e164,
        phoneMasked: maskPhoneNumber(normalised.e164),
        country: normalised.country,
        verified: false,
        verifiedAt: null,
        verification: {
          sid: providerResult.sid,
          status: 'pending',
          sentAt: issuedAt,
          expiresAt: issuedAt + this.config.otp.ttlSeconds * 1000,
          resendAvailableAt: issuedAt + this.config.otp.resendCooldownSeconds * 1000,
          attempts: 0,
          maxAttempts: this.config.otp.maxVerifyAttempts,
          sendCount: previousSends + 1,
        },
      });

      this.logger.info('verification.sent', {
        requestId,
        ip,
        phone: normalised.e164,
        channel: this.provider.channel,
        providerStatus: providerResult.status,
        sendCount: previousSends + 1,
      });

      return { sessionId: session.id, status: this.publicStatus(session) };
    });
  }

  /**
   * Resend for the phone number already bound to the session. The number is
   * taken from server state (never from the client), so a resend cannot be
   * redirected to a different destination.
   */
  async resendCode({ sessionId, ip, requestId }) {
    const session = sessionId ? this.store.getSession(sessionId) : undefined;
    if (!session) throw errors.noActiveVerification();
    if (session.verified) throw errors.alreadyVerified();
    return this.sendCode({
      sessionId,
      phone: session.phone,
      country: session.country,
      ip,
      requestId,
    });
  }

  /**
   * Check a submitted code. Success requires an explicit `approved` answer from
   * Twilio Verify — nothing else is ever treated as verified.
   * @param {{ sessionId?: string|null, code: string, requestId?: string }} input
   */
  async verifyCode({ sessionId, code, requestId }) {
    const session = sessionId ? this.store.getSession(sessionId) : undefined;
    if (!session) throw errors.noActiveVerification();
    if (session.verified) throw errors.alreadyVerified();

    const verification = session.verification;
    if (!verification) throw errors.noActiveVerification();

    if (!this.providerConfigured) throw errors.providerNotConfigured();

    return this.withLock(`check:${session.id}`, async () => {
      const now = this.now();

      if (verification.status !== 'pending') {
        if (verification.status === 'max_attempts_reached') throw errors.attemptsExhausted();
        if (verification.status === 'expired') throw errors.codeExpired();
        throw errors.verificationNotFound();
      }

      if (now >= verification.expiresAt) {
        this.markExpired(session, verification);
        // Invalidate the code at the provider too, so it cannot be replayed.
        void this.provider.cancelVerification(verification.sid);
        throw errors.codeExpired();
      }

      if (verification.attempts >= verification.maxAttempts) {
        this.store.updateSession(session.id, {
          verification: { ...verification, status: 'max_attempts_reached' },
        });
        throw errors.attemptsExhausted();
      }

      let result;
      try {
        result = await this.provider.checkVerification({ to: session.phone, code });
      } catch (error) {
        if (error instanceof ProviderError) {
          if (error.kind === ProviderErrorKind.MAX_ATTEMPTS) {
            this.store.updateSession(session.id, {
              verification: { ...verification, status: 'max_attempts_reached' },
            });
          }
          if (error.kind === ProviderErrorKind.NOT_FOUND) {
            this.store.updateSession(session.id, {
              verification: { ...verification, status: 'expired' },
            });
          }
          throw toApiError(error, { context: 'check' });
        }
        // Transport/unknown failure: the code was NOT verified and the attempt
        // is not counted against the user.
        this.logger.error('verification.check.unexpected', { error, requestId });
        throw errors.providerUnavailable(
          'We could not confirm your code because the SMS provider is unreachable. Please try again.',
        );
      }

      if (result?.status === 'approved') {
        const verifiedAt = this.now();
        this.store.updateSession(session.id, {
          verified: true,
          verifiedAt,
          verification: { ...verification, status: 'approved', attempts: verification.attempts },
        });
        this.store.getAbuseRecord(session.phone).consecutiveFailures = 0;
        this.logger.info('verification.approved', {
          requestId,
          phone: session.phone,
          provider: this.provider.name,
        });
        return { sessionId: session.id, status: this.publicStatus(this.store.getSession(session.id)) };
      }

      // Twilio answered 200 but NOT approved: wrong (or already used) code.
      const attempts = verification.attempts + 1;
      const attemptsRemaining = Math.max(0, verification.maxAttempts - attempts);
      const status = attemptsRemaining === 0 ? 'max_attempts_reached' : 'pending';
      this.store.updateSession(session.id, {
        verification: { ...verification, attempts, status },
      });
      this.store.getAbuseRecord(session.phone).consecutiveFailures += 1;

      this.logger.warn('verification.rejected', {
        requestId,
        phone: session.phone,
        attempts,
        attemptsRemaining,
        providerStatus: result?.status ?? 'unknown',
      });

      if (attemptsRemaining === 0) throw errors.attemptsExhausted();
      throw errors.invalidCode(attemptsRemaining);
    });
  }

  markExpired(session, verification) {
    this.store.updateSession(session.id, {
      verification: { ...verification, status: 'expired' },
    });
  }

  /** Public, secret-free snapshot of a session's verification state. */
  publicStatus(session) {
    if (!session) return null;
    const now = this.now();
    const verification = session.verification;
    return {
      verified: session.verified,
      phoneMasked: session.phoneMasked,
      phone: session.verified ? session.phone : null,
      phoneFormatted: session.verified ? formatPhoneForDisplay(session.phone) : null,
      verifiedAt: iso(session.verifiedAt),
      method: session.method,
      provider: {
        name: this.provider.name,
        label: 'Twilio Verify',
        channel: this.provider.channel,
        configured: this.providerConfigured,
      },
      verification: verification
        ? {
            status: verification.status,
            sentAt: iso(verification.sentAt),
            expiresAt: iso(verification.expiresAt),
            resendAvailableAt: iso(verification.resendAvailableAt),
            attempts: verification.attempts,
            attemptsRemaining: Math.max(0, verification.maxAttempts - verification.attempts),
            expiresInSeconds: secondsUntil(verification.expiresAt, now),
            resendInSeconds: secondsUntil(verification.resendAvailableAt, now),
            sendCount: verification.sendCount,
          }
        : null,
      sessionExpiresAt: iso((session.verified ? session.updatedAt : session.createdAt) + this.config.session.ttlSeconds * 1000),
      serverTime: iso(now),
    };
  }

  /** Read-only status lookup; never mutates or contacts the provider. */
  getStatus(sessionId) {
    const session = sessionId ? this.store.getSession(sessionId) : undefined;
    return session ? this.publicStatus(session) : { verified: false, verification: null };
  }

  /** Reset the session: cancel any pending verification and revoke the cookie. */
  async resetSession(sessionId) {
    const session = sessionId ? this.store.getSession(sessionId) : undefined;
    if (!session) return { cleared: false };
    const sid = session.verification?.status === 'pending' ? session.verification.sid : null;
    if (sid && this.providerConfigured) await this.provider.cancelVerification(sid);
    this.store.deleteSession(session.id);
    this.logger.info('session.reset', { phone: session.phone, wasVerified: session.verified });
    return { cleared: true };
  }
}

export { ProviderErrorKind };
