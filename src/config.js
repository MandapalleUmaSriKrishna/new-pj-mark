/**
 * Centralised, validated configuration.
 *
 * Every value comes from the environment. Nothing secret is ever read on the
 * client: the browser only ever receives the *public* subset produced by
 * `publicConfig()`.
 */
import { z } from 'zod';
import { getCountries, getCountryCallingCode, isSupportedCountry } from 'libphonenumber-js';
import { randomBytes } from 'node:crypto';

/** Twilio Verify issues 6-digit codes by default; keep the UI and API aligned. */
export const OTP_CODE_LENGTH = 6;

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const intInRange = (min, max, fallback) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected an integer between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return parsed;
    });

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intInRange(1, 65535, 3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  /** Comma separated list of allowed browser origins, e.g. "https://otp.example.com". */
  APP_ORIGIN: z.string().optional().default(''),
  /** Express "trust proxy" setting. Use "1" behind exactly one reverse proxy. */
  TRUST_PROXY: z.string().optional().default(''),
  /** Allow the app to be embedded in an iframe (off by default: clickjacking defence). */
  ALLOW_IFRAME_EMBEDDING: booleanish.default(false),

  TWILIO_ACCOUNT_SID: z.string().trim().default(''),
  TWILIO_AUTH_TOKEN: z.string().trim().default(''),
  TWILIO_API_KEY_SID: z.string().trim().default(''),
  TWILIO_API_KEY_SECRET: z.string().trim().default(''),
  TWILIO_VERIFY_SERVICE_SID: z.string().trim().default(''),
  TWILIO_TIMEOUT_MS: intInRange(1000, 30000, 12000),

  /** Must match the code TTL configured on your Twilio Verify Service (default 600s). */
  OTP_TTL_SECONDS: intInRange(60, 86_400, 600),
  OTP_RESEND_COOLDOWN_SECONDS: intInRange(15, 900, 30),
  OTP_MAX_SENDS_PER_WINDOW: intInRange(1, 20, 5),
  OTP_SEND_WINDOW_SECONDS: intInRange(60, 86_400, 3600),
  OTP_MAX_VERIFY_ATTEMPTS: intInRange(1, 5, 5),
  OTP_DEFAULT_COUNTRY: z.string().trim().toUpperCase().default('IN'),
  OTP_ALLOWED_COUNTRIES: csv,

  SESSION_SECRET: z.string().default(''),
  SESSION_TTL_SECONDS: intInRange(300, 2_592_000, 86_400),

  RATE_LIMIT_ENABLED: booleanish.default(true),
  RATE_LIMIT_GLOBAL_WINDOW_SECONDS: intInRange(60, 3600, 900),
  RATE_LIMIT_GLOBAL_PER_IP: intInRange(1, 10_000, 300),
  RATE_LIMIT_SEND_WINDOW_SECONDS: intInRange(60, 3600, 900),
  RATE_LIMIT_SEND_PER_IP: intInRange(1, 1000, 12),
  RATE_LIMIT_VERIFY_WINDOW_SECONDS: intInRange(60, 3600, 900),
  RATE_LIMIT_VERIFY_PER_IP: intInRange(1, 1000, 40),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

/**
 * @typedef {ReturnType<typeof publicConfig>} PublicConfig
 */

export class ConfigurationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ConfigurationError';
    this.details = details;
  }
}

/**
 * Parse and validate environment variables.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigurationError('Invalid environment configuration', details);
  }

  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === 'production';

  // Normalise Twilio Verify Service SID (accept a bare "VA..." value only).
  if (raw.TWILIO_VERIFY_SERVICE_SID && !/^VA[0-9a-f]{32}$/i.test(raw.TWILIO_VERIFY_SERVICE_SID)) {
    throw new ConfigurationError('Invalid environment configuration', [
      'TWILIO_VERIFY_SERVICE_SID: expected a Verify Service SID starting with "VA"',
    ]);
  }

  // Credential handling: prefer a scoped API Key pair over the Account Auth Token.
  const hasApiKey = Boolean(raw.TWILIO_API_KEY_SID && raw.TWILIO_API_KEY_SECRET);
  const hasAuthToken = Boolean(raw.TWILIO_ACCOUNT_SID && raw.TWILIO_AUTH_TOKEN);
  const missingCredentials = [];
  if (!raw.TWILIO_ACCOUNT_SID) missingCredentials.push('TWILIO_ACCOUNT_SID');
  if (!hasApiKey && !hasAuthToken) {
    missingCredentials.push('TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET)');
  }
  if (!raw.TWILIO_VERIFY_SERVICE_SID) missingCredentials.push('TWILIO_VERIFY_SERVICE_SID');
  const twilioConfigured = missingCredentials.length === 0;

  const allowedCountries = [...new Set(raw.OTP_ALLOWED_COUNTRIES)];
  const unknownCountries = allowedCountries.filter((code) => !isSupportedCountry(code));
  if (unknownCountries.length > 0) {
    throw new ConfigurationError('Invalid environment configuration', [
      `OTP_ALLOWED_COUNTRIES: unsupported ISO country code(s) ${unknownCountries.join(', ')}`,
    ]);
  }
  if (!isSupportedCountry(raw.OTP_DEFAULT_COUNTRY)) {
    throw new ConfigurationError('Invalid environment configuration', [
      'OTP_DEFAULT_COUNTRY: unsupported ISO country code',
    ]);
  }

  let sessionSecret = raw.SESSION_SECRET.trim();
  const warnings = [];
  if (sessionSecret.length === 0) {
    if (isProduction) {
      throw new ConfigurationError('Invalid environment configuration', [
        'SESSION_SECRET: required in production (32+ random characters)',
      ]);
    }
    sessionSecret = randomBytes(32).toString('hex');
    warnings.push(
      'SESSION_SECRET is not set — using an ephemeral development secret. Sessions reset when the server restarts.',
    );
  } else if (sessionSecret.length < 32) {
    if (isProduction) {
      throw new ConfigurationError('Invalid environment configuration', [
        'SESSION_SECRET: must be at least 32 characters',
      ]);
    }
    warnings.push('SESSION_SECRET is shorter than 32 characters. Use a longer random secret.');
  }

  const appOrigins = raw.APP_ORIGIN.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (isProduction && appOrigins.length === 0) {
    warnings.push(
      'APP_ORIGIN is not set — cross-origin POST protection is limited to same-host requests.',
    );
  }
  if (isProduction && !twilioConfigured) {
    warnings.push(
      'Twilio Verify credentials are incomplete. SMS delivery is disabled and OTP endpoints return HTTP 503 (no simulated success).',
    );
  }
  if (isProduction && appOrigins.some((origin) => origin.startsWith('http://'))) {
    warnings.push('APP_ORIGIN contains an insecure http:// origin.');
  }
  if (raw.OTP_TTL_SECONDS !== 600) {
    warnings.push(
      `OTP_TTL_SECONDS is ${raw.OTP_TTL_SECONDS}s. Make sure your Twilio Verify Service uses the same code TTL, otherwise the on-screen expiry timer will not match the real code lifetime.`,
    );
  }

  const config = {
    env: raw.NODE_ENV,
    isProduction,
    isTest: raw.NODE_ENV === 'test',
    port: raw.PORT,
    host: raw.HOST,
    appOrigins,
    trustProxy: parseTrustProxy(raw.TRUST_PROXY),
    allowIframeEmbedding: raw.ALLOW_IFRAME_EMBEDDING,

    twilio: {
      configured: twilioConfigured,
      missingCredentials,
      accountSid: raw.TWILIO_ACCOUNT_SID,
      authToken: raw.TWILIO_AUTH_TOKEN,
      apiKeySid: hasApiKey ? raw.TWILIO_API_KEY_SID : '',
      apiKeySecret: hasApiKey ? raw.TWILIO_API_KEY_SECRET : '',
      verifyServiceSid: raw.TWILIO_VERIFY_SERVICE_SID,
      timeoutMs: raw.TWILIO_TIMEOUT_MS,
      usingApiKey: hasApiKey,
    },

    otp: {
      codeLength: OTP_CODE_LENGTH,
      ttlSeconds: raw.OTP_TTL_SECONDS,
      resendCooldownSeconds: raw.OTP_RESEND_COOLDOWN_SECONDS,
      maxSendsPerWindow: raw.OTP_MAX_SENDS_PER_WINDOW,
      sendWindowSeconds: raw.OTP_SEND_WINDOW_SECONDS,
      maxVerifyAttempts: raw.OTP_MAX_VERIFY_ATTEMPTS,
      defaultCountry: raw.OTP_DEFAULT_COUNTRY,
      allowedCountries,
    },

    session: {
      secret: sessionSecret,
      ttlSeconds: raw.SESSION_TTL_SECONDS,
      cookieName: 'otp_shield_sid',
      secureCookie: isProduction,
    },

    rateLimits: {
      enabled: raw.RATE_LIMIT_ENABLED,
      global: {
        windowMs: raw.RATE_LIMIT_GLOBAL_WINDOW_SECONDS * 1000,
        limit: raw.RATE_LIMIT_GLOBAL_PER_IP,
      },
      send: {
        windowMs: raw.RATE_LIMIT_SEND_WINDOW_SECONDS * 1000,
        limit: raw.RATE_LIMIT_SEND_PER_IP,
      },
      verify: {
        windowMs: raw.RATE_LIMIT_VERIFY_WINDOW_SECONDS * 1000,
        limit: raw.RATE_LIMIT_VERIFY_PER_IP,
      },
    },

    logLevel: raw.LOG_LEVEL,
    warnings,
  };

  return config;
}

function parseTrustProxy(value) {
  const normalised = String(value ?? '').trim().toLowerCase();
  if (!normalised || normalised === 'false' || normalised === '0') return false;
  if (normalised === 'true') return true;
  if (/^\d+$/.test(normalised)) return Number(normalised);
  return normalised; // "loopback", "uniquelocal", or a comma separated subnet list
}

/**
 * The only configuration the browser is allowed to see.
 * Never add secrets here.
 */
export function publicConfig(config) {
  return {
    appName: 'OTP Shield',
    environment: config.env,
    provider: {
      name: 'twilio-verify',
      label: 'Twilio Verify',
      configured: config.twilio.configured,
      channel: 'sms',
    },
    otp: {
      codeLength: config.otp.codeLength,
      ttlSeconds: config.otp.ttlSeconds,
      resendCooldownSeconds: config.otp.resendCooldownSeconds,
      maxVerifyAttempts: config.otp.maxVerifyAttempts,
      defaultCountry: config.otp.defaultCountry,
      allowedCountries: config.otp.allowedCountries,
    },
    countsAgainstTwilioLimits: true,
  };
}

/** Country options for the picker, ordered with a few popular destinations first. */
const PRIORITY_COUNTRIES = ['IN', 'US', 'GB', 'AE', 'CA', 'AU', 'SG', 'DE', 'FR', 'NL', 'BR', 'ZA'];

let cachedCountries;
export function countryOptions() {
  if (cachedCountries) return cachedCountries;
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  cachedCountries = getCountries()
    .map((iso) => ({
      iso,
      name: names.of(iso) || iso,
      dialCode: `+${getCountryCallingCode(iso)}`,
    }))
    .sort((a, b) => {
      const aPriority = PRIORITY_COUNTRIES.indexOf(a.iso);
      const bPriority = PRIORITY_COUNTRIES.indexOf(b.iso);
      if (aPriority !== -1 || bPriority !== -1) {
        if (aPriority === -1) return 1;
        if (bPriority === -1) return -1;
        return aPriority - bPriority;
      }
      return a.name.localeCompare(b.name);
    });
  return cachedCountries;
}
