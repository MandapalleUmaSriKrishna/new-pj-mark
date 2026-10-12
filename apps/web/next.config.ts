import type { NextConfig } from 'next';

/**
 * The web app talks to the API through RELATIVE urls only (`/api/v1/...`).
 * Next rewrites that prefix to the NestJS origin, which means:
 *   - the browser never needs to know where the API lives (works behind the
 *     sandbox preview host, a reverse proxy, Docker or a custom domain);
 *   - the `kdc_access` cookie stays first-party, so `SameSite=Lax` + the
 *     `x-kdc-csrf` double-submit check keep working;
 *   - the SSE realtime stream is proxied rather than opened cross-origin.
 *
 * In Docker the destination is the internal service name (`http://api:4000`);
 * locally it is the API on the host.
 */
const API_ORIGIN = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://127.0.0.1:4000'
).replace(/\/+$/, '');

/**
 * Dev origins the dev server is allowed to accept requests from. The preview
 * host is dynamic, so it is configurable plus wildcarded; `allowedDevOrigins`
 * only affects `next dev`, never the production build.
 */
const allowedDevOrigins = [
  'localhost',
  '127.0.0.1',
  '*.e2b.app',
  ...String(process.env.NEXT_ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `@kdc/shared` ships CommonJS; transpiling it keeps one copy of the schemas
  // and enums in the browser bundle instead of a second, drifting definition.
  transpilePackages: ['@kdc/shared'],
  ...(process.env.NEXT_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
  serverExternalPackages: [],
  allowedDevOrigins,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          // The API is on another origin in Docker; only its own paths are proxied.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // The service worker must be served from the origin root to control the app.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
    ];
  },
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` },
      // Keep the API's own docs reachable from the same origin as the site.
      { source: '/api-docs', destination: `${API_ORIGIN}/api/v1/docs` },
      { source: '/api-docs/:path*', destination: `${API_ORIGIN}/api/v1/docs/:path*` },
    ];
  },
};

export default nextConfig;
