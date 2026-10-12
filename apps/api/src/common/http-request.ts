import type { Request } from 'express';

/**
 * The raw transport view of a request used by guards and middleware.
 *
 * Guards run before Nest's pipes and only read a handful of transport fields
 * (headers, cookies, socket address). Naming that view here - instead of
 * sprinkling `Record<string, any>` - keeps those reads checked while making the
 * "this is unvalidated input" boundary explicit in one place.
 */
export interface HttpRequest {
  method?: string;
  url?: string;
  ip?: string;
  requestId?: string;
  route?: { path?: string } | undefined;
  params?: Record<string, string | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  socket?: { remoteAddress?: string } | undefined;
  [key: string]: unknown;
}

/** Narrows an Express request to the transport view guards operate on. */
export function asHttpRequest(request: Request | HttpRequest): HttpRequest {
  return request as HttpRequest;
}

/** Reads a single header as a string, ignoring array forms. */
export function headerValue(request: HttpRequest, name: string): string | null {
  const value = request.headers?.[name];
  return typeof value === 'string'
    ? value
    : Array.isArray(value) && typeof value[0] === 'string'
      ? value[0]
      : null;
}
