/**
 * Express application factory.
 *
 * Dependencies (provider, store, clock, logger, config) are injectable so the
 * test-suite can drive deterministic scenarios. Production entrypoint
 * (`src/server.js`) always constructs the real Twilio Verify provider.
 */
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createTwilioVerifyProvider } from './services/verify-provider.js';
import { MemorySessionStore } from './services/session-store.js';
import { VerificationService } from './services/verification-service.js';
import { securityHeaders, createOriginGuard } from './middleware/security.js';
import { createRateLimiters } from './middleware/rate-limit.js';
import { requestId, accessLog, notFound, errorHandler, methodNotAllowed } from './middleware/core.js';
import { publicRoutes } from './routes/public.js';
import { otpRoutes } from './routes/otp.js';
import { sessionRoutes } from './routes/session.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');

/**
 * @param {{
 *   config?: ReturnType<typeof loadConfig>,
 *   provider?: ReturnType<typeof createTwilioVerifyProvider>,
 *   store?: MemorySessionStore,
 *   logger?: ReturnType<typeof createLogger>,
 *   now?: () => number,
 * }} [options]
 */
export function createApp(options = {}) {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger({ level: config.logLevel });
  const now = options.now ?? (() => Date.now());
  const store =
    options.store ?? new MemorySessionStore({ ttlMs: config.session.ttlSeconds * 1000, now });
  const ownsStore = !options.store;
  const provider = options.provider ?? createTwilioVerifyProvider(config, logger);

  if (ownsStore) store.startSweeper();

  const verification = new VerificationService({ provider, store, config, logger, now });
  const limiters = createRateLimiters(config);

  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', config.trustProxy);
  app.set('json escape', true); // escape <, >, & in JSON responses
  app.locals.config = config;
  app.locals.logger = logger;
  app.locals.provider = provider;
  app.locals.store = store;
  app.locals.verification = verification;
  app.locals.close = () => {
    if (ownsStore) store.stopSweeper();
  };

  app.use(requestId);
  app.use(securityHeaders(config));
  app.use(compression());
  app.use(cookieParser(config.session.secret));
  app.use(express.json({ limit: '8kb', strict: true }));
  app.use(accessLog(logger));
  app.use(createOriginGuard(config));

  const applySessionCookie = (res, sessionId) => {
    if (!sessionId) return;
    res.cookie(config.session.cookieName, sessionId, {
      signed: true,
      httpOnly: true,
      secure: config.session.secureCookie,
      sameSite: 'lax',
      path: '/',
      maxAge: config.session.ttlSeconds * 1000,
    });
  };

  // Every API call (including config/health) passes the broad per-IP ceiling;
  // health checks are exempted inside the limiter so probes stay reliable.
  app.use('/api', limiters.global);
  app.use(publicRoutes({ config, provider }));
  app.use(otpRoutes({ config, logger, verification, store, limiters, applySessionCookie }));
  app.use(sessionRoutes({ config, verification }));

  // Static UI.
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      etag: true,
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store');
        } else if (/\.(?:css|js|svg)$/.test(filePath)) {
          res.setHeader('Cache-Control', config.isProduction ? 'public, max-age=3600' : 'no-cache');
        }
      },
    }),
  );

  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Link',
      '</styles/app.css>; rel=preload; as=style, </js/app.js>; rel=modulepreload',
    );
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // Client-side routes (#/verify, #/profile) live in the hash, so any non-asset
  // path can safely return the shell.
  app.get(/^\/(?:verify|profile|privacy|terms|support)?\/?$/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // Defined API paths with the wrong verb get a proper 405 instead of a 404.
  app.all('/api/otp/send', methodNotAllowed(['POST']));
  app.all('/api/otp/resend', methodNotAllowed(['POST']));
  app.all('/api/otp/verify', methodNotAllowed(['POST']));
  app.all('/api/session', methodNotAllowed(['GET']));
  app.all('/api/session/logout', methodNotAllowed(['POST']));
  app.all('/api/profile', methodNotAllowed(['GET']));
  app.all('/api/config', methodNotAllowed(['GET']));
  app.all('/api/health', methodNotAllowed(['GET']));

  app.use(notFound);
  app.use(errorHandler(config, logger));

  return app;
}
