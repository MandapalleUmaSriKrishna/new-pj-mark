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
import { isBrowser } from './utils';

/**
 * Colour theme.
 *
 * Defaults to the platform preference and respects an explicit user choice,
 * which is persisted. The `dark` class on <html> drives the CSS variables in
 * `globals.css`; tenant brand colours layer on top of either theme.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'kdc.theme';

interface ThemeValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStoredMode(): ThemeMode {
  if (!isBrowser()) return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemPreference(): 'light' | 'dark' {
  if (!isBrowser() || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [system, setSystem] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setModeState(readStoredMode());
    setSystem(systemPreference());
    if (!isBrowser() || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? system : mode;

  useEffect(() => {
    if (!isBrowser()) return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.classList.toggle('light', resolved === 'light');
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (!isBrowser()) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore: the choice still applies for this session.
    }
  }, []);

  const cycle = useCallback(() => {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(mode) + 1) % order.length] ?? 'system';
    setMode(next);
  }, [mode, setMode]);

  const value = useMemo<ThemeValue>(
    () => ({ mode, resolved, setMode, cycle }),
    [mode, resolved, setMode, cycle],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (context) return context;
  return { mode: 'system', resolved: 'light', setMode: () => undefined, cycle: () => undefined };
}
