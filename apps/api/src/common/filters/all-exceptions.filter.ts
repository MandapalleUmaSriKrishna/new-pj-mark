import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { ERROR_CODES, type ApiErrorBody } from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../../config/config.tokens';
import { AppException } from '../errors/app.exception';
import { DuplicateKeyError } from '../../infra/persistence/repository';

/**
 * Single exit point for every error.
 *
 * Guarantees: a stable JSON shape, a request id that also appears in the logs,
 * no stack traces or driver internals leaking to clients, and honest HTTP
 * statuses. Unexpected errors are logged with their stack and returned as an
 * opaque 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(@Inject(ENV_CONFIG) private readonly env: Env) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request?.requestId ?? (request?.headers?.['x-request-id'] as string) ?? '-';

    let status = 500;
    let code: string = ERROR_CODES.internal_error;
    let message = 'Something went wrong while processing your request';
    let details: unknown;
    let requiredPlan: string | undefined;

    if (exception instanceof AppException) {
      const body = exception.getResponse() as ApiErrorBody;
      status = exception.getStatus();
      code = body.error;
      message = body.message;
      details = body.details;
      requiredPlan = body.requiredPlan;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const obj = res as Record<string, unknown>;
        message = String(obj.message ?? exception.message);
        details = obj.error ? undefined : obj.details;
      }
      code = mapStatusToCode(status);
    } else if (exception instanceof DuplicateKeyError) {
      status = 409;
      code = ERROR_CODES.conflict;
      message = `A record with that ${exception.fields.join(' + ')} already exists`;
    } else if (exception instanceof Error) {
      message = exception.message || message;
      if (isZodError(exception)) {
        status = 400;
        code = ERROR_CODES.validation_failed;
        details = (exception as { issues?: unknown }).issues;
      }
    }

    const isServerError = status >= 500;
    const logLine = `[${requestId}] ${request?.method ?? '?'} ${request?.url ?? '?'} -> ${status} ${code}${message ? ` :: ${message}` : ''}`;
    if (isServerError) {
      this.logger.error(logLine, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(logLine);
    }

    const body: ApiErrorBody = {
      statusCode: status,
      error: code as ApiErrorBody['error'],
      // Never expose internal error text for 5xx in production.
      message:
        isServerError && this.env.NODE_ENV === 'production' ? 'Internal server error' : message,
      requestId,
      ...(details !== undefined ? { details } : {}),
      ...(requiredPlan ? { requiredPlan } : {}),
    };

    if (response.headersSent) {
      this.logger.warn(`[${requestId}] Headers already sent; cannot write error body`);
      return;
    }
    response.status(status).json(body);
  }
}

function isZodError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'issues' in err &&
    Array.isArray((err as { issues: unknown }).issues)
  );
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return ERROR_CODES.validation_failed;
    case 401:
      return ERROR_CODES.unauthenticated;
    case 402:
      return ERROR_CODES.quota_exceeded;
    case 403:
      return ERROR_CODES.forbidden;
    case 404:
      return ERROR_CODES.not_found;
    case 409:
      return ERROR_CODES.conflict;
    case 413:
      return ERROR_CODES.file_too_large;
    case 429:
      return ERROR_CODES.rate_limited;
    case 503:
      return ERROR_CODES.service_unavailable;
    default:
      return status >= 500 ? ERROR_CODES.internal_error : ERROR_CODES.validation_failed;
  }
}
