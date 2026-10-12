import { HttpException } from '@nestjs/common';
import { ERROR_CODES, HTTP_STATUS_FOR_ERROR, type ErrorCode } from '@kdc/shared';

/**
 * Every failure the API can produce is an `AppException` carrying a stable
 * machine-readable code from the shared contract. That gives the web client and
 * external integrators something to switch on instead of parsing prose.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    status?: number,
    readonly requiredPlan?: string,
  ) {
    super(
      {
        statusCode: status ?? HTTP_STATUS_FOR_ERROR[code] ?? 500,
        error: code,
        message,
        details,
        requiredPlan,
      },
      status ?? HTTP_STATUS_FOR_ERROR[code] ?? 500,
    );
  }

  static validationFailed(message: string, details?: unknown): AppException {
    return new AppException(ERROR_CODES.validation_failed, message, details, 400);
  }
  static unauthenticated(message = 'Authentication required'): AppException {
    return new AppException(ERROR_CODES.unauthenticated, message, undefined, 401);
  }
  static invalidCredentials(message = 'Incorrect email or password'): AppException {
    return new AppException(ERROR_CODES.invalid_credentials, message, undefined, 401);
  }
  static forbidden(message = 'You do not have access to this resource'): AppException {
    return new AppException(ERROR_CODES.forbidden, message, undefined, 403);
  }
  static permissionDenied(what: string): AppException {
    return new AppException(
      ERROR_CODES.forbidden,
      `Your role does not allow ${what}`,
      undefined,
      403,
    );
  }
  static notFound(entity = 'Resource'): AppException {
    return new AppException(ERROR_CODES.not_found, `${entity} not found`, undefined, 404);
  }
  static tenantNotFound(): AppException {
    return new AppException(ERROR_CODES.tenant_not_found, 'Organisation not found', undefined, 404);
  }
  static conflict(message: string, details?: unknown): AppException {
    return new AppException(ERROR_CODES.conflict, message, details, 409);
  }
  static quotaExceeded(message: string, requiredPlan?: string): AppException {
    return new AppException(ERROR_CODES.quota_exceeded, message, undefined, 402, requiredPlan);
  }
  static featureNotAvailable(feature: string, requiredPlan?: string): AppException {
    return new AppException(
      ERROR_CODES.feature_not_available,
      `${feature} is not available on the current plan`,
      undefined,
      403,
      requiredPlan,
    );
  }
  static rateLimited(retryAfterSeconds: number): AppException {
    return new AppException(
      ERROR_CODES.rate_limited,
      `Too many requests. Retry in ${retryAfterSeconds}s.`,
      { retryAfterSeconds },
      429,
    );
  }
  /**
   * 503 for a capability this deployment does not have (OAuth, SMTP, S3,
   * payments, a DNS resolver) or cannot currently use.
   *
   * `message` is used VERBATIM: it must be a complete sentence that names the
   * missing configuration, because that message is the operator's only clue
   * about what to set. (This helper used to append "is not configured on this
   * deployment" to the argument, which garbled every call site - all of them
   * already passed a full sentence.)
   */
  static serviceUnavailable(
    message: string,
    code: ErrorCode = ERROR_CODES.service_unavailable,
  ): AppException {
    return new AppException(code, message, undefined, 503);
  }
  static templateInvalid(details?: unknown): AppException {
    return new AppException(
      ERROR_CODES.template_invalid,
      'The certificate design is not valid',
      details,
      400,
    );
  }
}
