import type { ApiErrorBody, Paginated } from '@kdc/shared';
import { isApiError } from '@kdc/shared';
import { buildQuery, isBrowser, readCookie } from './utils';

/**
 * The only place in the web app that knows how to talk to the API.
 *
 * Every request uses a RELATIVE path (`/api/v1/...`). `next.config.ts` rewrites
 * that prefix to the NestJS origin, so the browser never makes a cross-origin
 * call: the HttpOnly `kdc_access` cookie stays first-party and the CSRF
 * double-submit check keeps working in the sandbox preview, behind a reverse
 * proxy, on a custom domain and in Docker.
 *
 * On a 401 the client rotates the refresh cookie exactly once and retries, with
 * concurrent refreshes collapsed into a single in-flight promise.
 */

export const API_PREFIX = '/api/v1';
const ACCESS_COOKIE = 'kdc_access';
const CSRF_COOKIE = 'kdc_csrf';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequestOptions {
  method?: HttpMethod;
  /** JSON body. Mutually exclusive with `form`. */
  body?: unknown;
  /** Multipart body (file uploads). */
  form?: FormData;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Return the raw `Response` instead of parsed JSON (downloads, PDFs). */
  raw?: boolean;
  /** Do not attempt a token refresh on 401. */
  noRetry?: boolean;
}

/** Details of a validation failure, as returned by `ZodValidationPipe`. */
export interface FieldIssue {
  field: string;
  message: string;
  code?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string;
  readonly requiredPlan?: string;
  readonly fields: FieldIssue[];
  /** Present when a deployment-level integration is not configured. */
  readonly remedy?: string;

  constructor(body: ApiErrorBody | null, status: number, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error ?? (status >= 500 ? 'internal_error' : 'unknown');
    this.details = body?.details;
    this.requestId = body?.requestId ?? '';
    this.requiredPlan = body?.requiredPlan;
    this.fields = extractFields(body?.details);
    this.remedy = extractRemedy(body?.details);
  }

  /** True when the tenant must upgrade; the UI shows the upgrade prompt. */
  get isPlanGate(): boolean {
    return this.code === 'feature_not_available' && Boolean(this.requiredPlan);
  }

  /** True when the feature is switched off in this deployment, not sold away. */
  get isNotConfigured(): boolean {
    return (
      this.status === 503 && /not_configured|not available/i.test(`${this.code} ${this.message}`)
    );
  }

  fieldMessage(field: string): string | undefined {
    return this.fields.find((issue) => issue.field === field || issue.field.endsWith(`.${field}`))
      ?.message;
  }
}

function extractFields(details: unknown): FieldIssue[] {
  if (Array.isArray(details)) {
    const issues: FieldIssue[] = [];
    for (const entry of details) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const field =
        typeof record.field === 'string'
          ? record.field
          : typeof record.path === 'string'
            ? record.path
            : '';
      const message = typeof record.message === 'string' ? record.message : '';
      if (!field && !message) continue;
      issues.push({
        field,
        message,
        code: typeof record.code === 'string' ? record.code : undefined,
      });
    }
    return issues;
  }
  if (typeof details === 'object' && details !== null) {
    const record = details as Record<string, unknown>;
    if (Array.isArray(record.fields)) return extractFields(record.fields);
    if (Array.isArray(record.issues)) return extractFields(record.issues);
  }
  return [];
}

function extractRemedy(details: unknown): string | undefined {
  if (typeof details === 'object' && details !== null) {
    const record = details as Record<string, unknown>;
    if (typeof record.remedy === 'string') return record.remedy;
    if (typeof record.hint === 'string') return record.hint;
  }
  return undefined;
}

/* --------------------------------------------------------------- refresh */

let refreshInFlight: Promise<boolean> | null = null;
let refreshFailedRecently = false;

/**
 * Rotates the refresh-token cookie. Returns true when a new access cookie is
 * available. Failures are remembered briefly so a logged-out user does not
 * trigger a refresh storm on every query.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: '{}',
      });
      refreshFailedRecently = !response.ok;
      return response.ok;
    } catch {
      refreshFailedRecently = true;
      return false;
    } finally {
      // Clear on the next macrotask so callers awaiting this promise see it.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

export function markSignedOut(): void {
  refreshFailedRecently = true;
}

export function hasSessionCookie(): boolean {
  return isBrowser() && readCookie(ACCESS_COOKIE) !== null;
}

function csrfHeaders(): Record<string, string> {
  const csrf = readCookie(CSRF_COOKIE);
  return csrf ? { 'x-kdc-csrf': csrf } : {};
}

/* --------------------------------------------------------------- request */

async function toErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    return isApiError(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function perform<T>(
  path: string,
  options: ApiRequestOptions,
  allowRetry: boolean,
): Promise<T> {
  const method = options.method ?? 'GET';
  const isWrite = method !== 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (isWrite) Object.assign(headers, csrfHeaders());

  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form; // the browser sets the multipart boundary
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  } else if (isWrite) {
    headers['content-type'] = 'application/json';
    body = '{}';
  }

  const response = await fetch(`${path}${buildQuery(options.query)}`, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
    cache: 'no-store',
  });

  if (
    response.status === 401 &&
    allowRetry &&
    !options.noRetry &&
    !refreshFailedRecently &&
    isBrowser()
  ) {
    const refreshed = await refreshSession();
    if (refreshed) return perform<T>(path, options, false);
  }

  if (options.raw) {
    if (!response.ok)
      throw new ApiError(await toErrorBody(response), response.status, 'Request failed');
    return response as unknown as T;
  }

  if (response.status === 204) return undefined as unknown as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(isApiError(payload) ? payload : null, response.status, 'Request failed');

  // The API returns bare payloads; unwrap an envelope if one is ever added.
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in (payload as Record<string, unknown>) &&
    Object.keys(payload as object).length <= 2
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return perform<T>(path, options, true);
}

export function joinPath(...parts: string[]): string {
  return `${API_PREFIX}/${parts
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;
}

export const api = {
  get: <T>(path: string, options: Omit<ApiRequestOptions, 'method' | 'body' | 'form'> = {}) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
  ) => request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(
    path: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
  ) => request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(
    path: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
  ) => request<T>(path, { ...options, method: 'PUT', body }),
  del: <T>(path: string, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(
    path: string,
    form: FormData,
    options: Omit<ApiRequestOptions, 'method' | 'body' | 'form'> = {},
  ) => request<T>(path, { ...options, method: 'POST', form }),
  raw: (path: string, options: Omit<ApiRequestOptions, 'method'> = {}) =>
    request<Response>(path, { ...options, raw: true }),
};

/** Absolute path for links the browser opens directly (PDF downloads, QR). */
export function apiUrl(path: string, query?: Record<string, unknown>): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_PREFIX}${suffix.startsWith(API_PREFIX) ? suffix.slice(API_PREFIX.length) : suffix}${buildQuery(query)}`;
}

export type PaginatedResult<T> = Paginated<T>;
