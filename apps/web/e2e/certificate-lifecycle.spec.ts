import { expect, test, type Page } from '@playwright/test';

/**
 * The authenticated lifecycle, driven the way a real administrator drives it:
 * sign in through the UI, read data through the same cookie session the browser
 * uses, verify a certificate publicly, then revoke it and confirm the public
 * verdict changes.
 *
 * It also pins two security properties that are easy to break by accident:
 *   - a state-changing request with the session cookie but WITHOUT the
 *     `x-kdc-csrf` double-submit header is refused (403), and
 *   - the same request WITH the header succeeds.
 *
 * Runs against the seeded demo organisation (SEED_DEMO_DATA=true, see
 * playwright.config.ts), so it creates no data of its own beyond the revocation
 * it deliberately performs.
 */

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'demo@kdc.local';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Kdc!Sample-2026';

interface TenantRow {
  tenant: { id: string; slug: string; name: string };
}
interface CertificateRow {
  id: string;
  serial: string;
  status: string;
  recipient: { name: string };
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');

  await page.getByPlaceholder('you@organisation.edu').fill(DEMO_EMAIL);
  await page.getByPlaceholder('••••••••••••').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

/** Uses the browser's own cookie session, exactly as the app's fetch client does. */
async function demoContext(
  page: Page,
): Promise<{ tenantId: string; tenantName: string; certificate: CertificateRow }> {
  const tenantsRes = await page.request.get('/api/v1/tenants');
  expect(tenantsRes.ok(), `GET /tenants failed: ${tenantsRes.status()}`).toBeTruthy();
  const tenants = (await tenantsRes.json()) as { items: TenantRow[] };
  // A thrown Error rather than expect().toBeTruthy(): only a real guard narrows
  // the type, and a missing seed should fail the helper, not a later assertion.
  const row = tenants.items.find((item) => item.tenant.slug === 'demo-org') ?? tenants.items[0];
  if (!row) throw new Error('the seeded demo organisation should be present');

  const certsRes = await page.request.get(`/api/v1/tenants/${row.tenant.id}/certificates?limit=20`);
  expect(certsRes.ok(), `GET /certificates failed: ${certsRes.status()}`).toBeTruthy();
  const certs = (await certsRes.json()) as { items: CertificateRow[] };
  const certificate = certs.items.find((item) => item.status === 'issued');
  if (!certificate) throw new Error('the seed should have issued at least one certificate');

  return { tenantId: row.tenant.id, tenantName: row.tenant.name, certificate };
}

test.describe('certificate lifecycle', () => {
  test('signing in with the seeded account reaches the dashboard', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main#main')).toHaveCount(1);
    await expect(page.locator('a[href="#main"]')).toHaveCount(1);
    await expect(page.locator('nav[aria-label]')).not.toHaveCount(0);

    // The navigation must expose the sections this role is allowed to see.
    // Asserted by href and COUNT, not visibility: the desktop sidebar is always
    // mounted but hidden below `lg`, where the same links live in a drawer that
    // only renders once opened - so a visibility check would fail on mobile.
    for (const href of ['/dashboard/certificates', '/dashboard/events', '/dashboard/designs']) {
      await expect(
        page.locator(`nav[aria-label] a[href="${href}"]`),
        `${href} should be in the navigation`,
      ).toHaveCount(1);
    }
  });

  test('wrong credentials are refused and stay on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('you@organisation.edu').fill(DEMO_EMAIL);
    await page.getByPlaceholder('••••••••••••').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('a certificate verifies publicly, then reports revoked after an authenticated revocation', async ({
    page,
  }) => {
    await signIn(page);
    const { tenantId, certificate } = await demoContext(page);
    const serial = certificate.serial;

    // 1. The dashboard lists it.
    await page.goto('/dashboard/certificates');
    await expect(page.getByText(serial).first(), 'the serial should be listed').toBeVisible();

    // 2. The public page reports it valid, with the recipient and a tamper check.
    await page.goto(`/verify/${serial}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This certificate is valid');
    await expect(page.getByText(certificate.recipient.name).first()).toBeVisible();
    await expect(page.getByText('Tamper check').first()).toBeVisible();
    await expect(page.getByText(serial).first()).toBeVisible();

    const publicBefore = await page.request.get(
      `/api/v1/public/verify?serial=${encodeURIComponent(serial)}`,
    );
    expect(((await publicBefore.json()) as { result: string }).result).toBe('valid');

    // 3. A state-changing call with the cookie but no CSRF header must fail.
    const revokeUrl = `/api/v1/tenants/${tenantId}/certificates/${certificate.id}/revoke`;
    const withoutCsrf = await page.request.post(revokeUrl, {
      data: { reason: 'Playwright E2E revocation', notifyRecipient: false },
    });
    expect(withoutCsrf.status(), 'cookie-only state change must be refused').toBe(403);

    // 4. The same call with the double-submit header succeeds.
    const cookies = await page.context().cookies();
    const csrf = cookies.find((cookie) => cookie.name === 'kdc_csrf')?.value;
    expect(csrf, 'the API should have set a kdc_csrf cookie').toBeTruthy();

    const withCsrf = await page.request.post(revokeUrl, {
      data: { reason: 'Playwright E2E revocation', notifyRecipient: false },
      headers: { 'x-kdc-csrf': csrf! },
    });
    // Read the body once: an APIResponse cannot be consumed twice.
    const revokeBody = await withCsrf.text();
    expect(withCsrf.ok(), `revoke failed: ${withCsrf.status()} ${revokeBody}`).toBeTruthy();
    expect((JSON.parse(revokeBody) as { status: string }).status).toBe('revoked');

    // 5. The public verdict flips, and says why.
    await page.goto(`/verify/${serial}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This certificate has been revoked',
    );
    await expect(page.getByText('Playwright E2E revocation').first()).toBeVisible();

    const publicAfter = await page.request.get(
      `/api/v1/public/verify?serial=${encodeURIComponent(serial)}`,
    );
    expect(((await publicAfter.json()) as { result: string }).result).toBe('revoked');
  });

  test('the API answers 401 once the session cookies are gone', async ({ page, context }) => {
    // Clearing the cookies is what a logout or an expired refresh token looks
    // like to the API. It must answer 401 - that is what makes the app redirect
    // to /login instead of rendering empty dashboard panels.
    await signIn(page);
    const authenticated = await page.request.get('/api/v1/tenants');
    expect(authenticated.ok(), 'the signed-in session should be able to list tenants').toBeTruthy();

    await context.clearCookies();
    const anonymous = await page.request.get('/api/v1/tenants');
    expect(anonymous.status()).toBe(401);
  });
});
