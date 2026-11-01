/** OTP send + verify endpoints. */
import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../errors.js';
import { validate } from '../utils/validate.js';
import { OTP_CODE_LENGTH } from '../config.js';

const sendSchema = z.object({
  phone: z
    .string({ required_error: 'Enter a phone number.', invalid_type_error: 'Enter a phone number.' })
    .trim()
    .min(1, 'Enter a phone number.')
    .max(32, 'That phone number is too long.'),
  country: z
    .string({ required_error: 'Select a country.', invalid_type_error: 'Select a country.' })
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Select a country.'),
});

const verifySchema = z.object({
  code: z
    .string({ required_error: 'Enter the 6-digit code from the SMS.' })
    .trim()
    .regex(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`), `Enter the ${OTP_CODE_LENGTH}-digit code from the SMS.`),
});

export function otpRoutes({ config, logger, verification, store, limiters, applySessionCookie }) {
  const router = Router();

  router.post('/api/otp/send', limiters.send, requireJsonBody, asyncRoute(async (req, res) => {
    const body = validate(sendSchema, req.body);
    const sessionId = req.signedCookies[config.session.cookieName];

    const result = await verification.sendCode({
      sessionId,
      phone: body.phone,
      country: body.country.toUpperCase(),
      ip: req.ip,
      requestId: req.id,
    });

    applySessionCookie(res, result.sessionId);
    res.status(200).json({
      ok: true,
      data: {
        message: `We sent a ${OTP_CODE_LENGTH}-digit code by SMS to ${result.status.phoneMasked}.`,
        ...result.status,
      },
      requestId: req.id,
    });
  }));

  router.post('/api/otp/resend', limiters.send, asyncRoute(async (req, res) => {
    const sessionId = req.signedCookies[config.session.cookieName];
    const result = await verification.resendCode({ sessionId, ip: req.ip, requestId: req.id });
    applySessionCookie(res, result.sessionId);
    res.status(200).json({
      ok: true,
      data: {
        message: `A new code was sent by SMS to ${result.status.phoneMasked}.`,
        ...result.status,
      },
      requestId: req.id,
    });
  }));

  router.post('/api/otp/verify', limiters.verify, requireJsonBody, asyncRoute(async (req, res) => {
    const body = validate(verifySchema, req.body);
    const sessionId = req.signedCookies[config.session.cookieName];

    const result = await verification.verifyCode({
      sessionId,
      code: body.code,
      requestId: req.id,
    });

    applySessionCookie(res, result.sessionId);
    logger.info('verification.completed', { requestId: req.id, ip: req.ip });
    res.status(200).json({
      ok: true,
      data: {
        message: 'Phone number verified.',
        ...result.status,
      },
      requestId: req.id,
    });
  }));

  return router;
}

/** Requests with a body must be JSON; empty bodies fall through to validation. */
function requireJsonBody(req, res, next) {
  if (req.is('application/json')) return next();
  if (!req.get('content-type') && (req.headers['content-length'] ?? '0') === '0') return next();
  return next(errors.unsupportedMediaType());
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
