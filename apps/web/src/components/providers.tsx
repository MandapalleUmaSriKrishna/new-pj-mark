'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { PwaManager } from '@/components/pwa-manager';

/**
 * Client providers.
 *
 * Everything below the root layout that needs browser state hangs off here:
 * React Query (server cache), theme, locale, session and the PWA lifecycle.
 * The root layout itself stays a server component so the marketing pages ship
 * without a client bundle until they need one.
 */

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="top-center"
      richColors
      closeButton
      toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Tenant data changes through jobs and other users; keep it short.
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            {children}
            <ThemedToaster />
            <PwaManager />
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
