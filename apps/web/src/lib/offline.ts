'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_PREFIX, ApiError, request, type HttpMethod } from './api';
import { isBrowser } from './utils';

/**
 * Offline-safe behaviour.
 *
 * Two independent pieces, both deliberately honest about what they can do:
 *
 * 1. A WRITE QUEUE. Actions an issuer starts while offline (issue a certificate,
 *    revoke one, resend an email) are persisted to `localStorage` and replayed
 *    in order when connectivity returns. A permanently rejected action is kept
 *    with the API's own error message rather than silently dropped, and nothing
 *    is claimed as done before the server confirms it.
 *
 * 2. A READ SNAPSHOT. The most recent list payloads the user actually fetched
 *    are stored so a certificate list opened offline shows real data with a
 *    visible "saved at …" stamp - never invented data.
 *
 * The service worker (`public/sw.js`) covers the third piece: the app shell
 * itself, so the installed PWA opens with no network at all.
 */

const QUEUE_KEY = 'kdc.offline.queue.v1';
const SNAPSHOT_PREFIX = 'kdc.snapshot.v1.';
const MAX_SNAPSHOTS = 12;
const MAX_QUEUE = 200;

export type QueuedKind = 'issue' | 'revoke' | 'resend' | 'approve' | 'reject' | 'custom';

export interface QueuedAction {
  id: string;
  kind: QueuedKind;
  label: string;
  tenantId: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
  createdAt: string;
  /** Set once the server rejected the action for good; it will not be retried. */
  failedReason?: string;
  attempts: number;
}

export interface Snapshot<T> {
  savedAt: string;
  data: T;
}

/* ------------------------------------------------------------- storage */

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readQueue(): QueuedAction[] {
  if (!isBrowser()) return [];
  try {
    const parsed = safeParse<QueuedAction[]>(window.localStorage.getItem(QUEUE_KEY), []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedAction[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
  } catch {
    // Quota exceeded: keep the in-memory copy so the user still sees the queue.
  }
}

export function readSnapshot<T>(key: string): Snapshot<T> | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_PREFIX + key);
    if (!raw) return null;
    const parsed = safeParse<Snapshot<T> | null>(raw, null);
    return parsed && parsed.data !== undefined ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSnapshot<T>(key: string, data: T): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      SNAPSHOT_PREFIX + key,
      JSON.stringify({ savedAt: new Date().toISOString(), data }),
    );
    pruneSnapshots();
  } catch {
    // Snapshots are a convenience, not a contract; ignore quota failures.
  }
}

function pruneSnapshots(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(SNAPSHOT_PREFIX)) keys.push(key);
    }
    if (keys.length <= MAX_SNAPSHOTS) return;
    const stamped = keys
      .map((key) => ({
        key,
        savedAt: safeParse<Snapshot<unknown>>(window.localStorage.getItem(key), {
          savedAt: '',
          data: null,
        }).savedAt,
      }))
      .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    for (const entry of stamped.slice(0, keys.length - MAX_SNAPSHOTS))
      window.localStorage.removeItem(entry.key);
  } catch {
    // Best effort only.
  }
}

/* --------------------------------------------------------- connectivity */

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!isBrowser()) return;
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

/* -------------------------------------------------------------- queue */

export interface OfflineQueueValue {
  items: QueuedAction[];
  pending: number;
  failed: number;
  flushing: boolean;
  lastSyncAt: string | null;
  enqueue: (action: Omit<QueuedAction, 'id' | 'createdAt' | 'attempts'>) => QueuedAction;
  remove: (id: string) => void;
  retry: (id: string) => void;
  clearFailed: () => void;
  flush: () => Promise<void>;
}

export function useOfflineQueue(): OfflineQueueValue {
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const online = useOnline();
  const itemsRef = useRef<QueuedAction[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    setItems(readQueue());
  }, []);

  const persist = useCallback((next: QueuedAction[]) => {
    setItems(next);
    writeQueue(next);
  }, []);

  const enqueue = useCallback<OfflineQueueValue['enqueue']>(
    (action) => {
      const entry: QueuedAction = {
        ...action,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      persist([...itemsRef.current, entry]);
      return entry;
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => persist(itemsRef.current.filter((item) => item.id !== id)),
    [persist],
  );

  const retry = useCallback(
    (id: string) =>
      persist(
        itemsRef.current.map((item) =>
          item.id === id ? { ...item, failedReason: undefined, attempts: 0 } : item,
        ),
      ),
    [persist],
  );

  const clearFailed = useCallback(
    () => persist(itemsRef.current.filter((item) => !item.failedReason)),
    [persist],
  );

  const flush = useCallback(async () => {
    if (!isBrowser() || !navigator.onLine) return;
    const pending = itemsRef.current.filter((item) => !item.failedReason);
    if (pending.length === 0 || flushing) return;
    setFlushing(true);
    const settled = new Set<string>();
    const updates = new Map<string, QueuedAction>();
    for (const action of pending) {
      const path = action.path.startsWith(API_PREFIX) ? action.path : `${API_PREFIX}${action.path}`;
      try {
        await request(path, { method: action.method, body: action.body, noRetry: true });
        settled.add(action.id);
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0;
        const message = error instanceof Error ? error.message : 'Unknown error';
        // A 4xx will be rejected again: stop retrying but keep it visible so the
        // operator can read the reason and fix or discard it deliberately.
        updates.set(action.id, {
          ...action,
          attempts: action.attempts + 1,
          failedReason: status >= 400 && status < 500 ? `${status}: ${message}` : undefined,
        });
      }
    }
    setFlushing(false);
    setLastSyncAt(new Date().toISOString());
    persist(
      itemsRef.current
        .filter((item) => !settled.has(item.id))
        .map((item) => updates.get(item.id) ?? item),
    );
  }, [flushing, persist]);

  // Replay automatically when the connection comes back.
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  const pending = items.filter((item) => !item.failedReason).length;
  const failed = items.filter((item) => item.failedReason).length;

  return {
    items,
    pending,
    failed,
    flushing,
    lastSyncAt,
    enqueue,
    remove,
    retry,
    clearFailed,
    flush,
  };
}

/** Exposed for the service worker registration and tests. */
export const OFFLINE_QUEUE_KEY = QUEUE_KEY;
