import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@kdc/shared';

export const PERMISSIONS_KEY = 'kdcRequiredPermissions';
export const PERMISSION_MODE_KEY = 'kdcPermissionMode';

/**
 * Declares the permission(s) a route requires. The guard resolves them against
 * the caller's role inside the tenant from the path.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const RequireAllPermissions = (...permissions: Permission[]) => [
  SetMetadata(PERMISSIONS_KEY, permissions),
  SetMetadata(PERMISSION_MODE_KEY, 'all'),
];

export const IS_PUBLIC_KEY = 'kdcIsPublic';
/** Marks a route as reachable without authentication (verify page, health, login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ALLOW_API_KEY_KEY = 'kdcAllowApiKey';
/** Permits programmatic access with an API key in addition to a session/JWT. */
export const AllowApiKey = (...scopes: string[]) =>
  SetMetadata(ALLOW_API_KEY_KEY, scopes.length ? scopes : ['*']);

export const RATE_LIMIT_KEY = 'kdcRateLimit';
export const RateLimit = (max: number, ttlSeconds = 60) =>
  SetMetadata(RATE_LIMIT_KEY, { max, ttlSeconds });
