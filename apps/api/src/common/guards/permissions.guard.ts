import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@kdc/shared';
import { AppException } from '../errors/app.exception';
import {
  PERMISSION_MODE_KEY,
  PERMISSIONS_KEY,
  IS_PUBLIC_KEY,
} from '../decorators/permissions.decorator';
import { AUTH_CONTEXT_KEY, type AuthContext } from '../decorators/auth-context.decorator';

/**
 * RBAC enforcement.
 *
 * Permissions come from the caller's role *inside the tenant they are acting
 * in* (resolved by AuthContextGuard), never from a global flag. A user who is an
 * owner of tenant A gets nothing in tenant B.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const klass = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, klass])) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      handler,
      klass,
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>();
    const auth = request[AUTH_CONTEXT_KEY];
    if (!auth) throw AppException.unauthenticated();

    if (auth.via === 'api_key') {
      // API keys authenticate the tenant; the route still has to be marked
      // @AllowApiKey() (checked in AuthContextGuard) for this to be reachable.
      return true;
    }

    if (!auth.userId) throw AppException.unauthenticated();
    if (!auth.tenantId) {
      throw AppException.forbidden('No organisation context for this request');
    }
    if (!auth.role) throw AppException.forbidden('You are not a member of this organisation');

    const mode =
      this.reflector.getAllAndOverride<'all' | 'any'>(PERMISSION_MODE_KEY, [handler, klass]) ??
      'any';
    const granted =
      mode === 'all'
        ? required.every((p) => auth.permissions.includes(p))
        : required.some((p) => auth.permissions.includes(p));

    if (!granted) {
      throw AppException.permissionDenied(required.join(' or '));
    }
    return true;
  }
}
