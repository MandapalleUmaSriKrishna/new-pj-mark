/**
 * Krishna Digital Certificate - shared enumerations.
 * These values are persisted in the database and travel over the wire, so they
 * must never be renamed without a data migration.
 */

export const TENANT_TYPES = [
  'college',
  'school',
  'company',
  'ngo',
  'government',
  'event',
  'training_institute',
  'other',
] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const ROLES = ['owner', 'admin', 'manager', 'issuer', 'approver', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Fine grained permissions. Roles are mapped to permissions in `permissions.ts`. */
export const PERMISSIONS = [
  'tenant:read',
  'tenant:update',
  'tenant:delete',
  'branding:update',
  'domain:manage',
  'member:read',
  'member:invite',
  'member:update',
  'member:remove',
  'template:read',
  'template:create',
  'template:update',
  'template:delete',
  'event:read',
  'event:create',
  'event:update',
  'event:delete',
  'certificate:read',
  'certificate:issue',
  'certificate:bulk_issue',
  'certificate:approve',
  'certificate:reject',
  'certificate:revoke',
  'certificate:download',
  'certificate:resend',
  'import:create',
  'import:read',
  'audit:read',
  'analytics:read',
  'webhook:manage',
  'apikey:manage',
  'billing:read',
  'billing:manage',
  'notification:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const CERTIFICATE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'issued',
  'delivered',
  'revoked',
  'failed',
] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const EVENT_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'active', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = [
  'bulk_issue',
  'pdf_render',
  'email_delivery',
  'webhook_delivery',
  'import_parse',
  'certificate_revoke',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const PLAN_IDS = ['free', 'starter', 'growth', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const WEBHOOK_EVENTS = [
  'certificate.issued',
  'certificate.revoked',
  'certificate.viewed',
  'certificate.approved',
  'certificate.rejected',
  'certificate.delivery_failed',
  'event.created',
  'import.completed',
  'import.failed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const DELIVERY_CHANNELS = ['email', 'link', 'api'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/**
 * `captured` means the message was rendered and persisted (to disk or the
 * outbox) but NOT handed to a real mail server. It exists so that running
 * without SMTP credentials is visible in the UI instead of being presented as a
 * successful send.
 */
export const DELIVERY_STATUSES = [
  'pending',
  'captured',
  'sent',
  'delivered',
  'bounced',
  'failed',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const ASSET_KINDS = [
  'logo',
  'signature',
  'seal',
  'background',
  'template_image',
  'font',
  'certificate_pdf',
  'import_file',
  'export_file',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const SUPPORTED_LOCALES = ['en', 'hi', 'te', 'es', 'fr', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.login_failed',
  'auth.password_changed',
  'auth.google_connected',
  'tenant.created',
  'tenant.updated',
  'tenant.branding_updated',
  'tenant.domain_added',
  'tenant.domain_verified',
  'tenant.domain_removed',
  'member.invited',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'template.created',
  'template.updated',
  'template.deleted',
  'template.duplicated',
  'event.created',
  'event.updated',
  'event.deleted',
  'import.started',
  'import.completed',
  'import.failed',
  'certificate.created',
  'certificate.issued',
  'certificate.bulk_issued',
  'certificate.approved',
  'certificate.rejected',
  'certificate.revoked',
  'certificate.downloaded',
  'certificate.email_sent',
  'certificate.verified',
  'certificate.verification_failed',
  'apikey.created',
  'apikey.revoked',
  'webhook.created',
  'webhook.updated',
  'webhook.deleted',
  'webhook.delivered',
  'webhook.failed',
  'subscription.changed',
  'asset.uploaded',
  'asset.deleted',
  'settings.security_updated',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
