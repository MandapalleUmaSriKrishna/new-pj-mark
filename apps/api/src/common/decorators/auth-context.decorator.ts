import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission, Role } from '@kdc/shared';

export interface AuthContext {
  userId: string | null;
  email: string | null;
  name: string | null;
  tenantId: string | null;
  role: Role | null;
  permissions: Permission[];
  /** How the request was authenticated. */
  via: 'jwt' | 'api_key' | 'anonymous';
  apiKeyId?: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export const ANONYMOUS_CONTEXT: AuthContext = {
  userId: null,
  email: null,
  name: null,
  tenantId: null,
  role: null,
  permissions: [],
  via: 'anonymous',
  requestId: '-',
  ip: null,
  userAgent: null,
};

export const AUTH_CONTEXT_KEY = 'kdcAuthContext';

/** Injects the resolved authentication + tenant context into a handler. */
export const AuthCtx = createParamDecorator(
  (data: keyof AuthContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>();
    const auth = request[AUTH_CONTEXT_KEY] ?? ANONYMOUS_CONTEXT;
    return data ? auth[data] : auth;
  },
);

/** The tenant id taken from the route (`/tenants/:tenantId/...`). */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ params?: { tenantId?: string } }>();
  return request.params?.tenantId ?? '';
});
