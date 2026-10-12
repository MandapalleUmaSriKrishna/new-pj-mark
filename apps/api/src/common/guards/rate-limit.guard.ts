import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENV_CONFIG, type Env } from '../../config/config.tokens';
import { CACHE_PORT, type CachePort } from '../../infra/cache/cache.port';
import { AppException } from '../errors/app.exception';
import type { HttpRequest } from '../http-request';
import { IS_PUBLIC_KEY, RATE_LIMIT_KEY } from '../decorators/permissions.decorator';
import { AUTH_CONTEXT_KEY, type AuthContext } from '../decorators/auth-context.decorator';
import { extractIp } from './auth-context.guard';

/**
 * Rate limiting backed by the cache port, so it is shared across replicas when
 * CACHE_DRIVER=redis and still correct on a single node with the memory driver.
 *
 * Keys are built from (route bucket, tenant, then user or IP). Tenant first
 * means one abusive client cannot exhaust the budget of a different
 * organisation, and per-user keys mean one user cannot exhaust their tenant's.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.env.RATE_LIMIT_DISABLED) return true;
    const handler = context.getHandler();
    const klass = context.getClass();
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, klass]) === true;

    const override = this.reflector.getAllAndOverride<
      { max: number; ttlSeconds: number } | undefined
    >(RATE_LIMIT_KEY, [handler, klass]);
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const method = String(request.method ?? 'GET').toUpperCase();
    const path = String(request.route?.path ?? request.url ?? '').split('?')[0]!;
    const auth = request[AUTH_CONTEXT_KEY] as AuthContext | undefined;

    // Reads are cheap; writes and public endpoints get tighter budgets.
    const budget = override ?? {
      max: isPublic ? this.env.VERIFY_RATE_LIMIT_MAX : this.env.RATE_LIMIT_MAX,
      ttlSeconds: this.env.RATE_LIMIT_TTL_SECONDS,
    };

    const identity =
      auth?.via === 'api_key'
        ? `key:${auth.apiKeyId}`
        : auth?.userId
          ? `user:${auth.userId}`
          : `ip:${extractIp(request, this.env.TRUST_PROXY) ?? 'unknown'}`;
    const tenantPart = auth?.tenantId ? `:${auth.tenantId}` : '';
    const key = `rl:${method}:${path}${tenantPart}:${identity}`;

    const { count, ttlSeconds } = await this.cache.incr(key, budget.ttlSeconds);
    const response = context
      .switchToHttp()
      .getResponse<{ setHeader?: (name: string, value: string) => void }>();
    response.setHeader?.('X-RateLimit-Limit', String(budget.max));
    response.setHeader?.('X-RateLimit-Remaining', String(Math.max(0, budget.max - count)));
    response.setHeader?.('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + ttlSeconds));

    if (count > budget.max) {
      response.setHeader?.('Retry-After', String(ttlSeconds));
      throw AppException.rateLimited(ttlSeconds);
    }
    return true;
  }
}
