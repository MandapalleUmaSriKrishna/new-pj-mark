'use client';

import { useCallback, useEffect, useState } from 'react';
import { WifiOff, Download, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useOfflineQueue, useOnline } from '@/lib/offline';
import { cn, formatRelative } from '@/lib/utils';

/**
 * PWA lifecycle + offline status.
 *
 * Registers the service worker (app-shell cache so the installed app opens with
 * no network), surfaces the install prompt when the browser offers one, and
 * renders the honest connectivity banner: what is queued, what failed, and when
 * it last synced. Nothing here claims a save succeeded before the API confirms.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SW_PATH = '/sw.js';
const DISMISS_KEY = 'kdc.installPromptDismissed';

export function PwaManager() {
  const { t } = useI18n();
  const online = useOnline();
  const queue = useOfflineQueue();
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [swState, setSwState] = useState<'idle' | 'registered' | 'unsupported' | 'error'>('idle');
  const [bannerOpen, setBannerOpen] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === 'true');
    } catch {
      setDismissed(false);
    }

    if (!('serviceWorker' in navigator)) {
      setSwState('unsupported');
      return;
    }
    let cancelled = false;
    navigator.serviceWorker
      .register(SW_PATH, { scope: '/' })
      .then(() => {
        if (!cancelled) setSwState('registered');
      })
      .catch(() => {
        // Registration can fail on plain http origins other than localhost; the
        // web app is fully usable without it, so this is reported, not hidden.
        if (!cancelled) setSwState('error');
      });

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onPrompt);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    setInstalling(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') setInstallEvent(null);
    } finally {
      setInstalling(false);
    }
  }, [installEvent]);

  const dismissInstall = useCallback(() => {
    setInstallEvent(null);
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Non-fatal: the banner simply returns next visit.
    }
  }, []);

  const showOfflineBanner = !online || queue.items.length > 0;
  const showInstall = Boolean(installEvent) && !dismissed && online;

  return (
    <>
      {showOfflineBanner && bannerOpen ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300/60 bg-amber-50/95 px-4 py-3 text-sm text-amber-900 backdrop-blur dark:border-amber-500/30 dark:bg-amber-950/80 dark:text-amber-100 pb-safe print:hidden"
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
            {online ? (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            ) : (
              <WifiOff className="size-4 shrink-0" aria-hidden />
            )}
            <p className="min-w-0 flex-1">
              {online ? t('common.online') : t('common.offline')}
              {queue.pending > 0 ? (
                <span className="ml-2 font-semibold">
                  {t('offline.queued', { count: queue.pending })}
                </span>
              ) : null}
              {queue.failed > 0 ? (
                <span className="ml-2 text-red-700 dark:text-red-300">
                  {queue.failed} failed — open the queue to see why
                </span>
              ) : null}
              {queue.lastSyncAt ? (
                <span className="ml-2 text-amber-800/70 dark:text-amber-200/70">
                  synced {formatRelative(queue.lastSyncAt)}
                </span>
              ) : null}
            </p>
            {queue.pending > 0 ? (
              <button
                type="button"
                onClick={() => void queue.flush()}
                disabled={queue.flushing || !online}
                className="kdc-btn kdc-btn-secondary !min-h-9 !py-1 !text-xs"
              >
                <RefreshCw
                  className={cn('size-3.5', queue.flushing && 'animate-spin')}
                  aria-hidden
                />
                {queue.flushing ? 'Syncing…' : 'Sync now'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setBannerOpen(false)}
              className="kdc-btn kdc-btn-ghost !min-h-9 !p-1.5"
              aria-label={t('common.close')}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {showInstall ? (
        <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md print:hidden pb-safe">
          <div className="kdc-card flex items-start gap-3 p-4 shadow-[var(--shadow-pop)]">
            <Download className="mt-0.5 size-5 shrink-0 text-[var(--kdc-brand)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t('install.title')}</p>
              <p className="mt-0.5 text-xs text-[var(--kdc-text-muted)]">{t('install.body')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void install()}
                  disabled={installing}
                  className="kdc-btn kdc-btn-primary !min-h-9 !py-1.5 !text-xs"
                >
                  {installing ? '…' : t('install.action')}
                </button>
                <button
                  type="button"
                  onClick={dismissInstall}
                  className="kdc-btn kdc-btn-ghost !min-h-9 !py-1.5 !text-xs"
                >
                  {t('install.dismiss')}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissInstall}
              className="kdc-btn kdc-btn-ghost !min-h-8 !p-1"
              aria-label={t('common.close')}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {/* Reported for operators debugging installability; invisible to users. */}
      <span data-sw-state={swState} className="hidden" aria-hidden />
    </>
  );
}
