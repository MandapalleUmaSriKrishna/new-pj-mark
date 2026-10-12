import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/config.tokens';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../common/guards/auth-context.guard';
import { randomBytes } from 'node:crypto';
import type { IssuedTokens } from './token.service';

/**
 * Cookie helpers.
 *
 * Access and refresh cookies are HttpOnly + SameSite=Lax so script cannot read
 * them and cross-site POSTs do not carry them. The CSRF cookie is deliberately
 * readable by script - that is what makes the double-submit pattern work.
 */
export function baseCookieOptions(env: Env, maxAgeSeconds: number): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: maxAgeSeconds * 1000,
    path: '/',
  };
  if (env.COOKIE_DOMAIN) options.domain = env.COOKIE_DOMAIN;
  return options;
}

export function setAuthCookies(
  res: Response,
  env: Env,
  tokens: IssuedTokens,
  remember: boolean,
): string {
  const accessMaxAge = remember ? env.JWT_ACCESS_TTL_SECONDS : undefined;
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookieOptions(env, env.JWT_ACCESS_TTL_SECONDS),
    ...(remember ? {} : { maxAge: accessMaxAge ? accessMaxAge * 1000 : undefined }),
  });
  res.cookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    baseCookieOptions(env, env.JWT_REFRESH_TTL_DAYS * 86_400),
  );

  // CSRF token: readable by the SPA, sent back in a header on writes.
  const csrf = randomBytes(24).toString('base64url');
  res.cookie(CSRF_COOKIE, csrf, {
    ...baseCookieOptions(env, env.JWT_REFRESH_TTL_DAYS * 86_400),
    httpOnly: false,
  });
  return csrf;
}

export function clearAuthCookies(res: Response, env: Env): void {
  const options = baseCookieOptions(env, 0);
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
  res.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false });
}
