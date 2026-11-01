/** Environment validation and the public (browser-safe) configuration surface. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, publicConfig, countryOptions, ConfigurationError } from '../src/config.js';

const VALID_TWILIO = {
  TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'auth-token',
  TWILIO_VERIFY_SERVICE_SID: `VA${'b'.repeat(32)}`,
};

test('development config is usable without credentials but reports what is missing', () => {
  const config = loadConfig({ NODE_ENV: 'development' });

  assert.equal(config.twilio.configured, false);
  assert.equal(config.twilio.missingCredentials.length, 3);
  assert.ok(config.session.secret.length >= 32, 'an ephemeral dev secret is generated');
  assert.ok(config.warnings.some((warning) => /SESSION_SECRET/.test(warning)));
});

test('production requires a strong SESSION_SECRET', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', ...VALID_TWILIO }),
    (error) => {
      assert.ok(error instanceof ConfigurationError);
      assert.ok(error.details.some((detail) => detail.includes('SESSION_SECRET')));
      return true;
    },
  );

  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'too-short', ...VALID_TWILIO }),
    (error) => error.details.some((detail) => /at least 32 characters/.test(detail)),
  );

  const ok = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), ...VALID_TWILIO });
  assert.equal(ok.session.secureCookie, true);
  assert.equal(ok.twilio.configured, true);
});

test('validates the Verify Service SID format', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'development',
        TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_VERIFY_SERVICE_SID: 'not-a-sid',
      }),
    (error) => error.details.some((detail) => /starting with "VA"/.test(detail)),
  );
});

test('accepts an API key pair in place of the auth token', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_API_KEY_SID: `SK${'c'.repeat(32)}`,
    TWILIO_API_KEY_SECRET: 'secret',
    TWILIO_VERIFY_SERVICE_SID: `VA${'b'.repeat(32)}`,
  });

  assert.equal(config.twilio.configured, true);
  assert.equal(config.twilio.usingApiKey, true);
});

test('rejects unknown countries in the allow-list', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development', OTP_ALLOWED_COUNTRIES: 'IN,ZZ' }),
    (error) => error.details.some((detail) => /unsupported ISO country code/.test(detail)),
  );
});

test('clamps numeric settings and rejects nonsense', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'development', PORT: 'abc' }), ConfigurationError);
  assert.throws(() => loadConfig({ NODE_ENV: 'development', PORT: '99999' }), ConfigurationError);
  const config = loadConfig({
    NODE_ENV: 'development',
    OTP_TTL_SECONDS: '600',
    OTP_RESEND_COOLDOWN_SECONDS: '45',
    OTP_MAX_VERIFY_ATTEMPTS: '3',
  });
  assert.equal(config.otp.resendCooldownSeconds, 45);
  assert.equal(config.otp.maxVerifyAttempts, 3);
});

test('warns when the configured TTL may not match the Twilio service TTL', () => {
  const config = loadConfig({ NODE_ENV: 'development', OTP_TTL_SECONDS: '300' });
  assert.ok(config.warnings.some((warning) => /Twilio Verify Service uses the same code TTL/.test(warning)));
});

test('publicConfig exposes only browser-safe values', () => {
  const config = loadConfig({ NODE_ENV: 'development', ...VALID_TWILIO });
  const publicView = publicConfig(config);
  const serialised = JSON.stringify(publicView);

  assert.equal(publicView.provider.configured, true);
  assert.equal(publicView.otp.codeLength, 6);
  assert.equal(publicView.otp.ttlSeconds, 600);
  assert.doesNotMatch(serialised, /AC[0-9a-f]{32}|VA[0-9a-f]{32}|auth-token/);
  assert.equal(publicView.session, undefined);
  assert.equal(publicView.twilio, undefined);
});

test('country options are complete, sorted and include dial codes', () => {
  const countries = countryOptions();

  assert.ok(countries.length > 200);
  assert.equal(countries[0].iso, 'IN');
  assert.equal(countries.find((country) => country.iso === 'US').dialCode, '+1');
  assert.equal(countries.find((country) => country.iso === 'IN').dialCode, '+91');
  assert.ok(countries.every((country) => /^\+\d+$/.test(country.dialCode)));
  assert.ok(countries.every((country) => country.name.length > 0));
});
