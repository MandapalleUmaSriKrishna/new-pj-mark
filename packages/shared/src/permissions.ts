import { PERMISSIONS, ROLES, type Permission, type Role } from './enums';

/**
 * RBAC matrix. `owner` and `admin` have (near) full control inside a tenant;
 * the remaining roles are scoped so large organisations can delegate safely.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'tenant:delete'),
  manager: [
    'tenant:read',
    'branding:update',
    'member:read',
    'member:invite',
    'member:update',
    'template:read',
    'template:create',
    'template:update',
    'event:read',
    'event:create',
    'event:update',
    'certificate:read',
    'certificate:issue',
    'certificate:bulk_issue',
    'certificate:approve',
    'certificate:reject',
    'certificate:download',
    'certificate:resend',
    'certificate:revoke',
    'import:create',
    'import:read',
    'audit:read',
    'analytics:read',
    'notification:manage',
  ],
  issuer: [
    'tenant:read',
    'template:read',
    'event:read',
    'certificate:read',
    'certificate:issue',
    'certificate:bulk_issue',
    'certificate:download',
    'certificate:resend',
    'import:create',
    'import:read',
    'analytics:read',
  ],
  approver: [
    'tenant:read',
    'template:read',
    'event:read',
    'certificate:read',
    'certificate:approve',
    'certificate:reject',
    'certificate:download',
    'import:read',
    'analytics:read',
  ],
  viewer: ['tenant:read', 'template:read', 'event:read', 'certificate:read', 'analytics:read'],
};

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => roleHasPermission(role, p));
}

export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => roleHasPermission(role, p));
}

/** Roles ordered most -> least privileged. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 60,
  admin: 50,
  manager: 40,
  issuer: 30,
  approver: 20,
  viewer: 10,
};

/** A member may only manage roles strictly below their own rank. */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner';
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

export const ASSIGNABLE_ROLES: Record<Role, Role[]> = {
  owner: ['admin', 'manager', 'issuer', 'approver', 'viewer'],
  admin: ['manager', 'issuer', 'approver', 'viewer'],
  manager: ['issuer', 'approver', 'viewer'],
  issuer: [],
  approver: [],
  viewer: [],
};

export const ALL_ROLES: Role[] = [...ROLES];
