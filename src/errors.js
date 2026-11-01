/**
 * One error type, one wire format.
 *
 * Every failure the browser sees is an `ApiError` shaped like:
 *   { ok: false, error: { code, message, retryAfterSeconds? }, requestId }
 *
 * Provider messages, stack traces and internal details never reach the client.
 */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code stable machine-readable code
   * @param {string} message user-facing text (safe to display)
   * @param {{ retryAfterSeconds?: number, details?: object, cause?: unknown, headers?: Record<string,string> }} [options]
   */
  constructor(status, code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.expose = true;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }

  toJSON(requestId) {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryAfterSeconds ? { retryAfterSeconds: this.retryAfterSeconds } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
      requestId,
    };
  }
}

/** Common error factories so messages stay consistent between server and tests. */
export const errors = {
  invalidPhone: (message = 'Enter a valid phone number, including the country code.') =>
    new ApiError(400, 'invalid_phone', message),
  invalidCountry: () =>
    new ApiError(400, 'invalid_country', 'Select a supported country for this number.'),
  countryNotAllowed: (allowed) =>
    new ApiError(
      403,
      'country_not_allowed',
      `SMS verification is not available for that country yet.${
        allowed?.length ? ` Supported: ${allowed.join(', ')}.` : ''
      }`,
    ),
  invalidRequest: (message = 'The request was invalid.', details) =>
    new ApiError(400, 'invalid_request', message, { details }),
  unsupportedMediaType: () =>
    new ApiError(415, 'unsupported_media_type', 'Requests must be sent as JSON.'),
  noActiveVerification: () =>
    new ApiError(409, 'no_active_verification', 'Request a new code to continue.'),
  alreadyVerified: () =>
    new ApiError(
      409,
      'already_verified',
      'This session is already verified. Sign out to verify a different number.',
    ),
  alreadyPending: () =>
    new ApiError(
      409,
      'verification_already_pending',
      'A verification is already in progress. Enter the code you received or wait for the resend timer.',
    ),
  resendTooSoon: (retryAfterSeconds) =>
    new ApiError(
      429,
      'resend_too_soon',
      `Wait ${retryAfterSeconds}s before requesting another code.`,
      { retryAfterSeconds },
    ),
  tooManySends: (retryAfterSeconds) =>
    new ApiError(
      429,
      'too_many_sends',
      'Too many codes were requested for this number. Try again later.',
      { retryAfterSeconds },
    ),
  rateLimited: (message, retryAfterSeconds) =>
    new ApiError(429, 'rate_limited', message, { retryAfterSeconds }),
  invalidCode: (attemptsRemaining) =>
    new ApiError(422, 'invalid_code', 'That code is incorrect. Check the SMS and try again.', {
      details: { attemptsRemaining },
    }),
  attemptsExhausted: () =>
    new ApiError(
      429,
      'attempts_exhausted',
      'Too many incorrect codes. Request a new code to try again.',
    ),
  codeExpired: () =>
    new ApiError(410, 'code_expired', 'That code has expired. Request a new one.'),
  verificationNotFound: () =>
    new ApiError(
      410,
      'verification_not_found',
      'This verification is no longer valid. Request a new code.',
    ),
  unsupportedNumber: (message) =>
    new ApiError(
      400,
      'unsupported_number',
      message || 'This number cannot receive SMS messages. Try a mobile number.',
    ),
  providerNotConfigured: () =>
    new ApiError(
      503,
      'provider_not_configured',
      'SMS delivery is not configured on this server. Add Twilio Verify credentials and restart — OTP Shield never fakes a successful verification.',
    ),
  providerAuthFailed: () =>
    new ApiError(
      502,
      'provider_auth_failed',
      'The SMS provider rejected the server credentials. Please contact the administrator.',
    ),
  providerRateLimited: (retryAfterSeconds = 60) =>
    new ApiError(
      429,
      'provider_rate_limited',
      'The SMS provider is limiting requests for this number. Try again in a few minutes.',
      { retryAfterSeconds },
    ),
  providerUnavailable: (message) =>
    new ApiError(
      502,
      'provider_unavailable',
      message ||
        'We could not reach the SMS provider. Your code was not sent — please try again.',
    ),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  methodNotAllowed: () =>
    new ApiError(405, 'method_not_allowed', 'Method not allowed for this endpoint.'),
  originRejected: () =>
    new ApiError(403, 'origin_rejected', 'Request blocked: unexpected origin.'),
  payloadTooLarge: () =>
    new ApiError(413, 'payload_too_large', 'Request body is too large.'),
  internal: () =>
    new ApiError(500, 'internal_error', 'Something went wrong on our side. Please try again.'),
};
