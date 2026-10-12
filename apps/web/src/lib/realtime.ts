'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readCookie } from './utils';
import type { StreamMessage } from './types';

/**
 * Real-time status over Server-Sent Events.
 *
 * The API exposes `GET /api/v1/tenants/:id/stream` which authenticates with the
 * same `kdc_access` cookie as the rest of the app and pushes job progress,
 * issuance and delivery events. `EventSource` cannot set headers, which is fine
 * here: the cookie is first-party (the path is proxied by Next) and the stream
 * is read-only.
 *
 * The hook reports its own state honestly - `connecting | open | closed |
 * error | offline` - so the UI can show a real connection indicator instead of
 * a decorative green dot.
 */

export type StreamState = 'idle' | 'connecting' | 'open' | 'closed' | 'error' | 'offline';

export interface RealtimeOptions {
  tenantId: string | null;
  enabled?: boolean;
  /** Called for every message, including the heartbeat. */
  onMessage?: (message: StreamMessage) => void;
  /** Called when a message of one of these types arrives. */
  onEvent?: (type: string, payload: Record<string, unknown>) => void;
}

export interface RealtimeValue {
  state: StreamState;
  lastMessageAt: number | null;
  lastEvent: StreamMessage | null;
  messageCount: number;
  reconnect: () => void;
}

const ACCESS_COOKIE = 'kdc_access';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useRealtimeStream({
  tenantId,
  enabled = true,
  onMessage,
  onEvent,
}: RealtimeOptions): RealtimeValue {
  const [state, setState] = useState<StreamState>('idle');
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [lastEvent, setLastEvent] = useState<StreamMessage | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  // Retry backoff lives in a ref so `connect` stays referentially stable.
  const attemptRef = useRef(0);

  const sourceRef = useRef<EventSource | null>(null);
  const connectRef = useRef<() => void>(() => undefined);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef({ onMessage, onEvent });
  handlersRef.current = { onMessage, onEvent };

  const close = useCallback(() => {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const connect = useCallback(() => {
    if (!tenantId || !enabled || typeof window === 'undefined') return;
    if (typeof EventSource === 'undefined') {
      // Very old browsers: the app still works, just without live updates.
      setState('closed');
      return;
    }
    if (!readCookie(ACCESS_COOKIE)) {
      setState('closed');
      return;
    }
    if (!navigator.onLine) {
      setState('offline');
      return;
    }

    close();
    setState('connecting');
    const source = new EventSource(`/api/v1/tenants/${encodeURIComponent(tenantId)}/stream`, {
      withCredentials: true,
    });
    sourceRef.current = source;

    source.onopen = () => {
      setState('open');
      attemptRef.current = 0;
    };

    const handle = (raw: MessageEvent<string>) => {
      let message: StreamMessage;
      try {
        message = JSON.parse(raw.data) as StreamMessage;
      } catch {
        message = { type: 'raw', payload: { data: raw.data } };
      }
      setLastMessageAt(Date.now());
      setMessageCount((count) => count + 1);
      setLastEvent(message);
      handlersRef.current.onMessage?.(message);
      if (message.type && message.type !== 'heartbeat') {
        handlersRef.current.onEvent?.(message.type, message.payload ?? {});
      }
    };

    source.onmessage = handle;
    // The API also names its events; listen for the common ones explicitly.
    for (const name of [
      'job.progress',
      'job.completed',
      'certificate.issued',
      'certificate.revoked',
      'delivery.updated',
      'import.progress',
    ]) {
      source.addEventListener(name, handle as EventListener);
    }

    source.onerror = () => {
      const wasOpen = sourceRef.current?.readyState === EventSource.OPEN;
      source.close();
      sourceRef.current = null;
      if (!navigator.onLine) {
        setState('offline');
        return;
      }
      setState(wasOpen ? 'error' : 'connecting');
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * 2 ** Math.min(attemptRef.current, 5),
      );
      attemptRef.current += 1;
      retryRef.current = setTimeout(() => connectRef.current(), delay);
    };
  }, [tenantId, enabled, close]);

  connectRef.current = connect;

  useEffect(() => {
    connect();
    return close;
  }, [connect, close]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      attemptRef.current = 0;
      connectRef.current();
    };
    const onOffline = () => {
      close();
      setState('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [close]);

  return { state, lastMessageAt, lastEvent, messageCount, reconnect: connect };
}

export const STREAM_STATE_LABEL: Record<StreamState, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  open: 'Live',
  closed: 'Not connected',
  error: 'Reconnecting…',
  offline: 'Offline',
};
