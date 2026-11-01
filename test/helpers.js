/**
 * Test harness.
 *
 * NOTE: `FakeVerifyProvider` is a *test double* used only by the automated
 * test-suite so tests are deterministic and never send real SMS. It exists only
 * under test/ and is never imported by the application. Production always
 * constructs the real Twilio Verify provider from `src/services/verify-provider.js`.
 */
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { MemorySessionStore } from '../src/services/session-store.js';
import { ProviderError, ProviderErrorKind } from '../src/services/verify-provider.js';

export class FakeVerifyProvider {
  constructor({ code = '123456', configured = true } = {}) {
    this.name = 'twilio-verify';
    this.channel = 'sms';
    this.mode = 'test-double';
    this.configured = configured;
    this.code = code;
    this.starts = [];
    this.checks = [];
    this.cancels = [];
    this.nextStartError = null;
    this.nextCheckError = null;
    this.verifications = new Map();
    this.counter = 0;
  }

  async startVerification({ to }) {
    this.starts.push(to);
    if (this.nextStartError) {
      const error = this.nextStartError;
      this.nextStartError = null;
      throw error;
    }
    this.counter += 1;
    const sid = `VE${String(this.counter).padStart(32, '0')}`;
    this.verifications.set(to, { sid, status: 'pending' });
    return { sid, status: 'pending', channel: 'sms' };
  }

  async checkVerification({ to, code }) {
    this.checks.push({ to, code });
    if (this.nextCheckError) {
      const error = this.nextCheckError;
      this.nextCheckError = null;
      throw error;
    }
    const verification = this.verifications.get(to);
    if (!verification || verification.status !== 'pending') {
      // Mirrors Twilio's 20404 for an approved/expired/cancelled verification.
      throw new ProviderError(ProviderErrorKind.NOT_FOUND, 'Verification not found', {
        twilioCode: 20404,
        httpStatus: 404,
      });
    }
    if (code === this.code) {
      verification.status = 'approved';
      return { sid: verification.sid, status: 'approved', valid: true };
    }
    return { sid: verification.sid, status: 'pending', valid: false };
  }

  async cancelVerification(sid) {
    this.cancels.push(sid);
    return true;
  }

  async healthCheck() {
    return { ok: true, friendlyName: 'Test Service', codeLength: 6, lookupEnabled: true };
  }
}

export const TEST_SECRET = 'test-session-secret-0123456789abcdef';

export function testConfig(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET: TEST_SECRET,
    // Deterministic limits, overridable per test file.
    RATE_LIMIT_ENABLED: 'false',
    ...env,
  });
}

/**
 * Build an isolated app + agent + controllable clock.
 * @param {{ env?: Record<string,string>, provider?: any, config?: any }} [options]
 */
export function createHarness({ env = {}, provider, config } = {}) {
  const clock = { current: Date.parse('2026-01-01T12:00:00.000Z') };
  const now = () => clock.current;
  const cfg = config ?? testConfig(env);
  const logger = createLogger({ level: 'silent' });
  const fakeProvider = provider ?? new FakeVerifyProvider();
  const store = new MemorySessionStore({ ttlMs: cfg.session.ttlSeconds * 1000, now });
  const app = createApp({ config: cfg, provider: fakeProvider, store, logger, now });
  const agent = request.agent(app);

  return {
    app,
    agent,
    config: cfg,
    provider: fakeProvider,
    store,
    clock,
    now,
    /** Advance the injected clock by a number of seconds. */
    advance(seconds) {
      clock.current += seconds * 1000;
    },
    close() {
      app.locals.close?.();
    },
  };
}

/** POST /api/otp/send with a default Indian number unless overridden. */
export function sendOtp(agent, body = { phone: '9876543210', country: 'IN' }) {
  return agent.post('/api/otp/send').send(body);
}

export function verifyOtp(agent, code, extra = {}) {
  return agent.post('/api/otp/verify').send({ code, ...extra });
}

export { ProviderError, ProviderErrorKind };
