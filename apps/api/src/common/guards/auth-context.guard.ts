import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ApiKey, Membership, Tenant, User } from '@kdc/shared';

/** Shape the guard needs; kept local so it does not depend on the api-keys module. */
type ApiKeyRecord = ApiKey;
import { permissionsForRole } from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../../config/config.tokens';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { DATA_STORE, type DataStore, type Repository } from '../../infra/persistence/repository';
import { AppException } from '../errors/app.exception';
import { headerValue, type HttpRequest } from '../http-request';
import { ALLOW_API_KEY_KEY, IS_PUBLIC_KEY } from '../decorators/permissions.decorator';
import {
  AUTH_CONTEXT_KEY,
  ANONYMOUS_CONTEXT,
  type AuthContext,
} from '../decorators/auth-context.decorator';

export const ACCESS_COOKIE = 'kdc_access';
export const REFRESH_COOKIE = 'kdc_refresh';
export const CSRF_COOKIE = 'kdc_csrf';
export const CSRF_HEADER = 'x-kdc-csrf';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
  /** Tenant the token was minted for, when the user switched context. */
  tid?: string;
  typ: 'access';
}

/**
 * Resolves WHO is calling and WHICH tenant they are acting in.
 *
 * Accepts, in order:
 *   1. `Authorization: Bearer <jwt>` - used by the PWA and mobile clients.
 *   2. `kdc_access` cookie - used by the browser app.
 *   3. An API key (`Authorization: Bearer kdc_...` or `X-API-Key`) - used by
 *      integrations; only on routes explicitly marked `@AllowApiKey()`.
 *
 * Tenant isolation happens here: when the route contains `:tenantId`, the guard
 * loads the caller's Membership for exactly that tenant and refuses the request
 * if there is none. Downstream services therefore never have to remember to add
 * a tenant filter - the request cannot reach them without an established,
 * permission-bearing tenant context.
 */
@Injectable()
export class AuthContextGuard implements CanActivate {
  private readonly logger = new Logger(AuthContextGuard.name);
  private readonly users: Repository<User>;
  private readonly memberships: Repository<Membership>;
  private readonly tenants: Repository<Tenant>;
  private readonly apiKeys: Repository<ApiKeyRecord>;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    @Inject(DATA_STORE) store: DataStore,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {
    this.users = store.repository<User>('users');
    this.memberships = store.repository<Membership>('memberships');
    this.tenants = store.repository<Tenant>('tenants');
    this.apiKeys = store.repository<ApiKeyRecord>('api_keys');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const handler = context.getHandler();
    const klass = context.getClass();

    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, klass]) === true;
    const apiKeyScopes = this.reflector.getAllAndOverride<string[] | undefined>(ALLOW_API_KEY_KEY, [
      handler,
      klass,
    ]);

    const base: AuthContext = {
      ...ANONYMOUS_CONTEXT,
      requestId: request.requestId ?? headerValue(request, 'x-request-id') ?? '-',
      ip: extractIp(request, this.env.TRUST_PROXY),
      userAgent: String(request.headers?.['user-agent'] ?? '').slice(0, 512) || null,
    };

    const apiKey = extractApiKey(request);
    if (apiKey) {
      if (!apiKeyScopes)
        throw AppException.forbidden('This endpoint does not accept API key authentication');
      const ctx = await this.authenticateApiKey(apiKey, apiKeyScopes, base, request);
      request[AUTH_CONTEXT_KEY] = ctx;
      return true;
    }

    const token = extractBearer(request) ?? request.cookies?.[ACCESS_COOKIE] ?? null;
    if (!token) {
      if (isPublic) {
        request[AUTH_CONTEXT_KEY] = base;
        return true;
      }
      throw AppException.unauthenticated('Missing authentication token');
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        issuer: 'kdc-api',
        audience: 'kdc-app',
      });
    } catch (err) {
      const message =
        (err as Error).name === 'TokenExpiredError'
          ? 'Session expired, please sign in again'
          : 'Invalid authentication token';
      if (isPublic) {
        request[AUTH_CONTEXT_KEY] = base;
        return true;
      }
      throw new AppException('token_expired', message, undefined, 401);
    }
    if (claims.typ !== 'access') throw AppException.unauthenticated('Wrong token type');

    const user = await this.users.findById(claims.sub);
    if (!user || user.status !== 'active') {
      if (isPublic) {
        request[AUTH_CONTEXT_KEY] = base;
        return true;
      }
      throw AppException.unauthenticated('Account is not active');
    }

    const ctx: AuthContext = {
      ...base,
      userId: user.id,
      email: user.email,
      name: user.name,
      via: 'jwt',
    };

    // Resolve tenant context from the route, then from the token claim.
    const routeTenantId: string | undefined = request.params?.tenantId;
    const tenantId = routeTenantId ?? claims.tid ?? null;

    if (tenantId) {
      const membership = await this.memberships.findOne({ tenantId, userId: user.id });
      if (!membership) {
        if (isPublic) {
          request[AUTH_CONTEXT_KEY] = ctx;
          return true;
        }
        // Do not reveal whether the tenant exists.
        throw AppException.tenantNotFound();
      }
      if (membership.status !== 'active')
        throw AppException.forbidden('Your membership is not active');
      const tenant = await this.tenants.findById(tenantId);
      if (!tenant || tenant.deletedAt) throw AppException.tenantNotFound();
      if (tenant.status === 'suspended')
        throw AppException.forbidden('This organisation is suspended');
      ctx.tenantId = tenantId;
      ctx.role = membership.role;
      ctx.permissions = permissionsForRole(membership.role);
    }

    request[AUTH_CONTEXT_KEY] = ctx;
    request.user = user;
    return true;
  }

  private async authenticateApiKey(
    raw: string,
    allowedScopes: string[],
    base: AuthContext,
    request: HttpRequest,
  ): Promise<AuthContext> {
    const [keyId, secret] = raw.split('.');
    if (!keyId || !secret) throw AppException.unauthenticated('Malformed API key');
    const repo = this.apiKeys;
    const record = await repo.findOne({ keyId });
    if (!record || record.active !== true)
      throw AppException.unauthenticated('Unknown or revoked API key');
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      throw AppException.unauthenticated('API key has expired');
    }
    const expected = this.crypto.hashApiKey(secret);
    if (!this.crypto.safeEqual(expected, String(record.secretHash))) {
      this.logger.warn(`Rejected API key with wrong secret for keyId=${keyId}`);
      throw AppException.unauthenticated('Invalid API key secret');
    }
    const scopes: string[] = record.scopes ?? [];
    if (!allowedScopes.includes('*') && !scopes.some((s) => allowedScopes.includes(s))) {
      throw AppException.forbidden('API key does not have the required scope');
    }
    const tenantId = request.params?.tenantId ?? record.tenantId;
    if (request.params?.tenantId && record.tenantId !== request.params.tenantId) {
      throw AppException.forbidden('API key is not valid for this organisation');
    }
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.status !== 'active') throw AppException.tenantNotFound();
    await repo.updateById(record.id, { lastUsedAt: new Date() });
    return {
      ...base,
      userId: record.createdBy ?? null,
      email: `apikey:${record.name}`,
      name: record.name,
      tenantId,
      role: 'admin',
      permissions: permissionsForRole('admin'),
      via: 'api_key',
      apiKeyId: record.id,
    };
  }
}

export function extractBearer(request: HttpRequest): string | null {
  const header = request.headers?.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (!value) return null;
  if (scheme?.toLowerCase() !== 'bearer') return null;
  if (value.startsWith('kdc_')) return null; // API key, handled separately
  return value;
}

export function extractApiKey(request: HttpRequest): string | null {
  const headerKey = request.headers?.['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.startsWith('kdc_')) return headerKey;
  const header = request.headers?.authorization;
  if (typeof header === 'string') {
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && value?.startsWith('kdc_')) return value;
  }
  return null;
}

export function extractIp(request: HttpRequest, trustProxy: boolean): string | null {
  if (!trustProxy) return String(request.ip ?? request.socket?.remoteAddress ?? '') || null;
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim().slice(0, 64);
  }
  return String(request.ip ?? request.socket?.remoteAddress ?? '') || null;
}
