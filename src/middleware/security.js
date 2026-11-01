/** Helmet, CSP, and request-shape hardening. */
import helmet from 'helmet';
import { errors } from '../errors.js';

/**
 * Content-Security-Policy is strict: no inline scripts, no inline styles, no
 * third-party origins. The UI is fully self-hosted and uses ES modules.
 */
export function securityHeaders(config) {
  const directives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    styleSrcAttr: ["'none'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    formAction: ["'self'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
    ...(config.allowIframeEmbedding ? { frameAncestors: null } : { frameAncestors: ["'none'"] }),
  };

  const middleware = helmet({
    contentSecurityPolicy: { useDefaults: false, directives },
    // The app is same-origin only; COEP is not needed and blocks nothing we use.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // X-Frame-Options is disabled when embedding is explicitly allowed for a
    // preview environment; CSP frame-ancestors still governs in production.
    frameguard: config.allowIframeEmbedding ? false : { action: 'deny' },
    hsts: config.isProduction
      ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
      : false,
  });

  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (error) return next(error);
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    });
  };
}

/** Build and validate the set of origins allowed to POST to this API. */
export function createOriginGuard(config) {
  const configured = new Set(config.appOrigins);

  return function originGuard(req, res, next) {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
    if (!req.path.startsWith('/api/')) return next();

    const origin = req.get('origin');
    const referer = req.get('referer');

    // Requests without Origin/Referer come from non-browser clients (curl,
    // server-to-server). They cannot ride a browser's cookies, and the session
    // cookie is SameSite=Lax, so they are allowed but still rate limited.
    if (!origin && !referer) return next();

    const candidate = origin ?? safeOrigin(referer);
    if (!candidate) return next(errors.originRejected());

    if (configured.size > 0 && configured.has(candidate)) return next();

    // Same-host fallback keeps local development and single-origin deploys working.
    const host = req.get('host');
    if (host && candidate === `${req.protocol}://${host}`) return next();
    if (host && candidate === `http://${host}`) return next();
    if (host && candidate === `https://${host}`) return next();

    return next(errors.originRejected());
  };
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Reject non-JSON bodies early with a clear 415 instead of a confusing parse error. */
export function requireJson(req, res, next) {
  if (req.is('application/json')) return next();
  if (!req.get('content-type') && req.headers['content-length'] === undefined) {
    // Empty body: let schema validation produce a field-level message.
    return next();
  }
  return next(errors.unsupportedMediaType());
}
