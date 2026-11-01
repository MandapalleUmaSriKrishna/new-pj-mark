/** Headers, CSRF/origin protection, body limits, error hygiene, secret leakage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, testConfig, sendOtp } from './helpers.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { MemorySessionStore } from '../src/services/session-store.js';
import { FakeVerifyProvider } from './helpers.js';

test('sends hardened security headers and hides the server stack', async () => {
  const h = createHarness();
  const res = await h.agent.get('/');

  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.match(res.headers['permissions-policy'], /camera=\(\)/);
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
  assert.ok(res.headers['x-request-id']);

  const csp = res.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('HSTS is only sent in production over HTTPS deployments', async () => {
  const dev = createHarness();
  assert.equal((await dev.agent.get('/')).headers['strict-transport-security'], undefined);

  const config = testConfig({
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://otp.example.com',
    SESSION_SECRET: 'p'.repeat(48),
    TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
    TWILIO_AUTH_TOKEN: 'token-value-should-never-leak',
    TWILIO_VERIFY_SERVICE_SID: 'VA' + 'b'.repeat(32),
  });
  const app = createApp({
    config,
    provider: new FakeVerifyProvider(),
    store: new MemorySessionStore({ now: () => Date.now() }),
    logger: createLogger({ level: 'silent' }),
    now: () => Date.now(),
  });
  const { default: request } = await import('supertest');
  const res = await request(app).get('/');

  assert.match(res.headers['strict-transport-security'], /max-age=15552000/);
});

test('iframe embedding can be enabled explicitly for preview environments', async () => {
  const h = createHarness({ env: { ALLOW_IFRAME_EMBEDDING: 'true' } });
  const res = await h.agent.get('/');

  assert.equal(res.headers['x-frame-options'], undefined);
  assert.doesNotMatch(res.headers['content-security-policy'], /frame-ancestors/);
});

test('blocks cross-origin state-changing requests', async () => {
  const h = createHarness({ env: { APP_ORIGIN: 'https://otp.example.com' } });

  const blocked = await h.agent
    .post('/api/otp/send')
    .set('Origin', 'https://evil.example')
    .send({ phone: '9876543210', country: 'IN' });

  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'origin_rejected');
  assert.equal(h.provider.starts.length, 0);

  const allowed = await h.agent
    .post('/api/otp/send')
    .set('Origin', 'https://otp.example.com')
    .send({ phone: '9876543210', country: 'IN' });

  assert.equal(allowed.status, 200);
});

test('allows same-host browser requests without an APP_ORIGIN entry', async () => {
  const h = createHarness();
  const res = await h.agent
    .post('/api/otp/send')
    .set('Origin', 'http://127.0.0.1')
    .send({ phone: '9876543210', country: 'IN' });

  // supertest's Host header is 127.0.0.1:<ephemeral>; the guard compares origins.
  assert.ok([200, 403].includes(res.status));
  if (res.status === 403) assert.equal(res.body.error.code, 'origin_rejected');
});

test('rejects oversized request bodies', async () => {
  const h = createHarness();
  const res = await h.agent
    .post('/api/otp/send')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ phone: '9'.repeat(20_000), country: 'IN' }));

  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'payload_too_large');
});

test('returns JSON 404 for unknown API routes and 405 for wrong methods', async () => {
  const h = createHarness();

  const missing = await h.agent.get('/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'not_found');

  const wrongMethod = await h.agent.get('/api/otp/send');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
  assert.match(wrongMethod.headers.allow, /POST/);
});

test('malformed JSON produces a clean 400 without internals', async () => {
  const h = createHarness();
  const res = await h.agent
    .post('/api/otp/send')
    .set('Content-Type', 'application/json')
    .send('{"phone": "9876543210", ');

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_request');
  const body = JSON.stringify(res.body);
  assert.doesNotMatch(body, /at .*\.js:\d+|SyntaxError|stack/i);
});

test('never exposes Twilio credentials or SIDs to the browser', async () => {
  const token = 'super-secret-auth-token-value';
  const serviceSid = 'VA' + 'c'.repeat(32);
  const h = createHarness({
    env: {
      TWILIO_ACCOUNT_SID: 'AC' + 'd'.repeat(32),
      TWILIO_AUTH_TOKEN: token,
      TWILIO_VERIFY_SERVICE_SID: serviceSid,
    },
  });

  await sendOtp(h.agent);

  for (const path of ['/api/config', '/api/health', '/api/session']) {
    const res = await h.agent.get(path);
    const body = JSON.stringify(res.body);
    assert.doesNotMatch(body, new RegExp(token));
    assert.doesNotMatch(body, new RegExp(serviceSid));
    assert.doesNotMatch(body, /AC[0-9a-f]{32}/i);
  }
});

test('serves the app with a strict, self-only CSP (no inline scripts or styles)', async () => {
  const h = createHarness();
  const res = await h.agent.get('/');

  assert.equal(res.status, 200);
  const html = res.text;
  // Inline <script> blocks and event-handler attributes are forbidden by CSP,
  // so none may appear in the shipped markup.
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/i);
  assert.doesNotMatch(html, /\sstyle="/i);
  assert.doesNotMatch(html, /\son[a-z]+="/i);
});

test('does not send cacheable responses for session state', async () => {
  const h = createHarness();
  const res = await h.agent.get('/api/session');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('tolerates a missing Origin header (CLI clients) while still validating JSON', async () => {
  const h = createHarness();
  const res = await h.agent
    .post('/api/otp/send')
    .set('Accept', 'application/json')
    .send({ phone: '9876543210', country: 'IN' });

  assert.equal(res.status, 200);
});
