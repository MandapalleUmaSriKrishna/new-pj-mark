import { describe, expect, it, vi } from 'vitest';
import { ApiError, api, API_PREFIX } from './api';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fetchMock() {
  return vi.mocked(global.fetch);
}

describe('api client', () => {
  it('prefixes relative paths and sends JSON bodies', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.post(`${API_PREFIX}/tenants/t1/events`, { name: 'Convocation' });
    const [url, init] = fetchMock().mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_PREFIX}/tenants/t1/events`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Convocation' });
  });

  it('sends the CSRF header on writes, never on reads', async () => {
    document.cookie = 'kdc_csrf=test-csrf-token; path=/';
    fetchMock().mockResolvedValueOnce(jsonResponse({})).mockResolvedValueOnce(jsonResponse({}));

    await api.get(`${API_PREFIX}/health`);
    const readHeaders = (fetchMock().mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(readHeaders['x-kdc-csrf']).toBeUndefined();

    await api.post(`${API_PREFIX}/auth/logout`, {});
    const writeHeaders = (fetchMock().mock.calls[1] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(writeHeaders['x-kdc-csrf']).toBe('test-csrf-token');
    document.cookie = 'kdc_csrf=; path=/; max-age=0';
  });

  it('builds query strings and skips empty values', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ items: [] }));
    await api.get(`${API_PREFIX}/tenants/t1/certificates`, {
      query: { page: 2, status: '', q: undefined, sort: 'issued' },
    });
    const [url] = fetchMock().mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('page=2');
    expect(url).toContain('sort=issued');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('q=');
  });

  it('raises a typed ApiError carrying fields and requiredPlan', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 403,
          error: 'feature_not_available',
          message: 'webhooks is not available on the current plan',
          requestId: 'r1',
          requiredPlan: 'starter',
        },
        403,
      ),
    );
    const error = await api
      .get(`${API_PREFIX}/tenants/t1/webhooks`)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    const typed = error as ApiError;
    expect(typed.status).toBe(403);
    expect(typed.isPlanGate).toBe(true);
    expect(typed.requiredPlan).toBe('starter');
  });

  it('extracts per-field validation issues', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 400,
          error: 'validation_failed',
          message: 'Branding validation failed',
          details: [
            { field: 'primaryColor', message: 'Use a 6-digit hex colour', code: 'invalid_format' },
          ],
          requestId: 'r2',
        },
        400,
      ),
    );
    const error = (await api
      .patch(`${API_PREFIX}/tenants/t1/branding`, {})
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error.fieldMessage('primaryColor')).toBe('Use a 6-digit hex colour');
    expect(error.fields).toHaveLength(1);
  });

  it('rotates the refresh token once on 401 and retries the request', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          { statusCode: 401, error: 'token_expired', message: 'expired', requestId: 'r' },
          401,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'new' })) // refresh
      .mockResolvedValueOnce(jsonResponse({ items: [1] })); // retry
    const result = await api.get<{ items: number[] }>(`${API_PREFIX}/tenants/t1/events`);
    expect(result.items).toEqual([1]);
    expect(fetchMock()).toHaveBeenCalledTimes(3);
    const refreshCall = fetchMock().mock.calls[1] as unknown as [string, RequestInit];
    expect(refreshCall[0]).toBe(`${API_PREFIX}/auth/refresh`);
  });

  it('does not retry when the refresh itself fails', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          { statusCode: 401, error: 'unauthenticated', message: 'no', requestId: 'r' },
          401,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { statusCode: 401, error: 'unauthenticated', message: 'no', requestId: 'r' },
          401,
        ),
      );
    await expect(api.get(`${API_PREFIX}/auth/me`)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('returns the raw Response for downloads', async () => {
    const pdf = new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    fetchMock().mockResolvedValueOnce(pdf);
    const response = await api.raw(`${API_PREFIX}/tenants/t1/certificates/c1/pdf`);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('treats 503 not_configured as a deployment gap, not a bug', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 503,
          error: 'oauth_not_configured',
          message: 'Google sign-in is not configured',
          requestId: 'r',
        },
        503,
      ),
    );
    const error = (await api
      .get(`${API_PREFIX}/auth/google/status`)
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error.isNotConfigured).toBe(true);
  });
});
