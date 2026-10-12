import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Browser end-to-end configuration.
 *
 *   npx playwright install --with-deps chromium   # once per machine
 *   npm run test:playwright                       # == npx playwright test
 *
 * Playwright starts BOTH halves of the stack itself (see `webServer` below):
 * the NestJS API on :4321 and the Next.js app on :3210. Those ports are not the
 * development ones, so an E2E run never collides with `npm run dev`.
 *
 * The API is booted with the in-process adapters and seeded demo data, so the
 * suite needs no MongoDB, Redis, SMTP or object storage - and no third-party
 * credentials. What that means honestly: these tests prove the browser <-> web
 * <-> API path, not the behaviour of a specific production database.
 *
 * `workers: 1` is deliberate. Every test shares ONE server with ONE in-memory
 * data store, so parallel workers would observe each other's writes (a
 * certificate revoked by one test would fail an assertion in another).
 */

const API_PORT = Number(process.env.E2E_API_PORT ?? 4321);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3210);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const E2E_TMP = resolve(tmpdir(), 'kdc-playwright');

/** `devices` is a plain record; the fallbacks keep this file type-safe. */
const DESKTOP = devices['Desktop Chrome'] ?? { viewport: { width: 1366, height: 900 } };
const MOBILE = devices['Pixel 7'] ?? {
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'desktop-chrome', use: { ...DESKTOP } },
    { name: 'mobile-chrome', use: { ...MOBILE } },
  ],
  webServer: [
    {
      // `cwd` is resolved relative to this config file (apps/web), so ../api is
      // apps/api. ts-node runs the TypeScript entrypoint directly, exactly like
      // `npm run dev:api` but without --watch, which would restart mid-test.
      command: 'node -r ts-node/register src/main.ts',
      cwd: '../api',
      url: `${API_URL}/api/v1/health/live`,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        KDC_SKIP_DOTENV: 'true',
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        API_PREFIX: 'api/v1',
        DATA_DRIVER: 'memory',
        QUEUE_DRIVER: 'memory',
        CACHE_DRIVER: 'memory',
        EVENT_BUS_DRIVER: 'memory',
        MAIL_DRIVER: 'log',
        MAIL_LOG_DIR: resolve(E2E_TMP, 'mail'),
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_DIR: resolve(E2E_TMP, 'storage'),
        // SEED_DEMO_DATA does the full seed (org, designs, event, certificates);
        // MEMORY_STORE_SEED would seed the store a second time, so it stays off.
        MEMORY_STORE_SEED: 'false',
        SEED_DEMO_DATA: 'true',
        SEED_DEMO_EMAIL: 'demo@kdc.local',
        SEED_DEMO_PASSWORD: 'Kdc!Sample-2026',
        // Links the API puts in emails and QR codes must point at the E2E web app.
        APP_URL: WEB_URL,
        API_URL,
        CORS_ALLOWED_ORIGINS: WEB_URL,
        COOKIE_SECURE: 'false',
        CSRF_ENABLED: 'true',
        TRUST_PROXY: 'false',
        ENCRYPTION_MASTER_KEY: 'e2e-only-master-key-not-a-secret-32b',
        JWT_ACCESS_SECRET: 'e2e-only-access-secret-not-a-secret',
        JWT_REFRESH_SECRET: 'e2e-only-refresh-secret-not-a-secre',
        SESSION_COOKIE_SECRET: 'e2e-only-cookie-secret-not-a-secret',
        WEBHOOK_SIGNING_FALLBACK_SECRET: 'e2e-only-webhook-secret-not-a-secr',
      },
    },
    {
      // `npm run dev` (not `next dev` directly) so the predev hook rebuilds
      // @kdc/shared first - the app imports it from source.
      command: 'npm run dev',
      cwd: '.',
      url: `${WEB_URL}/login`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        WEB_PORT: String(WEB_PORT),
        // Server-side target of the /api/v1 rewrite, baked in when Next starts.
        API_INTERNAL_URL: API_URL,
        NEXT_TELEMETRY_DISABLED: '1',
        KDC_SKIP_DOTENV: 'true',
      },
    },
  ],
});
