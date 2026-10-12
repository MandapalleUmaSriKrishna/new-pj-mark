import { expect, test } from '@playwright/test';

/**
 * Public, unauthenticated surface: the marketing page, the verification page,
 * the offline fallback, the PWA assets and localisation.
 *
 * These are the pages a recipient or an auditor sees without an account, so
 * they are asserted on real rendered text rather than on CSS classes - a
 * redesign should not break them, but a regression in copy or routing should.
 */

test.describe('public site', () => {
  test('the landing page states what the product does and links to both entry points', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Krishna Digital Certificate/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Certificates your recipients can',
    );

    await expect(page.getByRole('link', { name: 'Start issuing free' })).toHaveAttribute(
      'href',
      '/register',
    );
    await expect(page.getByRole('link', { name: 'Verify a certificate' })).toHaveAttribute(
      'href',
      '/verify',
    );
  });

  test('every page has one h1, a main landmark, and a skip link wherever there is a header', async ({
    page,
  }) => {
    for (const path of ['/', '/verify', '/login', '/register', '/pricing', '/offline']) {
      await page.goto(path);

      await expect(page.locator('h1'), `${path}: expected exactly one h1`).toHaveCount(1);
      await expect(page.locator('main#main'), `${path}: expected a main landmark`).toHaveCount(1);
      // Decorative icons are aria-hidden; nothing may expose an unnamed image.
      await expect(
        page.locator('img:not([alt])'),
        `${path}: found an <img> without alt text`,
      ).toHaveCount(0);

      // A bypass link is required only where a navigation block is repeated
      // (WCAG 2.4.1). /login, /register and /offline deliberately render no site
      // header - /offline must not need the network at all - so for those the
      // check is simply "no header, therefore no skip link needed".
      if ((await page.locator('header').count()) > 0) {
        const skip = page.locator('a[href="#main"]');
        await expect(skip, `${path}: renders a header, so it must offer a skip link`).toHaveCount(
          1,
        );
        await expect(skip, `${path}: skip link text`).toContainText(/skip to main content/i);
      }
    }
  });

  test('the offline page renders without a network', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('You are offline');
  });

  test('an unknown certificate ID shows the API verdict, not a crash', async ({
    page,
    request,
  }) => {
    // Well-formed enough to pass the route's serial pattern, but not a real record.
    const serial = 'KDC-2026-AAAAAAAA-0';
    const api = await request.get(`/api/v1/public/verify?serial=${encodeURIComponent(serial)}`);
    expect(api.ok()).toBeTruthy();
    const verdict = (await api.json()) as { result: string };
    expect(['not_found', 'malformed']).toContain(verdict.result);

    const expected =
      verdict.result === 'malformed'
        ? 'That does not look like a certificate ID'
        : 'No certificate matches that ID';

    await page.goto(`/verify/${serial}`);
    await expect(page.getByText(expected)).toBeVisible();
    // The page must still be usable: the search form is present to try again.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Verify');
  });

  test('the PWA manifest and service worker are served from the app origin', async ({
    page,
    request,
  }) => {
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    const manifestBody = (await manifest.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifestBody.name).toContain('Krishna Digital Certificate');
    expect(manifestBody.start_url).toBe('/');
    expect(manifestBody.display).toBe('standalone');
    expect(manifestBody.icons.length).toBeGreaterThan(0);

    const sw = await request.get('/sw.js');
    expect(sw.status()).toBe(200);
    expect(sw.headers()['content-type']).toContain('javascript');
    // The service worker must be allowed to control the whole origin.
    expect(sw.headers()['service-worker-allowed']).toBe('/');

    for (const icon of manifestBody.icons) {
      const res = await request.get(icon.src);
      expect(res.status(), `icon ${icon.src} should be served`).toBe(200);
    }

    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );

    // 127.0.0.1 is a secure context, so registration must actually succeed.
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const registration = await navigator.serviceWorker.register('/sw.js');
      return registration.scope;
    });
    expect(registered).not.toBe('unsupported');
    expect(String(registered)).toContain('/');
  });

  test('the interface translates and remembers the choice', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Work email')).toBeVisible();

    // lib/i18n.tsx persists the choice in localStorage under `kdc.locale`.
    await page.evaluate(() => window.localStorage.setItem('kdc.locale', 'hi'));
    await page.reload();

    await expect(page.getByRole('button', { name: 'साइन इन' })).toBeVisible();
    await expect(page.getByText('कार्य ईमेल')).toBeVisible();

    await page.evaluate(() => window.localStorage.setItem('kdc.locale', 'te'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'సైన్ ఇన్' })).toBeVisible();
  });

  test('an incomplete locale falls back to English instead of showing keys', async ({ page }) => {
    await page.goto('/login');
    // Spanish is declared but not fully translated; the fallback must render real
    // English copy, never a raw message key such as "auth.signIn".
    await page.evaluate(() => window.localStorage.setItem('kdc.locale', 'es'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('auth.signIn');
  });
});
