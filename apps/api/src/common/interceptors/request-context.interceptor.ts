import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { newId } from '../../infra/ids';

/**
 * Assigns a request id, echoes it in `X-Request-Id`, and logs one line per
 * request with method, path, status and duration. Support and audit triage both
 * start from this id.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string; startTime?: number }>();
    const response = http.getResponse<Response>();
    const requestId = (request.headers['x-request-id'] as string) || newId();
    request.requestId = requestId;
    request.startTime = Date.now();
    response.setHeader('X-Request-Id', requestId);

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response.statusCode),
        error: (err: unknown) => {
          const status = (err as { getStatus?: () => number }).getStatus?.() ?? 500;
          this.log(request, status, err instanceof Error ? err.message : String(err));
        },
      }),
    );
  }

  private log(
    request: Request & { startTime?: number; requestId?: string },
    status: number,
    errorMessage?: string,
  ): void {
    const took = request.startTime ? Date.now() - request.startTime : -1;
    const line = `${request.method} ${request.url} ${status} ${took}ms [${request.requestId ?? '-'}]`;
    if (status >= 500) this.logger.error(errorMessage ? `${line} :: ${errorMessage}` : line);
    else if (status >= 400) this.logger.warn(line);
    else this.logger.log(line);
  }
}
