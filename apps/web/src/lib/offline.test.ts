import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { OFFLINE_QUEUE_KEY, readSnapshot, useOfflineQueue, writeSnapshot } from './offline';

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value: online,
    configurable: true,
    writable: true,
  });
}

describe('offline queue', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOnline(true);
  });

  it('persists queued actions across hook mounts', () => {
    const first = renderHook(() => useOfflineQueue());
    act(() => {
      first.result.current.enqueue({
        kind: 'issue',
        label: 'Issue to Jane',
        tenantId: 't1',
        method: 'POST',
        path: '/tenants/t1/certificates/issue',
        body: { a: 1 },
      });
    });
    expect(first.result.current.pending).toBe(1);
    first.unmount();

    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    expect(raw).toContain('Issue to Jane');

    const second = renderHook(() => useOfflineQueue());
    expect(second.result.current.pending).toBe(1);
    second.unmount();
  });

  it('replays queued writes when flushed and drops them on success', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const hook = renderHook(() => useOfflineQueue());
    act(() => {
      hook.result.current.enqueue({
        kind: 'revoke',
        label: 'Revoke X',
        tenantId: 't1',
        method: 'POST',
        path: '/tenants/t1/certificates/c1/revoke',
        body: { reason: 'typo' },
      });
    });

    await act(async () => {
      await hook.result.current.flush();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/tenants/t1/certificates/c1/revoke');
    expect(init.method).toBe('POST');
    expect(hook.result.current.pending).toBe(0);
    expect(window.localStorage.getItem(OFFLINE_QUEUE_KEY)).toBe('[]');
    hook.unmount();
  });

  it('keeps permanently rejected actions with the server reason', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 404,
          error: 'not_found',
          message: 'Certificate not found',
          requestId: 'r',
        }),
        { status: 404 },
      ),
    );

    const hook = renderHook(() => useOfflineQueue());
    act(() => {
      hook.result.current.enqueue({
        kind: 'resend',
        label: 'Resend X',
        tenantId: 't1',
        method: 'POST',
        path: '/tenants/t1/certificates/c1/resend',
        body: {},
      });
    });
    await act(async () => {
      await hook.result.current.flush();
    });

    expect(hook.result.current.failed).toBe(1);
    expect(hook.result.current.items[0]?.failedReason).toContain('404');
    hook.unmount();
  });

  it('retries a failed action when asked and clears failures on demand', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const hook = renderHook(() => useOfflineQueue());
    act(() => {
      hook.result.current.enqueue({
        kind: 'approve',
        label: 'Approve X',
        tenantId: 't1',
        method: 'POST',
        path: '/tenants/t1/certificates/c1/approve',
        body: {},
      });
    });
    await act(async () => {
      await hook.result.current.flush();
    });
    expect(hook.result.current.failed).toBe(1);

    const id = hook.result.current.items[0]?.id as string;
    act(() => {
      hook.result.current.retry(id);
    });
    expect(hook.result.current.failed).toBe(0);

    await act(async () => {
      await hook.result.current.flush();
    });
    expect(hook.result.current.pending).toBe(0);
    hook.unmount();
  });

  it('stores and reads list snapshots with a saved-at stamp', () => {
    writeSnapshot('certificates:t1', { items: [{ serial: 'KDC-1' }] });
    const snapshot = readSnapshot<{ items: { serial: string }[] }>('certificates:t1');
    expect(snapshot?.data.items[0]?.serial).toBe('KDC-1');
    expect(snapshot?.savedAt).toBeTruthy();
    expect(readSnapshot('missing-key')).toBeNull();
  });

  it('survives corrupt snapshot payloads without throwing', () => {
    window.localStorage.setItem('kdc.snapshot.v1.broken', '{not json');
    expect(readSnapshot('broken')).toBeNull();
  });
});
