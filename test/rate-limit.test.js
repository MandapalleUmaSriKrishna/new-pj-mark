/** Per-IP rate limits on sending and checking codes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, sendOtp, verifyOtp } from './helpers.js';

const LIMITS = {
  RATE_LIMIT_ENABLED: 'true',
  RATE_LIMIT_GLOBAL_PER_IP: '1000',
  RATE_LIMIT_SEND_WINDOW_SECONDS: '60',
  RATE_LIMIT_SEND_PER_IP: '2',
  RATE_LIMIT_VERIFY_WINDOW_SECONDS: '60',
  RATE_LIMIT_VERIFY_PER_IP: '2',
};

test('send endpoint stops the client after the configured per-IP limit', async () => {
  const h = createHarness({ env: LIMITS });

  const first = await sendOtp(h.agent, { phone: '9876543210', country: 'IN' });
  const second = await sendOtp(h.agent, { phone: '2025550123', country: 'US' });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const third = await sendOtp(h.agent, { phone: '7911123456', country: 'GB' });
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'rate_limited');
  assert.match(third.body.error.message, /Too many verification codes/i);
  assert.ok(third.body.error.retryAfterSeconds > 0);
  assert.ok(Number(third.headers['retry-after']) > 0);
  assert.ok(third.headers['ratelimit'], 'standard RateLimit headers are sent');
  assert.equal(h.provider.starts.length, 2, 'no provider call once rate limited');
});

test('verify endpoint stops code guessing after the configured per-IP limit', async () => {
  const h = createHarness({ env: LIMITS });
  await sendOtp(h.agent);

  const first = await verifyOtp(h.agent, '000000');
  const second = await verifyOtp(h.agent, '111111');
  assert.equal(first.status, 422);
  assert.equal(second.status, 422);

  const third = await verifyOtp(h.agent, '123456');
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'rate_limited');
  assert.equal(third.body.data, undefined);
  assert.equal(h.provider.checks.length, 2);
});

test('the global API limiter protects every endpoint', async () => {
  const h = createHarness({
    env: {
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_GLOBAL_PER_IP: '3',
      RATE_LIMIT_GLOBAL_WINDOW_SECONDS: '60',
      RATE_LIMIT_SEND_PER_IP: '100',
      RATE_LIMIT_VERIFY_PER_IP: '100',
    },
  });

  const statuses = [];
  for (let index = 0; index < 5; index += 1) {
    const res = await h.agent.get('/api/session');
    statuses.push(res.status);
  }

  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.deepEqual(statuses.slice(3), [429, 429]);
});

test('health checks are exempt from rate limiting', async () => {
  const h = createHarness({
    env: {
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_GLOBAL_PER_IP: '2',
      RATE_LIMIT_GLOBAL_WINDOW_SECONDS: '60',
    },
  });

  for (let index = 0; index < 6; index += 1) {
    const res = await h.agent.get('/api/health');
    assert.equal(res.status, 200);
  }
});

test('rate limiting can be disabled for trusted environments', async () => {
  const h = createHarness({ env: { RATE_LIMIT_ENABLED: 'false' } });

  for (let index = 0; index < 6; index += 1) {
    const res = await h.agent.get('/api/session');
    assert.equal(res.status, 200);
  }
});

test('parallel sends for the same number cannot both pass the cooldown', async () => {
  const h = createHarness();
  // Slow the provider down so both requests are in flight at the same time.
  const original = h.provider.startVerification.bind(h.provider);
  h.provider.startVerification = async (args) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return original(args);
  };

  const [a, b] = await Promise.all([sendOtp(h.agent), sendOtp(h.agent)]);
  const statuses = [a.status, b.status].sort();

  assert.deepEqual(statuses, [200, 429]);
  const rejected = a.status === 429 ? a : b;
  assert.equal(rejected.body.error.code, 'resend_too_soon');
  assert.equal(h.provider.starts.length, 1, 'exactly one SMS was requested');
});
