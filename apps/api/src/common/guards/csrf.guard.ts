import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ENV_CONFIG, type Env } from '../../config/config.tokens';
import { AppException } from '../errors/app.exception';
import { headerValue, type HttpRequest } from '../http-request';
import { IS_PUBLIC_KEY } from '../decorators/permissions.decorator';
import { Reflector } from '@nestjs/core';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './auth-context.guard';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Double-submit cookie CSRF protection for the browser (cookie) session.
 *
 * A state-changing request that authenticates via the `kdc_access` cookie must
 * also present the `kdc_csrf` cookie value in the `x-kdc-csrf` header. An
 * attacker's cross-site form can make the browser send cookies but cannot read
 * the CSRF cookie (it is not HttpOnly by design) and therefore cannot forge the
 * header.
 *
 * Bearer-token and API-key requests are inherently immune (no ambient
 * credentials) and are skipped, as is multipart upload where the header check
 * still applies but the body is streamed.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.CSRF_ENABLED) return true;
    const handler = context.getHandler();
    const klass = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, klass])) {
      // Public routes that mutate state (login/register) do their own checks and
      // are not cookie-authenticated yet.
      return true;
    }

    const request = context.switchToHttp().getRequest<HttpRequest>();
    const method = String(request.method ?? 'GET').toUpperCase();
    if (!STATE_CHANGING.has(method)) return true;

    const cookies = request.cookies ?? {};
    const usingCookieAuth = Boolean(cookies[ACCESS_COOKIE]) && !hasBearer(request);
    if (!usingCookieAuth) return true;

    const cookieValue = cookies[CSRF_COOKIE];
    const headerValue = request.headers?.[CSRF_HEADER];
    if (!cookieValue || !headerValue || String(cookieValue) !== String(headerValue)) {
      throw new AppException(
        'csrf_failed',
        'CSRF validation failed: the request is missing a matching x-kdc-csrf header',
        undefined,
        403,
      );
    }
    return true;
  }
}

function hasBearer(request: HttpRequest): boolean {
  const header = headerValue(request, 'authorization');
  return header !== null && header.toLowerCase().startsWith('bearer ');
}
