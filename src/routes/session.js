/**
 * Session + profile endpoints.
 *
 * The profile is the server-enforced proof that verified and unverified users
 * are treated differently: an unverified session gets 403 and no profile data.
 */
import { Router } from 'express';
import { ApiError } from '../errors.js';

export function sessionRoutes({ config, verification }) {
  const router = Router();

  router.get('/api/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const sessionId = req.signedCookies[config.session.cookieName];
    const status = verification.getStatus(sessionId);
    res.json({ ok: true, data: status, requestId: req.id });
  });

  router.post('/api/session/logout', async (req, res, next) => {
    try {
      const sessionId = req.signedCookies[config.session.cookieName];
      await verification.resetSession(sessionId);
      res.clearCookie(config.session.cookieName, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.session.secureCookie,
        path: '/',
      });
      res.json({
        ok: true,
        data: {
          verified: false,
          verification: null,
          message: 'Signed out of this verification session.',
        },
        requestId: req.id,
      });
    } catch (error) {
      next(error);
    }
  });

  // Verified-only area: a real server-side access-control check, not a UI flag.
  router.get('/api/profile', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const sessionId = req.signedCookies[config.session.cookieName];
    const status = verification.getStatus(sessionId);

    if (!status.verified) {
      return next(
        new ApiError(
          403,
          'verification_required',
          'Verify your phone number to unlock your profile.',
          { details: { verified: false } },
        ),
      );
    }

    return res.json({
      ok: true,
      data: {
        verified: true,
        profile: {
          phone: status.phone,
          phoneFormatted: status.phoneFormatted,
          phoneMasked: status.phoneMasked,
          verifiedAt: status.verifiedAt,
          method: status.method,
          provider: status.provider.label,
          benefits: [
            'Account recovery by SMS',
            'Two-factor sign-in',
            'Verified badge on your profile',
          ],
        },
        session: status,
      },
      requestId: req.id,
    });
  });

  return router;
}
