/** Code checking: success only on provider approval, attempt caps, abuse cases. */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createHarness, sendOtp, verifyOtp, ProviderError, ProviderErrorKind } from './helpers.js';

test('verifying without a session is refused', async () => {
  const h = createHarness();
  const res = await verifyOtp(h.agent, '123456');

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'no_active_verification');
  assert.equal(h.provider.checks.length, 0);
});

test('a correct code verifies the session (provider approved)', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  const res = await verifyOtp(h.agent, '123456');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.verified, true);
  assert.equal(res.body.data.phone, '+919876543210');
  assert.equal(res.body.data.phoneFormatted, '+91 98765 43210');
  assert.ok(res.body.data.verifiedAt);
  assert.equal(res.body.data.verification.status, 'approved');
  assert.deepEqual(h.provider.checks, [{ to: '+919876543210', code: '123456' }]);

  // The verified state is server-side and survives subsequent requests.
  const status = await h.agent.get('/api/session');
  assert.equal(status.body.data.verified, true);
  assert.equal(status.body.data.phone, '+919876543210');
  assert.ok(status.body.data.sessionExpiresAt);
});

test('a wrong code never verifies and consumes an attempt', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await verifyOtp(h.agent, '000000');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'invalid_code');
    assert.equal(res.body.error.details.attemptsRemaining, 5 - attempt);
    assert.equal(res.body.data, undefined);
  }

  const status = await h.agent.get('/api/session');
  assert.equal(status.body.data.verified, false, 'still unverified after four wrong codes');
});

test('the fifth wrong code exhausts attempts and the sixth is refused without a provider call', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await verifyOtp(h.agent, '000000');
  }

  const fifth = await verifyOtp(h.agent, '000000');
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.error.code, 'attempts_exhausted');

  const callsAfterFifth = h.provider.checks.length;
  assert.equal(callsAfterFifth, 5);

  const sixth = await verifyOtp(h.agent, '000000');
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error.code, 'attempts_exhausted');
  assert.equal(h.provider.checks.length, callsAfterFifth, 'no extra provider calls once locked');

  // Even the correct code is refused once the verification is burned.
  const correct = await verifyOtp(h.agent, '123456');
  assert.equal(correct.status, 429);
  assert.equal(correct.body.error.code, 'attempts_exhausted');
});

test('a correct code after wrong attempts still verifies (within the cap)', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  await verifyOtp(h.agent, '000000');
  await verifyOtp(h.agent, '111111');
  const res = await verifyOtp(h.agent, '123456');

  assert.equal(res.status, 200);
  assert.equal(res.body.data.verified, true);
});

test('a deliberately forged success payload from the client is ignored', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  const res = await verifyOtp(h.agent, '000000', {
    verified: true,
    status: 'approved',
    phone: '+919876543210',
  });

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'invalid_code');

  const status = await h.agent.get('/api/session');
  assert.equal(status.body.data.verified, false);
});

test('rejects malformed codes before contacting the provider', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  for (const code of ['12345', '1234567', 'abcdef', '', null, 123456]) {
    const res = await verifyOtp(h.agent, code);
    assert.equal(res.status, 400, `code ${JSON.stringify(code)} should be rejected`);
    assert.equal(res.body.error.code, 'invalid_request');
  }
  assert.equal(h.provider.checks.length, 0);
});

test('provider 60202 (max attempts) is surfaced as exhaustion', async () => {
  const h = createHarness();
  await sendOtp(h.agent);
  h.provider.nextCheckError = new ProviderError(
    ProviderErrorKind.MAX_ATTEMPTS,
    'Max check attempts reached',
    { twilioCode: 60202, httpStatus: 429 },
  );

  const res = await verifyOtp(h.agent, '123456');
  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, 'attempts_exhausted');

  const again = await verifyOtp(h.agent, '123456');
  assert.equal(again.status, 429);
  assert.equal(h.provider.checks.length, 1);
  assert.equal((await h.agent.get('/api/session')).body.data.verified, false);
});

test('provider 20404 (verification gone) is surfaced as no longer valid', async () => {
  const h = createHarness();
  await sendOtp(h.agent);
  h.provider.nextCheckError = new ProviderError(
    ProviderErrorKind.NOT_FOUND,
    'The requested resource was not found',
    { twilioCode: 20404, httpStatus: 404 },
  );

  const res = await verifyOtp(h.agent, '123456');
  assert.equal(res.status, 410);
  assert.equal(res.body.error.code, 'verification_not_found');
  assert.equal((await h.agent.get('/api/session')).body.data.verified, false);
});

test('a provider outage never verifies the user and never burns an attempt', async () => {
  const h = createHarness();
  await sendOtp(h.agent);
  h.provider.nextCheckError = new ProviderError(ProviderErrorKind.NETWORK, 'ECONNRESET');

  const res = await verifyOtp(h.agent, '123456');
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'provider_unavailable');
  assert.doesNotMatch(res.body.error.message, /ECONNRESET/);

  const status = await h.agent.get('/api/session');
  assert.equal(status.body.data.verified, false);
  assert.equal(status.body.data.verification.attemptsRemaining, 5, 'attempts are preserved');

  const retry = await verifyOtp(h.agent, '123456');
  assert.equal(retry.status, 200);
});

test('an expired code is rejected locally, cancelled at Twilio and cannot verify', async () => {
  const h = createHarness({ env: { OTP_TTL_SECONDS: '120' } });
  await sendOtp(h.agent);
  const sid = h.provider.verifications.get('+919876543210').sid;

  h.advance(121);
  const res = await verifyOtp(h.agent, '123456');

  assert.equal(res.status, 410);
  assert.equal(res.body.error.code, 'code_expired');
  assert.equal(h.provider.checks.length, 0, 'no provider check for an expired code');
  assert.deepEqual(h.provider.cancels, [sid], 'the code is cancelled at the provider');

  const status = await h.agent.get('/api/session');
  assert.equal(status.body.data.verified, false);
  assert.equal(status.body.data.verification.status, 'expired');
  assert.equal(status.body.data.verification.expiresInSeconds, 0);

  // And a repeat attempt stays expired.
  const again = await verifyOtp(h.agent, '123456');
  assert.equal(again.status, 410);
});

test('expired codes can be replaced with a fresh one that works', async () => {
  const h = createHarness({ env: { OTP_TTL_SECONDS: '120' } });
  await sendOtp(h.agent);
  h.advance(121);
  await verifyOtp(h.agent, '123456');

  const resend = await h.agent.post('/api/otp/resend');
  assert.equal(resend.status, 200);

  const res = await verifyOtp(h.agent, '123456');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.verified, true);
});

test('verification state cannot be forged with a tampered cookie', async () => {
  const h = createHarness();
  await sendOtp(h.agent);

  // A fresh client with ONLY the forged cookie (the agent would also send the
  // legitimate cookie it received earlier).
  const forged = request(h.app);
  const res = await forged
    .get('/api/session')
    .set('Cookie', 'otp_shield_sid=s%3Aforged-session-id.signature');

  assert.equal(res.status, 200);
  assert.equal(res.body.data.verified, false);
  assert.equal(res.body.data.verification, null);

  const verify = await forged
    .post('/api/otp/verify')
    .set('Cookie', 'otp_shield_sid=s%3Aforged-session-id.signature')
    .send({ code: '123456' });

  assert.equal(verify.status, 409);
  assert.equal(verify.body.error.code, 'no_active_verification');
});

test('profile is a real access-control boundary between verified and unverified', async () => {
  const h = createHarness();

  const anonymous = await h.agent.get('/api/profile');
  assert.equal(anonymous.status, 403);
  assert.equal(anonymous.body.error.code, 'verification_required');
  assert.equal(anonymous.body.data, undefined);

  await sendOtp(h.agent);
  const pending = await h.agent.get('/api/profile');
  assert.equal(pending.status, 403, 'a pending code does not unlock the profile');

  await verifyOtp(h.agent, '123456');
  const verified = await h.agent.get('/api/profile');
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.verified, true);
  assert.equal(verified.body.data.profile.phone, '+919876543210');
  assert.equal(verified.body.data.profile.provider, 'Twilio Verify');
  assert.ok(verified.body.data.profile.benefits.length > 0);
  assert.match(verified.body.data.profile.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('logout revokes the session and the profile locks again', async () => {
  const h = createHarness();
  await sendOtp(h.agent);
  await verifyOtp(h.agent, '123456');
  assert.equal((await h.agent.get('/api/profile')).status, 200);

  const logout = await h.agent.post('/api/session/logout');
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'].join(';'), /Expires=Thu, 01 Jan 1970|Max-Age=0/);

  const profile = await h.agent.get('/api/profile');
  assert.equal(profile.status, 403);
  assert.equal((await h.agent.get('/api/session')).body.data.verified, false);
});

test('logout cancels a pending verification at the provider', async () => {
  const h = createHarness();
  await sendOtp(h.agent);
  const sid = h.provider.verifications.get('+919876543210').sid;

  await h.agent.post('/api/session/logout');
  assert.deepEqual(h.provider.cancels, [sid]);
});

test('a session is bound to one number even when a new one is requested', async () => {
  const h = createHarness();
  await sendOtp(h.agent, { phone: '9876543210', country: 'IN' });
  h.advance(31);

  const second = await sendOtp(h.agent, { phone: '2025550123', country: 'US' });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.phoneMasked, '+1••••••0123');

  // The old (Indian) verification is no longer reachable through this session.
  const res = await verifyOtp(h.agent, '123456');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.phone, '+12025550123');
  assert.deepEqual(h.provider.checks.at(-1), { to: '+12025550123', code: '123456' });
});
