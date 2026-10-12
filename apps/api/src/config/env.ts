import { resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Everything the process reads from the environment is declared here exactly
 * once and validated with Zod at boot. Failures are reported as a single
 * readable list rather than a stack trace deep inside a service.
 *
 * Deliberate design decision: secrets are *required* in production and have
 * safe-but-obviously-local defaults in development, so `npm run dev` works on a
 * laptop with zero configuration while `NODE_ENV=production` refuses to start
 * with a weak or missing key.
 */

const isProd = (process.env.NODE_ENV ?? 'development') === 'production';

const url = z.string().url();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase().trim()),
  )
  .pipe(z.boolean());

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);

export const envSchema = z.object({
  /* ------------------------------ runtime ------------------------------ */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInt.default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  API_PREFIX: z.string().default('api/v1'),
  SHUTDOWN_TIMEOUT_MS: nonNegativeInt.default(15000),

  /* -------------------------------- urls ------------------------------- */
  APP_URL: url.default('http://localhost:3000'),
  API_URL: url.default('http://localhost:4000'),
  PUBLIC_VERIFY_BASE_URL: url.optional(),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  /* --------------------------- driver selection ------------------------ */
  DATA_DRIVER: z.enum(['mongo', 'memory']).default('memory'),
  QUEUE_DRIVER: z.enum(['bullmq', 'memory']).default('memory'),
  CACHE_DRIVER: z.enum(['redis', 'memory']).default('memory'),
  EVENT_BUS_DRIVER: z.enum(['redis', 'memory']).default('memory'),
  MAIL_DRIVER: z.enum(['smtp', 'log', 'disabled']).default('log'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),

  /* ------------------------------- data -------------------------------- */
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/kdc'),
  MONGODB_DB: z.string().default('kdc'),
  MEMORY_STORE_SEED: booleanish.default(false),

  /* ------------------------------- redis ------------------------------- */
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_MAX_RETRIES: nonNegativeInt.default(3),
  QUEUE_PREFIX: z.string().default('kdc'),

  /* ------------------------------ security ----------------------------- */
  ENCRYPTION_MASTER_KEY: z.string().min(32).default('dev-only-master-key-change-me-32bytes!'),
  JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-32b'),
  JWT_REFRESH_SECRET: z.string().min(32).default('dev-only-refresh-secret-change-me-32'),
  SESSION_COOKIE_SECRET: z.string().min(32).default('dev-only-cookie-secret-change-me-32b'),
  WEBHOOK_SIGNING_FALLBACK_SECRET: z
    .string()
    .min(32)
    .default('dev-only-webhook-secret-change-me-32'),
  JWT_ACCESS_TTL_SECONDS: positiveInt.default(900), // 15 minutes
  JWT_REFRESH_TTL_DAYS: positiveInt.default(30),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanish.default(isProd),
  CSRF_ENABLED: booleanish.default(true),
  RATE_LIMIT_DISABLED: booleanish.default(false),
  RATE_LIMIT_TTL_SECONDS: positiveInt.default(60),
  RATE_LIMIT_MAX: positiveInt.default(300),
  AUTH_RATE_LIMIT_MAX: positiveInt.default(10),
  VERIFY_RATE_LIMIT_MAX: positiveInt.default(60),
  TRUST_PROXY: booleanish.default(true),
  REQUIRE_STRONG_PASSWORDS: booleanish.default(true),
  MIN_PASSWORD_LENGTH: positiveInt.default(10),

  /* --------------------------- google oauth ---------------------------- */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),

  /* -------------------------------- mail ------------------------------- */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: positiveInt.default(587),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Krishna Digital Certificate <no-reply@localhost>'),
  MAIL_REPLY_TO: z.string().optional(),
  MAIL_LOG_DIR: z.string().default('./data/mail'),
  MAIL_MAX_ATTEMPTS: positiveInt.default(5),

  /* ------------------------------ storage ------------------------------ */
  STORAGE_LOCAL_DIR: z.string().default('./data/storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(false),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  MAX_UPLOAD_MB: positiveInt.default(25),
  /** Private download links expire after this many days (0 = never). */
  DOWNLOAD_LINK_TTL_DAYS: nonNegativeInt.default(30),

  /* ------------------------------- billing ----------------------------- */
  BILLING_PROVIDER: z.enum(['manual', 'stripe']).default('manual'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_IDS_JSON: z.string().optional(),

  /* --------------------------- custom domains -------------------------- */
  CUSTOM_DOMAINS_ENABLED: booleanish.default(false),
  DOMAIN_VERIFICATION_TXT_PREFIX: z.string().default('kdc-verify='),
  /** DNS provider API token used to provision TLS automatically (optional). */
  DNS_PROVIDER_TOKEN: z.string().optional(),

  /* ----------------------------- operations ---------------------------- */
  ENABLE_SWAGGER: booleanish.default(true),
  SWAGGER_USER: z.string().optional(),
  SWAGGER_PASSWORD: z.string().optional(),
  ENABLE_METRICS: booleanish.default(true),
  BACKUP_RETENTION_DAYS: positiveInt.default(30),
  SEED_DEMO_DATA: booleanish.default(false),
  SEED_DEMO_EMAIL: z.string().default('demo@kdc.local'),
  SEED_DEMO_PASSWORD: z.string().default('Kdc!Sample-2026'),
});

export type Env = z.infer<typeof envSchema>;

export interface ConfigWarning {
  area: string;
  message: string;
  remedy: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Loads and validates the environment. Throws an aggregate, human-readable
 * error when required values are missing or malformed.
 */
/**
 * Loads `.env` files before parsing.
 *
 * Real environment variables always win (dotenv never overrides an existing
 * key), so an orchestrator's secrets take precedence over a checked-out file.
 * The monorepo root and the API package directory are both searched so
 * `npm run dev` from the root and `npm run dev -w @kdc/api` behave the same.
 */
function loadDotenvFiles(): void {
  if (process.env.KDC_SKIP_DOTENV === 'true') return;
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
  ];
  for (const path of candidates) {
    const result = dotenvConfig({ path, quiet: true });
    if (!result.error) return;
  }
}

export function loadEnv(source?: NodeJS.ProcessEnv): { env: Env; warnings: ConfigWarning[] } {
  if (!source) {
    loadDotenvFiles();
    source = process.env;
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  const env = parsed.data;
  return { env, warnings: collectWarnings(env) };
}

/**
 * Honest capability report. Anything that needs credentials we do not have is
 * surfaced here (and at `/api/v1/health`) instead of being silently faked.
 */
export function collectWarnings(env: Env): ConfigWarning[] {
  const w: ConfigWarning[] = [];
  const devSecrets: Record<string, string> = {
    ENCRYPTION_MASTER_KEY: env.ENCRYPTION_MASTER_KEY,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    SESSION_COOKIE_SECRET: env.SESSION_COOKIE_SECRET,
    WEBHOOK_SIGNING_FALLBACK_SECRET: env.WEBHOOK_SIGNING_FALLBACK_SECRET,
  };
  for (const [name, value] of Object.entries(devSecrets)) {
    if (value.startsWith('dev-only-')) {
      w.push({
        area: 'security',
        severity: env.NODE_ENV === 'production' ? 'critical' : 'warning',
        message: `${name} is using the built-in development default.`,
        remedy: `Set ${name} to a unique value of at least 32 characters.`,
      });
    }
    if (value.length < 32) {
      w.push({
        area: 'security',
        severity: 'critical',
        message: `${name} is shorter than 32 characters.`,
        remedy: `Generate one with: openssl rand -hex 32`,
      });
    }
  }

  if (env.DATA_DRIVER === 'memory') {
    w.push({
      area: 'persistence',
      severity: env.NODE_ENV === 'production' ? 'critical' : 'info',
      message: 'DATA_DRIVER=memory - all data lives in this process and is lost on restart.',
      remedy: 'Set DATA_DRIVER=mongo and MONGODB_URI to a real MongoDB instance.',
    });
  }
  if (env.QUEUE_DRIVER === 'memory') {
    w.push({
      area: 'queue',
      severity: env.NODE_ENV === 'production' ? 'warning' : 'info',
      message: 'QUEUE_DRIVER=memory - jobs are not durable and cannot span processes.',
      remedy: 'Set QUEUE_DRIVER=bullmq and REDIS_URL for durable, retried background jobs.',
    });
  }
  if (env.CACHE_DRIVER === 'memory' || env.EVENT_BUS_DRIVER === 'memory') {
    w.push({
      area: 'cache',
      severity: 'info',
      message:
        'CACHE_DRIVER/EVENT_BUS_DRIVER=memory - rate limits, locks and the realtime event fan-out are per-process.',
      remedy:
        'Set CACHE_DRIVER=redis and EVENT_BUS_DRIVER=redis when running more than one API replica.',
    });
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    w.push({
      area: 'oauth',
      severity: 'info',
      message:
        'Google OAuth is not configured - the button is shown as unavailable and the route returns 503 oauth_not_configured.',
      remedy: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL.',
    });
  }
  if (env.MAIL_DRIVER !== 'smtp') {
    w.push({
      area: 'mail',
      severity: env.MAIL_DRIVER === 'disabled' ? 'warning' : 'info',
      message:
        env.MAIL_DRIVER === 'disabled'
          ? 'MAIL_DRIVER=disabled - emails are recorded as failed, nothing is sent.'
          : 'MAIL_DRIVER=log - emails are written to disk and marked queued, nothing leaves the machine.',
      remedy: 'Set MAIL_DRIVER=smtp with SMTP_HOST/SMTP_USER/SMTP_PASSWORD to deliver for real.',
    });
  }
  if (env.STORAGE_DRIVER === 'local') {
    w.push({
      area: 'storage',
      severity: env.NODE_ENV === 'production' ? 'warning' : 'info',
      message: 'STORAGE_DRIVER=local - PDFs and assets are written to the container filesystem.',
      remedy: 'Mount a persistent volume, or set STORAGE_DRIVER=s3 with S3_* credentials.',
    });
  }
  if (env.BILLING_PROVIDER === 'manual') {
    w.push({
      area: 'billing',
      severity: 'info',
      message:
        'BILLING_PROVIDER=manual - plan changes are enforced but no payment provider is attached.',
      remedy: 'Set BILLING_PROVIDER=stripe with STRIPE_SECRET_KEY to charge for real.',
    });
  }
  if (!env.CUSTOM_DOMAINS_ENABLED) {
    w.push({
      area: 'domains',
      severity: 'info',
      message:
        'CUSTOM_DOMAINS_ENABLED=false - vanity domains can be registered and verified but TLS is not auto-provisioned.',
      remedy:
        'Enable it and put a TLS-terminating proxy (the bundled Caddy config does this) in front of the app.',
    });
  }
  if (env.NODE_ENV === 'production' && env.TRUST_PROXY && !env.COOKIE_DOMAIN) {
    w.push({
      area: 'security',
      severity: 'info',
      message: 'COOKIE_DOMAIN is unset; cookies are host-only.',
      remedy:
        'Set COOKIE_DOMAIN to the apex domain when the web app and API live on sibling subdomains.',
    });
  }
  return w;
}

export function googleOAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function smtpConfigured(env: Env): boolean {
  return Boolean(env.MAIL_DRIVER === 'smtp' && env.SMTP_HOST);
}

export function s3Configured(env: Env): boolean {
  return Boolean(env.STORAGE_DRIVER === 's3' && env.S3_BUCKET && env.S3_REGION);
}

let cached: { env: Env; warnings: ConfigWarning[] } | null = null;

export function getEnv(): { env: Env; warnings: ConfigWarning[] } {
  if (!cached) cached = loadEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
