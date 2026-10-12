import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Offline',
  description: 'You are offline. Krishna Digital Certificate will reconnect automatically.',
  robots: { index: false, follow: false },
};

/**
 * The service worker's navigation fallback. It is deliberately plain and
 * dependency-free: when the network is gone, this page is served from cache and
 * must never itself need the network.
 */
export default function OfflinePage() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="kdc-card max-w-sm p-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
          <WifiOff className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-bold tracking-tight">You are offline</h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--kdc-text-muted)]">
          The app shell loaded from cache, but this page needs the network. Anything you queued
          while offline is stored on this device and will sync automatically once you reconnect.
        </p>
        <a href="/dashboard" className="kdc-btn kdc-btn-primary mt-5 w-full">
          Try again
        </a>
      </div>
    </main>
  );
}
