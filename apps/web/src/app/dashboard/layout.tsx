'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';

/**
 * Guard for the whole authenticated area.
 *
 * Anonymous visitors are sent to /login with the page they wanted in `next`, so
 * signing in returns them there. The guard is client-side because the session
 * lives in an HttpOnly cookie that the server components cannot read - and
 * reading it server-side would require duplicating the API's token parsing in
 * the web app, which is exactly the drift this architecture avoids.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (status === 'anonymous') {
      const next = `${pathname}${search.toString() ? `?${search.toString()}` : ''}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [status, router, pathname, search]);

  if (status !== 'authenticated') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3 text-sm text-[var(--kdc-text-muted)]">
          <Spinner />
          <p>{status === 'loading' ? 'Restoring your session…' : 'Redirecting to sign in…'}</p>
        </div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
