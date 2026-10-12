'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BadgeCheck, Code2, FileCheck2, Menu, Moon, Sun, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Marketing-site chrome. The product shell (AppShell) is separate so the
 * dashboard never inherits marketing navigation.
 */

const LINKS: { href: string; label: string; icon?: LucideIcon }[] = [
  { href: '/#features', label: 'Features' },
  { href: '/#how', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/verify', label: 'Verify' },
  { href: '/api-docs', label: 'API docs' },
];

export function SiteHeader() {
  const { status } = useSession();
  const { t } = useI18n();
  const { resolved, cycle } = useTheme();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--kdc-border)] bg-[color-mix(in_oklab,var(--kdc-surface)_88%,transparent)] backdrop-blur print:hidden">
      <a href="#main" className="kdc-skip-link">
        {t('nav.skipToContent')}
      </a>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5"
          aria-label="Krishna Digital Certificate home"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-950 text-white shadow-sm">
            <BadgeCheck className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold tracking-tight">
              Krishna Digital Certificate
            </span>
            <span className="block truncate text-[0.65rem] text-[var(--kdc-text-muted)]">
              {t('app.tagline')}
            </span>
          </span>
        </Link>

        <nav
          aria-label={t('a11y.mainNavigation')}
          className="ml-auto hidden items-center gap-1 md:flex"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--kdc-text-muted)] transition-colors hover:bg-[color-mix(in_oklab,var(--kdc-text)_6%,transparent)] hover:text-[var(--kdc-text)]',
                pathname === link.href && 'text-[var(--kdc-text)]',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:ml-2">
          <button
            type="button"
            onClick={cycle}
            className="kdc-btn kdc-btn-ghost !min-h-9 !px-2"
            aria-label={`${t('nav.theme')}: ${resolved}`}
          >
            {resolved === 'dark' ? (
              <Moon className="size-4" aria-hidden />
            ) : (
              <Sun className="size-4" aria-hidden />
            )}
          </button>
          {status === 'authenticated' ? (
            <Link href="/dashboard" className="kdc-btn kdc-btn-primary !min-h-9 !py-1.5 !text-xs">
              {t('nav.dashboard')}
            </Link>
          ) : (
            <>
              <Link href="/login" className="kdc-btn kdc-btn-ghost !min-h-9 !py-1.5 !text-xs">
                {t('nav.signIn')}
              </Link>
              <Link href="/register" className="kdc-btn kdc-btn-primary !min-h-9 !py-1.5 !text-xs">
                {t('nav.getStarted')}
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="kdc-btn kdc-btn-ghost !min-h-9 !p-2 md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? (
              <X className="size-4.5" aria-hidden />
            ) : (
              <Menu className="size-4.5" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          aria-label={t('a11y.mainNavigation')}
          className="border-t border-[var(--kdc-border)] px-4 py-2 md:hidden"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2 py-2 text-sm font-medium text-[var(--kdc-text-muted)] hover:text-[var(--kdc-text)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--kdc-border)] bg-[var(--kdc-surface)] print:hidden">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold">
            <BadgeCheck className="size-4 text-[var(--kdc-brand)]" aria-hidden /> Krishna Digital
            Certificate
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--kdc-text-muted)]">
            Tamper-evident certificates with unique IDs, QR verification, revocation and an
            immutable audit trail — for 1,000+ organisations.
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
            Product
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li>
              <Link className="hover:underline" href="/#designer">
                Certificate designer
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/#bulk">
                Bulk issuance &amp; imports
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/#verify">
                Verification
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/pricing">
                Plans &amp; pricing
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
            Build &amp; integrate
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li>
              <Link className="hover:underline" href="/api-docs">
                OpenAPI reference
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/#webhooks">
                Signed webhooks
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/#pwa">
                Installable PWA
              </Link>
            </li>
            <li>
              <a
                className="inline-flex items-center gap-1.5 hover:underline"
                href="https://github.com"
                rel="noreferrer noopener"
                target="_blank"
              >
                <Code2 className="size-3.5" aria-hidden /> Repository & API docs
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
            Trust
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-[var(--kdc-text-muted)]">
            <li className="flex items-center gap-1.5">
              <FileCheck2 className="size-3.5" aria-hidden /> Hash-chained audit log
            </li>
            <li className="flex items-center gap-1.5">
              <FileCheck2 className="size-3.5" aria-hidden /> Per-tenant encryption keys
            </li>
            <li className="flex items-center gap-1.5">
              <FileCheck2 className="size-3.5" aria-hidden /> Private, expiring download links
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--kdc-border)] px-4 py-3 text-center text-[0.7rem] text-[var(--kdc-text-muted)]">
        © {new Date().getFullYear()} Krishna Digital Certificate. Certificates shown in previews use
        sample data.
      </div>
    </footer>
  );
}
