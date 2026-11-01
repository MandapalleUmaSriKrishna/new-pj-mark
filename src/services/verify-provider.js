/**
 * Twilio Verify v2 provider.
 *
 * This is the ONLY module that talks to Twilio. It exposes a tiny interface so
 * the rest of the app never depends on Twilio's SDK shape, and so the automated
 * test-suite can inject a fake *for tests only*. In production this module is
 * always constructed with real credentials from the environment.
 *
 * Codes are generated, stored, expired and rate-limited by Twilio Verify —
 * OTP Shield never generates, stores or reveals a one-time code, and it never
 * claims a verification succeeded unless Twilio answers `status: "approved"`.
 */
import twilio from 'twilio';

/** @enum {string} */
export const ProviderErrorKind = {
  NOT_CONFIGURED: 'not_configured',
  INVALID_NUMBER: 'invalid_number',
  UNSUPPORTED_NUMBER: 'unsupported_number',
  MAX_ATTEMPTS: 'max_attempts',
  RATE_LIMITED: 'rate_limited',
  NOT_FOUND: 'not_found',
  AUTH_FAILED: 'auth_failed',
  CHANNEL_DISABLED: 'channel_disabled',
  BLOCKED: 'blocked',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  UNKNOWN: 'unknown',
};

export class ProviderError extends Error {
  /**
   * @param {string} kind
   * @param {string} message internal (never sent to the browser)
   * @param {{ twilioCode?: number|string, httpStatus?: number, retryAfterSeconds?: number, cause?: unknown }} [meta]
   */
  constructor(kind, message, meta = {}) {
    super(message, meta.cause ? { cause: meta.cause } : undefined);
    this.name = 'ProviderError';
    this.kind = kind;
    this.twilioCode = meta.twilioCode;
    this.httpStatus = meta.httpStatus;
    this.retryAfterSeconds = meta.retryAfterSeconds;
    this.expose = false;
  }
}

/** Twilio Verify error codes -> provider error kind. */
const TWILIO_CODE_MAP = new Map([
  [60200, ProviderErrorKind.INVALID_NUMBER], // invalid parameter / bad number
  [60201, ProviderErrorKind.CHANNEL_DISABLED], // template translation not approved
  [60202, ProviderErrorKind.MAX_ATTEMPTS], // max check attempts reached
  [60203, ProviderErrorKind.RATE_LIMITED], // max send attempts reached
  [60205, ProviderErrorKind.UNSUPPORTED_NUMBER], // landline
  [60220, ProviderErrorKind.BLOCKED], // China vetting required
  [60223, ProviderErrorKind.CHANNEL_DISABLED], // delivery channel disabled
  [60238, ProviderErrorKind.BLOCKED], // blocked by Twilio (fraud guard)
  [60245, ProviderErrorKind.BLOCKED], // messaging limits exceeded
  [20003, ProviderErrorKind.AUTH_FAILED], // authentication error
  [20005, ProviderErrorKind.AUTH_FAILED], // account not active
  [20404, ProviderErrorKind.NOT_FOUND], // verification no longer exists
  [20429, ProviderErrorKind.RATE_LIMITED], // too many requests
]);

function mapTwilioError(error) {
  const twilioCode = typeof error?.code === 'number' ? error.code : undefined;
  const httpStatus = typeof error?.status === 'number' ? error.status : undefined;
  const kind = TWILIO_CODE_MAP.get(twilioCode) ?? classifyWithoutCode(error, httpStatus);
  return new ProviderError(kind, error?.message || 'Twilio request failed', {
    twilioCode,
    httpStatus,
    retryAfterSeconds: kind === ProviderErrorKind.RATE_LIMITED ? 120 : undefined,
    cause: error,
  });
}

function classifyWithoutCode(error, httpStatus) {
  const code = String(error?.code ?? '').toUpperCase();
  if (['ETIMEDOUT', 'ECONNABORTED', 'ESOCKETTIMEDOUT', 'TWILIO_TIMEOUT'].includes(code)) {
    return ProviderErrorKind.TIMEOUT;
  }
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH'].includes(code)) {
    return ProviderErrorKind.NETWORK;
  }
  if (httpStatus === 401 || httpStatus === 403) return ProviderErrorKind.AUTH_FAILED;
  if (httpStatus === 429) return ProviderErrorKind.RATE_LIMITED;
  if (httpStatus === 408 || httpStatus === 504) return ProviderErrorKind.TIMEOUT;
  if (httpStatus >= 500) return ProviderErrorKind.NETWORK;
  return ProviderErrorKind.UNKNOWN;
}

/**
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {import('../logger.js').createLogger} logger
 * @param {{ client?: any }} [options] `client` exists so unit tests can inject a
 *   stubbed Twilio client and exercise the real error-mapping code without network.
 */
export function createTwilioVerifyProvider(config, logger, options = {}) {
  const { accountSid, authToken, apiKeySid, apiKeySecret, verifyServiceSid, timeoutMs } =
    config.twilio;

  if (!config.twilio.configured) {
    return createNotConfiguredProvider(config);
  }

  // Prefer a scoped API Key pair (can be rotated without touching the account
  // auth token). Fall back to the account SID + auth token.
  const client =
    options.client ??
    (apiKeySid
      ? twilio(apiKeySid, apiKeySecret, { accountSid, timeout: timeoutMs })
      : twilio(accountSid, authToken, { timeout: timeoutMs }));

  const service = client.verify.v2.services(verifyServiceSid);

  async function startVerification({ to }) {
    try {
      const verification = await service.verifications.create({
        to,
        channel: 'sms',
        // Locale is intentionally omitted: Twilio resolves an approved
        // template for the destination country automatically.
      });
      logger.info('twilio.verification.started', {
        channel: verification.channel,
        status: verification.status,
        to: to,
      });
      return {
        sid: verification.sid,
        status: verification.status,
        channel: verification.channel,
        valid: verification.valid,
      };
    } catch (error) {
      const mapped = mapTwilioError(error);
      logger.warn('twilio.verification.start_failed', {
        kind: mapped.kind,
        twilioCode: mapped.twilioCode,
        httpStatus: mapped.httpStatus,
        error: mapped.message,
      });
      throw mapped;
    }
  }

  async function checkVerification({ to, code }) {
    try {
      const check = await service.verificationChecks.create({ to, code });
      logger.info('twilio.verification.checked', {
        status: check.status,
        valid: check.valid,
        to: to,
      });
      return { sid: check.sid, status: check.status, valid: check.valid };
    } catch (error) {
      const mapped = mapTwilioError(error);
      logger.warn('twilio.verification.check_failed', {
        kind: mapped.kind,
        twilioCode: mapped.twilioCode,
        httpStatus: mapped.httpStatus,
        error: mapped.message,
      });
      throw mapped;
    }
  }

  /** Best-effort cancel: used when a code expires locally or a session is reset. */
  async function cancelVerification(sid) {
    if (!sid) return false;
    try {
      await service.verifications(sid).update({ status: 'canceled' });
      return true;
    } catch (error) {
      const mapped = mapTwilioError(error);
      // 20404 simply means it is already gone — not an error worth alerting on.
      if (mapped.kind !== ProviderErrorKind.NOT_FOUND) {
        logger.warn('twilio.verification.cancel_failed', {
          kind: mapped.kind,
          twilioCode: mapped.twilioCode,
        });
      }
      return false;
    }
  }

  /** Used by scripts/check-twilio.js — never exposed over HTTP. */
  async function healthCheck() {
    try {
      const resource = await client.verify.v2.services(verifyServiceSid).fetch();
      return {
        ok: true,
        friendlyName: resource.friendlyName,
        codeLength: resource.codeLength,
        lookupEnabled: resource.lookupEnabled,
        sidSuffix: String(resource.sid).slice(-4),
      };
    } catch (error) {
      const mapped = mapTwilioError(error);
      return {
        ok: false,
        kind: mapped.kind,
        twilioCode: mapped.twilioCode,
        httpStatus: mapped.httpStatus,
        message: mapped.message,
      };
    }
  }

  return {
    name: 'twilio-verify',
    channel: 'sms',
    configured: true,
    mode: apiKeySid ? 'api-key' : 'auth-token',
    startVerification,
    checkVerification,
    cancelVerification,
    healthCheck,
  };
}

/**
 * A provider that refuses to do anything. Used when credentials are missing so
 * the API fails loudly with 503 instead of ever simulating a verification.
 */
function createNotConfiguredProvider(config) {
  const reason = `Twilio Verify is not configured. Missing: ${config.twilio.missingCredentials.join(', ')}`;
  const refuse = () => {
    throw new ProviderError(ProviderErrorKind.NOT_CONFIGURED, reason);
  };
  return {
    name: 'twilio-verify',
    channel: 'sms',
    configured: false,
    mode: 'unconfigured',
    startVerification: async () => refuse(),
    checkVerification: async () => refuse(),
    cancelVerification: async () => false,
    healthCheck: async () => ({ ok: false, kind: ProviderErrorKind.NOT_CONFIGURED, message: reason }),
  };
}
