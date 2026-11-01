/**
 * Twilio Verify provider: real mapping logic, driven by a stubbed SDK client.
 * (Only the SDK transport is stubbed — the module under test is the shipped one.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTwilioVerifyProvider, ProviderErrorKind } from '../src/services/verify-provider.js';
import { createLogger } from '../src/logger.js';
import { testConfig } from './helpers.js';

const logger = createLogger({ level: 'silent' });

const CREDENTIALS = {
  TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'auth-token',
  TWILIO_VERIFY_SERVICE_SID: `VA${'b'.repeat(32)}`,
};

function restError(code, status, message = 'Twilio error') {
  return Object.assign(new Error(message), { code, status });
}

function buildProvider({ start, check, cancel, fetch, configEnv = {} } = {}) {
  const service = {
    verifications: Object.assign(
      (sid) => ({
        update: cancel
          ? async (payload) => cancel(sid, payload)
          : async () => ({ sid, status: 'canceled' }),
      }),
      { create: start ?? (async () => ({ sid: 'VE1', status: 'pending', channel: 'sms' })) },
    ),
    verificationChecks: { create: check ?? (async () => ({ sid: 'VE1', status: 'approved', valid: true })) },
    fetch: fetch ?? (async () => ({ sid: 'VA1', friendlyName: 'OTP Shield', codeLength: 6, lookupEnabled: true })),
  };
  const client = { verify: { v2: { services: () => service } } };
  const config = testConfig({ ...CREDENTIALS, ...configEnv });
  return createTwilioVerifyProvider(config, logger, { client });
}

test('reports itself as configured with real credentials and calls the SMS channel', async () => {
  const calls = [];
  const provider = buildProvider({
    start: async (payload) => {
      calls.push(payload);
      return { sid: 'VE123', status: 'pending', channel: 'sms', valid: false };
    },
  });

  assert.equal(provider.configured, true);
  assert.equal(provider.channel, 'sms');

  const result = await provider.startVerification({ to: '+919876543210' });
  assert.deepEqual(calls, [{ to: '+919876543210', channel: 'sms' }]);
  assert.equal(result.sid, 'VE123');
  assert.equal(result.status, 'pending');
  assert.equal(result.channel, 'sms');
});

test('an approved check is passed through as approved', async () => {
  const provider = buildProvider({
    check: async ({ to, code }) => ({ sid: 'VE1', status: code === '123456' ? 'approved' : 'pending', valid: code === '123456' }),
  });

  const approved = await provider.checkVerification({ to: '+919876543210', code: '123456' });
  assert.equal(approved.status, 'approved');

  const pending = await provider.checkVerification({ to: '+919876543210', code: '000000' });
  assert.equal(pending.status, 'pending');
});

test('maps Twilio error codes to provider error kinds', async () => {
  const cases = [
    [60200, 400, ProviderErrorKind.INVALID_NUMBER],
    [60202, 429, ProviderErrorKind.MAX_ATTEMPTS],
    [60203, 429, ProviderErrorKind.RATE_LIMITED],
    [60205, 400, ProviderErrorKind.UNSUPPORTED_NUMBER],
    [60220, 403, ProviderErrorKind.BLOCKED],
    [60223, 403, ProviderErrorKind.CHANNEL_DISABLED],
    [60238, 403, ProviderErrorKind.BLOCKED],
    [20003, 401, ProviderErrorKind.AUTH_FAILED],
    [20404, 404, ProviderErrorKind.NOT_FOUND],
    [20429, 429, ProviderErrorKind.RATE_LIMITED],
  ];

  for (const [code, status, expectedKind] of cases) {
    const provider = buildProvider({
      start: async () => {
        throw restError(code, status, `Twilio says ${code}`);
      },
    });

    await assert.rejects(
      () => provider.startVerification({ to: '+919876543210' }),
      (error) => {
        assert.equal(error.kind, expectedKind, `code ${code}`);
        assert.equal(error.twilioCode, code);
        assert.equal(error.expose, false, 'provider errors are never exposed to clients');
        return true;
      },
    );
  }
});

test('classifies transport failures without a Twilio code', async () => {
  const cases = [
    [{ code: 'ETIMEDOUT' }, ProviderErrorKind.TIMEOUT],
    [{ code: 'ECONNABORTED' }, ProviderErrorKind.TIMEOUT],
    [{ code: 'ECONNRESET' }, ProviderErrorKind.NETWORK],
    [{ code: 'ENOTFOUND' }, ProviderErrorKind.NETWORK],
    [{ status: 401 }, ProviderErrorKind.AUTH_FAILED],
    [{ status: 503 }, ProviderErrorKind.NETWORK],
    [{ status: 429 }, ProviderErrorKind.RATE_LIMITED],
    [{}, ProviderErrorKind.UNKNOWN],
  ];

  for (const [shape, expectedKind] of cases) {
    const provider = buildProvider({
      check: async () => {
        throw Object.assign(new Error('boom'), shape);
      },
    });

    await assert.rejects(
      () => provider.checkVerification({ to: '+919876543210', code: '123456' }),
      (error) => error.kind === expectedKind,
    );
  }
});

test('cancel sends status=canceled and tolerates an already-gone verification', async () => {
  const updates = [];
  const provider = buildProvider({
    cancel: async (sid, payload) => {
      updates.push({ sid, payload });
      return { sid, status: payload.status };
    },
  });

  assert.equal(await provider.cancelVerification('VE123'), true);
  assert.deepEqual(updates, [{ sid: 'VE123', payload: { status: 'canceled' } }]);
  assert.equal(await provider.cancelVerification(undefined), false);

  const gone = buildProvider({
    cancel: async () => {
      throw restError(20404, 404);
    },
  });
  assert.equal(await gone.cancelVerification('VE999'), false);
});

test('healthCheck reports the Verify Service configuration', async () => {
  const provider = buildProvider();
  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
  assert.equal(health.codeLength, 6);
  assert.equal(health.sidSuffix, 'VA1'.slice(-4));
});

test('an unconfigured provider refuses every operation instead of faking success', async () => {
  const config = testConfig({
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_VERIFY_SERVICE_SID: '',
  });
  const provider = createTwilioVerifyProvider(config, logger);

  assert.equal(provider.configured, false);
  assert.equal(provider.mode, 'unconfigured');
  await assert.rejects(
    () => provider.startVerification({ to: '+919876543210' }),
    (error) => error.kind === ProviderErrorKind.NOT_CONFIGURED,
  );
  await assert.rejects(
    () => provider.checkVerification({ to: '+919876543210', code: '123456' }),
    (error) => error.kind === ProviderErrorKind.NOT_CONFIGURED,
  );
  assert.equal(await provider.cancelVerification('VE1'), false);
  assert.equal((await provider.healthCheck()).ok, false);
});

test('supports scoped API key credentials', async () => {
  const config = testConfig({
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_API_KEY_SID: `SK${'c'.repeat(32)}`,
    TWILIO_API_KEY_SECRET: 'api-key-secret',
    TWILIO_VERIFY_SERVICE_SID: `VA${'b'.repeat(32)}`,
  });

  assert.equal(config.twilio.configured, true);
  assert.equal(config.twilio.usingApiKey, true);
  const provider = createTwilioVerifyProvider(config, logger, {
    client: { verify: { v2: { services: () => ({}) } } },
  });
  assert.equal(provider.mode, 'api-key');
});
