import { Injectable, NestMiddleware } from '@nestjs/common';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response, RequestHandler } from 'express';
import type { Env } from '../../config/config.tokens';

/**
 * Security headers, cookie parsing and compression.
 *
 * Helmet's defaults are kept, with a Content-Security-Policy tuned for an API
 * that also serves the generated Swagger UI and the public verification page.
 * `crossOriginResourcePolicy` is relaxed only for the public asset routes so
 * that the web origin can embed tenant logos and certificate previews.
 */
@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private readonly helmetHandler: RequestHandler;
  private readonly compressionHandler: RequestHandler;
  private readonly cookieHandler: RequestHandler;

  constructor(private readonly env: Env) {
    const origins = env.CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    this.helmetHandler = helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'", ...origins],
          'style-src': ["'self'", "'unsafe-inline'", ...origins],
          'img-src': ["'self'", 'data:', 'blob:', ...origins],
          'font-src': ["'self'", 'data:', ...origins],
          'connect-src': ["'self'", ...origins],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'object-src': ["'none'"],
          ...(env.NODE_ENV === 'production' ? { 'upgrade-insecure-requests': [] as string[] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts:
        env.NODE_ENV === 'production'
          ? { maxAge: 31536000, includeSubDomains: true, preload: true }
          : false,
      frameguard: { action: 'deny' },
      noSniff: true,
      xssFilter: true,
      dnsPrefetchControl: { allow: false },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    });
    this.compressionHandler = compression();
    this.cookieHandler = cookieParser(env.SESSION_COOKIE_SECRET);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.helmetHandler(req, res, (err?: unknown) => {
      if (err) return next(err as Error);
      this.compressionHandler(req, res, (err2?: unknown) => {
        if (err2) return next(err2 as Error);
        this.cookieHandler(req, res, (err3?: unknown) => {
          if (err3) return next(err3 as Error);
          // Baseline headers for anything Helmet does not set (proxies, previews).
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-Frame-Options', 'DENY');
          res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
          res.removeHeader('X-Powered-By');
          next();
        });
      });
    });
  }
}
