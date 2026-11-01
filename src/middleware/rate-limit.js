/** Rate limiting (per client IP) with the app's JSON error format. */
import rateLimit from 'express-rate-limit';
import { errors } from '../errors.js';

function jsonRateLimitHandler(message) {
  return (req, res, next, options) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000))
      : Math.ceil(options.windowMs / 1000);
    return next(errors.rateLimited(message, retryAfterSeconds));
  };
}

function buildLimiter({ windowMs, limit, message, skip = () => false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Default key generator uses the resolved client IP (IPv6-safe for /128).
    handler: jsonRateLimitHandler(message),
    skip,
  });
}

/**
 * Three layers: a broad API ceiling, a tight limit on sending SMS, and a limit
 * on code submissions, so neither sending nor guessing can be brute-forced.
 */
export function createRateLimiters(config) {
  if (!config.rateLimits.enabled) {
    const passthrough = (req, res, next) => next();
    return { global: passthrough, send: passthrough, verify: passthrough };
  }

  const { global, send, verify } = config.rateLimits;

  return {
    global: buildLimiter({
      windowMs: global.windowMs,
      limit: global.limit,
      message: 'Too many requests from this connection. Please slow down and try again shortly.',
      // req.path is mount-relative here, so compare against originalUrl.
      skip: (req) => req.originalUrl.split('?')[0] === '/api/health',
    }),
    send: buildLimiter({
      windowMs: send.windowMs,
      limit: send.limit,
      message: 'Too many verification codes requested from this connection. Try again later.',
    }),
    verify: buildLimiter({
      windowMs: verify.windowMs,
      limit: verify.limit,
      message: 'Too many code attempts from this connection. Try again later.',
    }),
  };
}
