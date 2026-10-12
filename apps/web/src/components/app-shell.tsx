'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  ClipboardCheck,
  FileDown,
  Gauge,
  GitCommitVertical,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Palette,
  Plug,
  Settings,
  Sun,
  Users,
  Webhook,
  X,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@kdc/shared';
import { useSession } from '@/lib/session';
import { useI18n, LOCALE_LABELS, TRANSLATED_LOCALES, type MessageKey } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { useRealtimeStream, STREAM_STATE_LABEL } from '@/lib/realtime';
import { useOnline } from '@/lib/offline';
import { brandVars } from '@/lib/branding';
import { cn, initials, titleCase } from '@/lib/utils';
import { SUPPORTED_LOCALES, type Locale } from '@kdc/shared';

interface NavItem {
  href: string;
  labelKey: MessageKey;
  icon: LucideIcon;
  permissions?: Permission[];
  end?: boolean;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operate',
    items: [
      { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
      {
        href: '/dashboard/certificates',
        labelKey: 'nav.certificates',
        icon: BadgeCheck,
        permissions: ['certificate:read'],
      },
      {
        href: '/dashboard/events',
        labelKey: 'nav.events',
        icon: CalendarDays,
        permissions: ['event:read'],
      },
      {
        href: '/dashboard/import',
        labelKey: 'nav.import',
        icon: FileDown,
        permissions: ['import:read', 'import:create'],
      },
      {
        href: '/dashboard/approvals',
        labelKey: 'nav.approvals',
        icon: ClipboardCheck,
        permissions: ['certificate:approve', 'certificate:reject'],
      },
    ],
  },
  {
    title: 'Create',
    items: [
      {
        href: '/dashboard/designs',
        labelKey: 'nav.designs',
        icon: Palette,
        permissions: ['template:read'],
      },
    ],
  },
  {
    title: 'Understand',
    items: [
      {
        href: '/dashboard/analytics',
        labelKey: 'nav.analytics',
        icon: ChartColumn,
        permissions: ['analytics:read'],
      },
      {
        href: '/dashboard/audit',
        labelKey: 'nav.audit',
        icon: GitCommitVertical,
        permissions: ['audit:read'],
      },
      {
        href: '/dashboard/jobs',
        labelKey: 'nav.jobs',
        icon: Gauge,
        permissions: ['certificate:read', 'import:read'],
      },
    ],
  },
  {
    title: 'Administer',
    items: [
      { href: '/dashboard/team', labelKey: 'nav.team', icon: Users, permissions: ['member:read'] },
      {
        href: '/dashboard/integrations',
        labelKey: 'nav.integrations',
        icon: Plug,
        permissions: ['webhook:manage', 'apikey:manage'],
      },
      {
        href: '/dashboard/billing',
        labelKey: 'nav.billing',
        icon: ChartColumn,
        permissions: ['billing:read'],
      },
      {
        href: '/dashboard/settings',
        labelKey: 'nav.settings',
        icon: Settings,
        permissions: ['tenant:update', 'branding:update', 'domain:manage'],
      },
    ],
  },
];

function RealtimeIndicator({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const online = useOnline();
  const stream = useRealtimeStream({ tenantId });
  const state = !online ? 'offline' : stream.state;
  const dot =
    state === 'open'
      ? 'bg-emerald-500'
      : state === 'offline'
        ? 'bg-ink-400'
        : state === 'closed'
          ? 'bg-ink-400'
          : 'bg-amber-500';

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-2.5 py-1 text-[0.68rem] font-semibold text-[var(--kdc-text-muted)]"
      title={state === 'open' ? 'Server-sent events connected' : STREAM_STATE_LABEL[state]}
    >
      <span
        className={cn('size-1.5 rounded-full', dot, state === 'connecting' && 'animate-pulse')}
        aria-hidden
      />
      {state === 'open' ? t('common.live') : STREAM_STATE_LABEL[state]}
    </span>
  );
}

function LanguageMenu() {
  const { locale, setLocale, t } = useI18n();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="kdc-btn kdc-btn-ghost !min-h-9 !px-2 !text-xs"
          aria-label={t('nav.language')}
        >
          <Languages className="size-4" aria-hidden />
          <span className="hidden uppercase sm:inline">{locale}</span>
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          side="bottom"
          align="end"
          className="kdc-card z-50 min-w-44 overflow-hidden p-1 shadow-[var(--shadow-pop)]"
        >
          {SUPPORTED_LOCALES.map((code: Locale) => {
            const meta = LOCALE_LABELS[code];
            const partial = !TRANSLATED_LOCALES.includes(code) && code !== 'en';
            return (
              <Dropdown.Item
                key={code}
                onSelect={() => setLocale(code)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs outline-none data-[highlighted]:bg-[color-mix(in_oklab,var(--kdc-brand)_10%,transparent)]',
                  locale === code && 'font-semibold text-[var(--kdc-brand)]',
                )}
              >
                <span>
                  {meta.label}
                  <span className="ml-1.5 text-[var(--kdc-text-muted)]">{meta.english}</span>
                </span>
                {partial ? (
                  <span className="rounded bg-ink-100 px-1 text-[0.6rem] uppercase tracking-wide text-ink-500 dark:bg-ink-800 dark:text-ink-300">
                    en fallback
                  </span>
                ) : null}
              </Dropdown.Item>
            );
          })}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function ThemeMenu() {
  const { mode, resolved, cycle } = useTheme();
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={cycle}
      className="kdc-btn kdc-btn-ghost !min-h-9 !px-2 !text-xs"
      aria-label={`${t('nav.theme')}: ${mode}`}
      title={`Theme: ${mode} (showing ${resolved})`}
    >
      {resolved === 'dark' ? (
        <Moon className="size-4" aria-hidden />
      ) : (
        <Sun className="size-4" aria-hidden />
      )}
    </button>
  );
}

function TenantSwitcher() {
  const { tenants, activeTenant, setActiveTenant } = useSession();
  const { t } = useI18n();
  if (tenants.length === 0) return null;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="kdc-btn kdc-btn-secondary !min-h-9 max-w-full !justify-between gap-2 !px-2.5 !text-xs"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0 text-[var(--kdc-brand)]" aria-hidden />
            <span className="truncate font-semibold">
              {activeTenant?.name ?? t('nav.organisation')}
            </span>
          </span>
          {tenants.length > 1 ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : null}
        </button>
      </Dropdown.Trigger>
      {tenants.length > 1 ? (
        <Dropdown.Portal>
          <Dropdown.Content
            side="bottom"
            align="start"
            className="kdc-card z-50 min-w-56 overflow-hidden p-1 shadow-[var(--shadow-pop)]"
          >
            <Dropdown.Label className="px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)]">
              {t('nav.organisation')}
            </Dropdown.Label>
            {tenants.map((tenant) => (
              <Dropdown.Item
                key={tenant.id}
                onSelect={() => setActiveTenant(tenant.id)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs outline-none data-[highlighted]:bg-[color-mix(in_oklab,var(--kdc-brand)_10%,transparent)]"
              >
                <span className="truncate">{tenant.name}</span>
                <span className="shrink-0 rounded bg-ink-100 px-1 text-[0.6rem] uppercase text-ink-500 dark:bg-ink-800 dark:text-ink-300">
                  {tenant.role}
                </span>
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Portal>
      ) : null}
    </Dropdown.Root>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  if (!user) return null;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="kdc-btn kdc-btn-ghost !min-h-9 !gap-2 !px-1.5"
          aria-label={t('a11y.userMenu')}
        >
          <span className="grid size-7 place-items-center rounded-full bg-[var(--kdc-brand)] text-[0.7rem] font-bold text-[var(--kdc-brand-ink)]">
            {initials(user.name)}
          </span>
          <ChevronDown className="size-3.5 text-[var(--kdc-text-muted)]" aria-hidden />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          side="bottom"
          align="end"
          className="kdc-card z-50 min-w-56 overflow-hidden p-1 shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-[var(--kdc-border)] px-2.5 py-2">
            <p className="truncate text-xs font-semibold">{user.name}</p>
            <p className="truncate text-[0.68rem] text-[var(--kdc-text-muted)]">{user.email}</p>
          </div>
          <Dropdown.Item
            onSelect={() => {
              void logout().then(() => router.push('/'));
            }}
            className="mt-1 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-red-600 outline-none data-[highlighted]:bg-red-50 dark:text-red-400 dark:data-[highlighted]:bg-red-500/10"
          >
            <LogOut className="size-3.5" aria-hidden />
            {t('nav.signOut')}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { activeTenant, canAny, status } = useSession();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permissions || canAny(item.permissions)),
      })).filter((section) => section.items.length > 0),
    [canAny],
  );

  const isActive = useCallback(
    (item: NavItem) =>
      item.end
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    [pathname],
  );

  const nav = (
    <nav
      aria-label={t('a11y.mainNavigation')}
      className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4"
    >
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-2.5 pb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[var(--kdc-text-muted)]">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.82rem] font-medium transition-colors',
                      active
                        ? 'bg-[color-mix(in_oklab,var(--kdc-brand)_12%,transparent)] text-[var(--kdc-brand)]'
                        : 'text-[var(--kdc-text-muted)] hover:bg-[color-mix(in_oklab,var(--kdc-text)_6%,transparent)] hover:text-[var(--kdc-text)]',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {t(item.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-auto space-y-1 border-t border-[var(--kdc-border)] px-2.5 pt-3 text-[0.68rem] text-[var(--kdc-text-muted)]">
        <Link
          href="/verify"
          className="flex items-center gap-2 rounded-md py-1 hover:text-[var(--kdc-text)]"
        >
          <BadgeCheck className="size-3.5" aria-hidden /> {t('nav.verify')}
        </Link>
        <Link
          href="/api-docs"
          className="flex items-center gap-2 rounded-md py-1 hover:text-[var(--kdc-text)]"
        >
          <Webhook className="size-3.5" aria-hidden /> {t('nav.docs')}
        </Link>
        <Link
          href="/pricing"
          className="flex items-center gap-2 rounded-md py-1 hover:text-[var(--kdc-text)]"
        >
          <ChartColumn className="size-3.5" aria-hidden /> {t('nav.pricing')}
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh" style={brandVars(activeTenant?.branding)}>
      <a href="#main" className="kdc-skip-link">
        {t('nav.skipToContent')}
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-[var(--kdc-border)] bg-[var(--kdc-surface)] lg:block print:hidden">
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-[var(--kdc-border)] bg-[var(--kdc-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--kdc-border)] px-3 py-2">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="kdc-btn kdc-btn-ghost !min-h-8 !p-1.5"
                aria-label="Close navigation"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-[var(--kdc-border)] bg-[color-mix(in_oklab,var(--kdc-surface)_86%,transparent)] backdrop-blur print:hidden">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
            <button
              type="button"
              className="kdc-btn kdc-btn-ghost !min-h-9 !p-2 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-4.5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <TenantSwitcher />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="hidden sm:inline-flex">
                <RealtimeIndicator tenantId={activeTenant?.id ?? ''} />
              </span>
              <ConnectivityChip />
              <LanguageMenu />
              <ThemeMenu />
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6">
          {status === 'loading' ? (
            <div className="space-y-3">
              <div className="h-8 w-48 animate-pulse rounded bg-[var(--kdc-surface)]" />
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="h-24 animate-pulse rounded-xl bg-[var(--kdc-surface)]"
                  />
                ))}
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function ConnectivityChip() {
  const online = useOnline();
  const { t } = useI18n();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-2 py-1 text-[0.68rem] font-semibold text-[var(--kdc-text-muted)]"
      title={online ? t('common.online') : t('common.offline')}
    >
      {online ? (
        <Wifi className="size-3.5 text-emerald-500" aria-hidden />
      ) : (
        <WifiOff className="size-3.5 text-amber-500" aria-hidden />
      )}
      <span className="sr-only">{online ? t('common.online') : t('common.offline')}</span>
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--kdc-brand)_12%,transparent)] text-[var(--kdc-brand)]">
            <Icon className="size-5" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-xs text-[var(--kdc-text-muted)] sm:text-sm">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function RoleHint({ role }: { role: string | null }) {
  return <span className="kdc-badge">{titleCase(role ?? 'viewer')}</span>;
}
