/**
 * Fetch wrapper with timeouts and a single, typed error shape.
 * Every failure — network, timeout, HTTP, or validation — becomes an ApiError
 * with a message that is safe to show to the user.
 */

export class ApiError extends Error {
  constructor({ code, message, status = 0, kind = 'http', retryAfterSeconds, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
    this.requestId = requestId;
  }

  get isNetworkError() {
    return this.kind === 'network' || this.kind === 'timeout';
  }

  get fieldErrors() {
    return this.details?.fields ?? null;
  }
}

const NETWORK_MESSAGE =
  'We couldn’t reach the OTP Shield server. Check your connection and try again. Nothing was sent.';
const TIMEOUT_MESSAGE =
  'The server took too long to respond. Your request may not have completed — check your messages before retrying.';

export class ApiClient {
  constructor({ baseUrl = '', timeoutMs = 20_000 } = {}) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  get(path) {
    return this.request(path, { method: 'GET' });
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body });
  }

  async request(path, { method, body }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          'X-Requested-With': 'otp-shield',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      throw new ApiError({
        code: timedOut ? 'client_timeout' : 'network_error',
        kind: timedOut ? 'timeout' : 'network',
        message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
      });
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const error = payload?.error;
      const retryAfterHeader = Number(response.headers.get('retry-after'));
      throw new ApiError({
        code: error?.code ?? `http_${response.status}`,
        message:
          error?.message ??
          `The server responded with an unexpected error (${response.status}). Please try again.`,
        status: response.status,
        kind: 'http',
        retryAfterSeconds:
          error?.retryAfterSeconds ?? (Number.isFinite(retryAfterHeader) ? retryAfterHeader : undefined),
        details: error?.details,
        requestId: payload?.requestId,
      });
    }

    if (!payload || payload.ok !== true) {
      throw new ApiError({
        code: 'unexpected_response',
        kind: 'http',
        status: response.status,
        message: 'The server sent an unexpected response. Please try again.',
        requestId: payload?.requestId,
      });
    }

    return payload.data;
  }
}
