/** Sending codes: validation, provider integration, cooldowns and send caps. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, sendOtp, verifyOtp, ProviderError, ProviderErrorKind } from './helpers.js';

test('rejects a missing phone number', async () => {
  const h = createHarness();
  const res = await h.agent.post('/api/otp/send').send({ country: 'IN' });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'invalid_request');
  assert.equal(res.body.error.details.fields.phone, 'Enter a phone number.');
  assert.equal(h.provider.starts.length, 0, 'provider must not be called for invalid input');
});

test('rejects malformed, non-numeric and over-long numbers before calling the provider', async () => {
  const h = createHarness();

  for (const phone of ['abc', '12', '1234567890123456', '+91 98765 43210 ext 4']) {
    const res = await sendOtp(h.agent, { phone, country: 'IN' });
    assert.equal(res.status, 400, `expected 400 for "${phone}"`);
    assert.equal(res.body.error.code, 'invalid_phone');
  }
  assert.equal(h.provider.starts.length, 0);
});

test('rejects a country that does not match an international + prefix', async () => {
  const h = createHarness();
  const res = await sendOtp(h.agent, { phone: '+1 202 555 0123', country: 'IN' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_phone');
  assert.match(res.body.error.message, /belongs to US/);
  assert.equal(h.provider.starts.length, 0);
});

test('normalises national input to E.164 before contacting Twilio', async () => {
  const h = createHarness();

  const variants = [
    { phone: '98765 43210', country: 'IN' },
    { phone: '098765 43210', country: 'IN' },
    { phone: ' 9876543210 ', country: 'IN' },
  ];

  for (const [index, variant] of variants.entries()) {
    if (index > 0) h.advance(31); // step past the resend cooldown between sends
    const res = await h.agent.post('/api/otp/send').send(variant);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  assert.deepEqual(h.provider.starts, ['+919876543210', '+919876543210', '+919876543210']);
});

test('sends a real provider request and returns only safe verification metadata', async () => {
  const h = createHarness();
  const res = await sendOtp(h.agent);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const data = res.body.data;

  assert.equal(data.verified, false);
  assert.equal(data.phoneMasked, '+91••••••3210');
  assert.equal(data.phone, null, 'unverified sessions must not receive the full number');
  assert.equal(data.provider.name, 'twilio-verify');
  assert.equal(data.verification.status, 'pending');
  assert.equal(data.verification.attemptsRemaining, 5);
  assert.equal(data.verification.resendInSeconds, 30);
  assert.equal(data.verification.expiresInSeconds, 600);
  assert.ok(Date.parse(data.verification.expiresAt) > Date.parse(data.verification.sentAt));
  assert.ok(data.verification.sid === undefined, 'provider SIDs stay server-side');

  // Signed, http-only session cookie.
  const cookie = res.headers['set-cookie'].join(';');
  assert.match(cookie, /otp_shield_sid=s%3A/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  assert.deepEqual(h.provider.starts, ['+919876543210']);
  assert.doesNotMatch(JSON.stringify(res.body), /AC[0-9a-f]{32}|auth.?token/i);
});

test('enforces the resend cooldown without calling Twilio again', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  const tooSoon = await h.agent.post('/api/otp/resend');
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.body.error.code, 'resend_too_soon');
  assert.equal(tooSoon.body.error.retryAfterSeconds, 30);
  assert.equal(tooSoon.headers['retry-after'], '30');
  assert.equal(h.provider.starts.length, 1, 'no second SMS during the cooldown');

  h.advance(30);
  const resent = await h.agent.post('/api/otp/resend');
  assert.equal(resent.status, 200);
  assert.equal(resent.body.data.verification.sendCount, 2);
  assert.equal(resent.body.data.verification.attemptsRemaining, 5, 'resend resets attempts');
  assert.equal(h.provider.starts.length, 2);
});

test('resend uses the server-side number, never a client-supplied destination', async () => {
  const h = createHarness();
  await sendOtp(h.agent, { phone: '9876543210', country: 'IN' });
  h.advance(31);

  const res = await h.agent
    .post('/api/otp/resend')
    .send({ phone: '+12025550123', country: 'US' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.phoneMasked, '+91••••••3210');
  assert.deepEqual(h.provider.starts, ['+919876543210', '+919876543210']);
});

test('caps sends per number in a rolling window', async () => {
  const h = createHarness({ env: { OTP_MAX_SENDS_PER_WINDOW: '3', OTP_SEND_WINDOW_SECONDS: '3600' } });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = attempt === 0 ? await sendOtp(h.agent) : await h.agent.post('/api/otp/resend');
    assert.equal(res.status, 200, `send ${attempt + 1} should succeed`);
    h.advance(31);
  }

  const blocked = await h.agent.post('/api/otp/resend');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'too_many_sends');
  assert.ok(blocked.body.error.retryAfterSeconds > 0);
  assert.equal(h.provider.starts.length, 3);
});

test('refuses to send when Twilio credentials are missing (no simulated success)', async () => {
  const h = createHarness({ env: { TWILIO_ACCOUNT_SID: '' } });
  // Force an unconfigured provider to mirror a real deployment without secrets.
  const unconfigured = createHarness({
    provider: {
      name: 'twilio-verify',
      channel: 'sms',
      configured: false,
      mode: 'unconfigured',
      startVerification: async () => {
        throw new ProviderError(ProviderErrorKind.NOT_CONFIGURED, 'not configured');
      },
      checkVerification: async () => {
        throw new ProviderError(ProviderErrorKind.NOT_CONFIGURED, 'not configured');
      },
      cancelVerification: async () => false,
    },
  });

  const res = await sendOtp(unconfigured.agent);
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'provider_not_configured');
  assert.match(res.body.error.message, /never fakes a successful verification/i);
  assert.equal(res.headers['set-cookie'], undefined, 'no session may be created');
  assert.equal(unconfigured.store.sessions.size, 0);
  assert.equal(h.provider.starts.length, 0);
});

test('maps provider failures to safe, actionable API errors', async () => {
  const cases = [
    {
      error: new ProviderError(ProviderErrorKind.RATE_LIMITED, 'Max send attempts', {
        twilioCode: 60203,
        httpStatus: 429,
        retryAfterSeconds: 120,
      }),
      status: 429,
      code: 'provider_rate_limited',
    },
    {
      error: new ProviderError(ProviderErrorKind.INVALID_NUMBER, 'Invalid parameter', {
        twilioCode: 60200,
      }),
      status: 400,
      code: 'invalid_phone',
    },
    {
      error: new ProviderError(ProviderErrorKind.UNSUPPORTED_NUMBER, 'Landline', {
        twilioCode: 60205,
      }),
      status: 400,
      code: 'unsupported_number',
    },
    {
      error: new ProviderError(ProviderErrorKind.AUTH_FAILED, 'Authenticate', {
        twilioCode: 20003,
      }),
      status: 502,
      code: 'provider_auth_failed',
    },
    {
      error: new ProviderError(ProviderErrorKind.NETWORK, 'socket hang up'),
      status: 502,
      code: 'provider_unavailable',
    },
    {
      error: new ProviderError(ProviderErrorKind.TIMEOUT, 'timeout of 12000ms exceeded'),
      status: 502,
      code: 'provider_unavailable',
    },
  ];

  for (const testCase of cases) {
    const h = createHarness();
    h.provider.nextStartError = testCase.error;
    const res = await sendOtp(h.agent);

    assert.equal(res.status, testCase.status, testCase.code);
    assert.equal(res.body.error.code, testCase.code);
    assert.doesNotMatch(JSON.stringify(res.body), /Max send attempts|socket hang up|Authenticate/);
    assert.equal(h.store.sessions.size, 0, 'failed sends must not create sessions');
  }
});

test('honours the allowed-country allow-list', async () => {
  const h = createHarness({ env: { OTP_ALLOWED_COUNTRIES: 'US,GB' } });

  const blocked = await sendOtp(h.agent, { phone: '9876543210', country: 'IN' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'country_not_allowed');
  assert.equal(h.provider.starts.length, 0);

  const allowed = await sendOtp(h.agent, { phone: '2025550123', country: 'US' });
  assert.equal(allowed.status, 200);
  assert.deepEqual(h.provider.starts, ['+12025550123']);
});

test('a verified session cannot silently start a new verification', async () => {
  const h = createHarness();
  await sendOtp(h.agent);
  const verified = await verifyOtp(h.agent, '123456');
  assert.equal(verified.status, 200);

  const res = await sendOtp(h.agent);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'already_verified');
  assert.equal(h.provider.starts.length, 1);
});

test('rejects non-JSON bodies with 415', async () => {
  const h = createHarness();
  const res = await h.agent
    .post('/api/otp/send')
    .set('Content-Type', 'text/plain')
    .send('phone=9876543210');

  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, 'unsupported_media_type');
});
