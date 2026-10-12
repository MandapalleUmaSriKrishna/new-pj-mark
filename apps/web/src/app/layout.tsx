import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

/**
 * Root layout.
 *
 * Intentionally a server component: the marketing pages render to static HTML
 * and ship no client JavaScript until a page opts in. The client providers wrap
 * everything that needs browser state.
 */

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  applicationName: 'Krishna Digital Certificate',
  title: {
    default: 'Krishna Digital Certificate — issue and verify certificates at scale',
    template: '%s · Krishna Digital Certificate',
  },
  description:
    'A multi-tenant platform for colleges, schools, companies, NGOs, government bodies and events to design, issue, deliver and verify tamper-evident digital certificates with QR codes, audit trails and real-time status.',
  keywords: [
    'digital certificates',
    'certificate verification',
    'convocation',
    'QR verification',
    'multi-tenant SaaS',
  ],
  authors: [{ name: 'Krishna Digital Certificate' }],
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'KDC',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'Krishna Digital Certificate',
    title: 'Krishna Digital Certificate',
    description: 'Design, issue and verify tamper-evident certificates for any organisation.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#14171f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
