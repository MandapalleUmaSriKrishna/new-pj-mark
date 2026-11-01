/** Public, cacheable-by-proxy, secret-free endpoints. */
import { Router } from 'express';
import { publicConfig, countryOptions, OTP_CODE_LENGTH } from '../config.js';

const STARTED_AT = Date.now();

export function publicRoutes({ config, provider }) {
  const router = Router();

  // Platform health probe (Render, Railway, Fly, Kubernetes, ...). Always 200
  // when the process is up; provider configuration is reported, not gated, so
  // a missing credential never makes a deploy look "unhealthy".
  router.get('/healthz', (req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      providerConfigured: provider.configured,
    });
  });

  router.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      status: 'healthy',
      environment: config.env,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      provider: {
        name: 'twilio-verify',
        configured: provider.configured,
        channel: 'sms',
      },
      otp: {
        codeLength: OTP_CODE_LENGTH,
        ttlSeconds: config.otp.ttlSeconds,
        resendCooldownSeconds: config.otp.resendCooldownSeconds,
        maxVerifyAttempts: config.otp.maxVerifyAttempts,
      },
      requestId: req.id,
    });
  });

  // Everything the browser legitimately needs to render the UI.
  router.get('/api/config', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    const base = publicConfig(config);
    res.json({
      ok: true,
      data: {
        ...base,
        // Report the provider actually in use (never assume from raw env parsing).
        provider: { ...base.provider, configured: provider.configured },
        countries: countryOptions(),
        serverTime: new Date().toISOString(),
        requestId: req.id,
      },
    });
  });

  return router;
}
