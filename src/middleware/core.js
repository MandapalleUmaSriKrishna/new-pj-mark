/** Request ids, access logs, 404s and the single error boundary. */
import { randomUUID } from 'node:crypto';
import { ApiError, errors } from '../errors.js';

export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = /^[a-zA-Z0-9-_]{8,64}$/.test(incoming ?? '') ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export function accessLog(logger) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      // Skip static assets and health probes to keep logs signal-heavy.
      if (
        req.path.startsWith('/styles/') ||
        req.path.startsWith('/js/') ||
        req.path.startsWith('/assets/') ||
        req.path === '/healthz' ||
        req.path === '/api/health' ||
        req.path === '/favicon.ico'
      ) {
        return;
      }
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info('http.request', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        ip: req.ip,
      });
    });
    next();
  };
}

export function notFound(req, res, next) {
  next(errors.notFound());
}

/** The only place where error responses are shaped. Never leaks internals. */
export function errorHandler(config, logger) {
  // eslint-disable-next-line no-unused-vars -- Express requires the 4-arg signature
  return (error, req, res, next) => {
    if (res.headersSent) return;

    let apiError;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (error?.type === 'entity.too.large') {
      apiError = errors.payloadTooLarge();
    } else if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
      apiError = errors.invalidRequest('The request body was not valid JSON.');
    } else if (error?.type === 'charset.unsupported' || error?.type === 'encoding.unsupported') {
      apiError = errors.unsupportedMediaType();
    } else {
      apiError = errors.internal();
    }

    const logPayload = {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: apiError.status,
      code: apiError.code,
      ip: req.ip,
    };
    if (apiError.status >= 500) {
      logger.error('request.failed', { ...logPayload, error });
    } else {
      logger.warn('request.rejected', logPayload);
    }

    if (apiError.retryAfterSeconds) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(apiError.retryAfterSeconds))));
    }
    for (const [header, value] of Object.entries(apiError.headers ?? {})) {
      res.setHeader(header, value);
    }

    res.status(apiError.status).json(apiError.toJSON(req.id));
  };
}

/** 405 helper for API routes that exist but do not support the method. */
export function methodNotAllowed(allowed) {
  return (req, res, next) => {
    res.setHeader('Allow', allowed.join(', '));
    next(errors.methodNotAllowed());
  };
}
