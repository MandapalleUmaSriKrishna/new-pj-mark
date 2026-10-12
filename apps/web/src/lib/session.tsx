'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@kdc/shared';
import { api, API_PREFIX, hasSessionCookie, markSignedOut, refreshSession } from './api';
import type { AuthResult, GoogleStatus, PublicUser, TenantSummary } from './types';
import { isBrowser } from './utils';

/**
 * Session state.
 *
 * The API owns authentication: it sets an HttpOnly `kdc_access` cookie plus a
 * readable `kdc_csrf` cookie. The web app therefore never stores a token it can
 * lose to XSS - it only mirrors who is signed in and which organisation is
 * active, and re-reads that from `GET /auth/me` on every mount.
 */

const ACTIVE_TENANT_KEY = 'kdc.activeTenant';

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

export interface LoginInput {
  email: string;
  password: string;
  remember?: boolean;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
  organisation?: { name: string; slug?: string; type: string; country?: string };
}

export interface SessionValue {
  status: SessionStatus;
  user: PublicUser | null;
  tenants: TenantSummary[];
  /** The organisation the dashboard is currently scoped to. */
  activeTenant: TenantSummary | null;
  setActiveTenant: (tenantId: string) => void;
  permissions: Permission[];
  role: string | null;
  can: (permission: Permission | Permission[]) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  login: (input: LoginInput) => Promise<AuthResult>;
  register: (input: RegisterInput) => Promise<AuthResult>;
  logout: () => Promise<void>;
  /** Force a re-read of `/auth/me`. */
  refreshSession: () => void;
  google: GoogleStatus | null;
  googleSignInUrl: string;
  error: string | null;
}

const SessionContext = createContext<SessionValue | null>(null);

function readActiveTenantId(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(ACTIVE_TENANT_KEY);
  } catch {
    return null;
  }
}

function writeActiveTenantId(tenantId: string | null): void {
  if (!isBrowser()) return;
  try {
    if (tenantId) window.localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
    else window.localStorage.removeItem(ACTIVE_TENANT_KEY);
  } catch {
    // Storage can be unavailable (private mode); the session still works in memory.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A cookie present but no `/auth/me` result yet means "probably signed in",
  // which avoids flashing the marketing header at returning users.
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{ user: PublicUser; tenants: TenantSummary[] }>(`${API_PREFIX}/auth/me`, {
        noRetry: false,
      }),
    staleTime: 30_000,
    retry: (failureCount, err) => {
      // Do not hammer the API when the user is simply not signed in.
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 1;
    },
    enabled: isBrowser(),
  });

  const googleStatus = useQuery({
    queryKey: ['auth', 'google-status'],
    queryFn: () => api.get<GoogleStatus>(`${API_PREFIX}/auth/google/status`),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: isBrowser(),
  });

  const user = me.data?.user ?? null;
  const tenants = useMemo(() => me.data?.tenants ?? [], [me.data?.tenants]);
  const status: SessionStatus = me.isLoading ? 'loading' : user ? 'authenticated' : 'anonymous';

  // Restore the last used organisation, falling back to the first membership.
  useEffect(() => {
    setActiveTenantId(readActiveTenantId());
  }, []);

  useEffect(() => {
    if (tenants.length === 0) return;
    const stored = activeTenantId;
    if (!stored || !tenants.some((tenant) => tenant.id === stored)) {
      const first = tenants[0];
      if (first) {
        setActiveTenantId(first.id);
        writeActiveTenantId(first.id);
      }
    }
  }, [tenants, activeTenantId]);

  // Keep the cookie warm: if the browser has a session cookie but `/auth/me`
  // failed, try one refresh before declaring the user anonymous.
  useEffect(() => {
    if (status !== 'anonymous' || !isBrowser() || !hasSessionCookie()) return;
    let cancelled = false;
    void refreshSession().then((ok) => {
      if (ok && !cancelled) void me.refetch();
    });
    return () => {
      cancelled = true;
    };
  }, [status, me.refetch]);

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === activeTenantId) ?? tenants[0] ?? null,
    [tenants, activeTenantId],
  );

  const setActiveTenant = useCallback((tenantId: string) => {
    setActiveTenantId(tenantId);
    writeActiveTenantId(tenantId);
  }, []);

  const permissions = useMemo<Permission[]>(
    () => (activeTenant?.permissions as Permission[]) ?? [],
    [activeTenant],
  );
  const role = activeTenant?.role ?? null;

  const can = useCallback(
    (permission: Permission | Permission[]) => {
      const wanted = Array.isArray(permission) ? permission : [permission];
      return wanted.every((entry) => permissions.includes(entry));
    },
    [permissions],
  );

  const canAny = useCallback(
    (wanted: Permission[]) => wanted.some((entry) => permissions.includes(entry)),
    [permissions],
  );

  const afterAuth = useCallback(
    (result: AuthResult) => {
      queryClient.setQueryData(['auth', 'me'], { user: result.user, tenants: result.tenants });
      const preferred = result.tenants[0];
      if (preferred) {
        setActiveTenantId(preferred.id);
        writeActiveTenantId(preferred.id);
      }
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const login = useCallback(
    async (input: LoginInput) => {
      setError(null);
      const result = await api.post<AuthResult>(`${API_PREFIX}/auth/login`, input);
      afterAuth(result);
      return result;
    },
    [afterAuth],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      setError(null);
      const result = await api.post<AuthResult>(`${API_PREFIX}/auth/register`, input);
      afterAuth(result);
      return result;
    },
    [afterAuth],
  );

  const logout = useCallback(async () => {
    try {
      await api.post(`${API_PREFIX}/auth/logout`, {});
    } catch {
      // Even if the server call fails the local state must be cleared.
    }
    markSignedOut();
    setActiveTenantId(null);
    writeActiveTenantId(null);
    queryClient.setQueryData(['auth', 'me'], undefined);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      tenants,
      activeTenant,
      setActiveTenant,
      permissions,
      role,
      can,
      canAny,
      login,
      register,
      logout,
      refreshSession: () => void me.refetch(),
      google: googleStatus.data ?? null,
      googleSignInUrl: `${API_PREFIX}/auth/google`,
      error,
    }),
    [
      status,
      user,
      tenants,
      activeTenant,
      setActiveTenant,
      permissions,
      role,
      can,
      canAny,
      login,
      register,
      logout,
      me,
      googleStatus.data,
      error,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}

/** Convenience for pages that need an organisation id, with a clear failure. */
export function useActiveTenantId(): string {
  const { activeTenant, status } = useSession();
  if (!activeTenant) {
    throw new Error(
      status === 'loading'
        ? 'Session is still loading'
        : 'No organisation is available for this account',
    );
  }
  return activeTenant.id;
}
