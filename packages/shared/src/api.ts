/**
 * HTTP contract shared by the API and the web client: route prefixes, error
 * codes and the response envelope. Importing these constants instead of
 * repeating string literals is what keeps the two apps from drifting.
 */

export const API_PREFIX = 'api/v1';

export const ROUTES = {
  health: `/${API_PREFIX}/health`,
  readiness: `/${API_PREFIX}/health/ready`,
  authRegister: `/${API_PREFIX}/auth/register`,
  authLogin: `/${API_PREFIX}/auth/login`,
  authRefresh: `/${API_PREFIX}/auth/refresh`,
  authLogout: `/${API_PREFIX}/auth/logout`,
  authMe: `/${API_PREFIX}/auth/me`,
  authGoogleStart: `/${API_PREFIX}/auth/google`,
  authGoogleCallback: `/${API_PREFIX}/auth/google/callback`,
  authGoogleStatus: `/${API_PREFIX}/auth/google/status`,
  authPasswordChange: `/${API_PREFIX}/auth/password`,
  authInvite: `/${API_PREFIX}/auth/invite`,
  authInviteAccept: `/${API_PREFIX}/auth/invite/accept`,
  tenants: `/${API_PREFIX}/tenants`,
  members: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/members`,
  templates: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/templates`,
  events: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/events`,
  certificates: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/certificates`,
  imports: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/imports`,
  approvals: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/approvals`,
  audit: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/audit`,
  analytics: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/analytics`,
  webhooks: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/webhooks`,
  apiKeys: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/api-keys`,
  assets: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/assets`,
  jobs: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/jobs`,
  billing: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/billing`,
  domains: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/domains`,
  stream: (tenantId: string) => `/${API_PREFIX}/tenants/${tenantId}/stream`,
  // Public, unauthenticated surface
  publicVerify: `/${API_PREFIX}/public/verify`,
  publicCertificatePdf: (serial: string) => `/${API_PREFIX}/public/certificates/${serial}.pdf`,
  publicTenantByHost: `/${API_PREFIX}/public/tenant-by-host`,
} as const;

/** Machine readable error codes. The UI maps these to localised messages. */
export const ERROR_CODES = {
  validation_failed: 'validation_failed',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  tenant_not_found: 'tenant_not_found',
  tenant_suspended: 'tenant_suspended',
  not_found: 'not_found',
  conflict: 'conflict',
  email_taken: 'email_taken',
  slug_taken: 'slug_taken',
  serial_taken: 'serial_taken',
  invalid_credentials: 'invalid_credentials',
  token_expired: 'token_expired',
  token_reuse_detected: 'token_reuse_detected',
  quota_exceeded: 'quota_exceeded',
  feature_not_available: 'feature_not_available',
  oauth_not_configured: 'oauth_not_configured',
  mail_not_configured: 'mail_not_configured',
  storage_not_configured: 'storage_not_configured',
  billing_not_configured: 'billing_not_configured',
  billing_not_implemented: 'billing_not_implemented',
  unsupported_file_type: 'unsupported_file_type',
  file_too_large: 'file_too_large',
  import_failed: 'import_failed',
  template_invalid: 'template_invalid',
  certificate_not_issued: 'certificate_not_issued',
  certificate_revoked: 'certificate_revoked',
  approval_required: 'approval_required',
  rate_limited: 'rate_limited',
  csrf_failed: 'csrf_failed',
  internal_error: 'internal_error',
  service_unavailable: 'service_unavailable',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  statusCode: number;
  error: ErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
  /** Present only when the tenant must upgrade to continue. */
  requiredPlan?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: { requestId: string; tookMs: number };
}

export function isApiError(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'statusCode' in value &&
    'error' in value &&
    'message' in value
  );
}

export const HTTP_STATUS_FOR_ERROR: Record<string, number> = {
  validation_failed: 400,
  template_invalid: 400,
  unsupported_file_type: 400,
  import_failed: 400,
  malformed_serial: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  token_expired: 401,
  token_reuse_detected: 401,
  csrf_failed: 403,
  forbidden: 403,
  tenant_suspended: 403,
  feature_not_available: 403,
  certificate_revoked: 403,
  not_found: 404,
  tenant_not_found: 404,
  certificate_not_issued: 404,
  conflict: 409,
  email_taken: 409,
  slug_taken: 409,
  serial_taken: 409,
  quota_exceeded: 402,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
  oauth_not_configured: 503,
  mail_not_configured: 503,
  storage_not_configured: 503,
  billing_not_configured: 503,
  billing_not_implemented: 501,
};

/** Webhook signature header names (also documented in docs/API.md). */
export const WEBHOOK_HEADERS = {
  signature: 'x-kdc-signature',
  timestamp: 'x-kdc-timestamp',
  deliveryId: 'x-kdc-delivery-id',
  event: 'x-kdc-event',
} as const;

/** Maximum tolerated clock skew when a consumer verifies a webhook signature. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
