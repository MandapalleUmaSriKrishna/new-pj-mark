import type {
  ApiKey,
  Asset,
  AuditLog,
  CertificateEvent,
  CertificateStatus,
  ImportBatch,
  JobRecord,
  Permission,
  Plan,
  PlanId,
  Role,
  Subscription,
  Template,
  TemplateDoc,
  Tenant,
  TenantBranding,
  TenantDomain,
  TenantSettings,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
} from '@kdc/shared';

/**
 * View models for the API's JSON responses.
 *
 * These mirror the shapes the NestJS controllers actually return (verified
 * against a running server). They live in the web app rather than in
 * `@kdc/shared` because they are transport views, not domain entities - the
 * entities in `@kdc/shared` are what the API stores.
 */

/* -------------------------------------------------------------------- auth */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  locale: string;
  mfaEnabled: boolean;
  hasPassword: boolean;
  googleConnected: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  type: string;
  planId: PlanId;
  role: Role;
  permissions: Permission[];
  branding: TenantBranding;
  settings: TenantSettings;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  tokenType: string;
}

export interface AuthResult {
  user: PublicUser;
  tokens: IssuedTokens;
  tenants: TenantSummary[];
  csrfToken?: string;
}

export interface SessionResponse {
  user: PublicUser;
  tenants: TenantSummary[];
}

export interface RefreshResult {
  accessToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
  csrfToken: string;
}

export interface GoogleStatus {
  configured: boolean;
  reason?: string;
}

/* ----------------------------------------------------------------- tenants */

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  type: Tenant['type'];
  country: string;
  planId: PlanId;
  status: Tenant['status'];
  ownerEmail: string;
  branding: TenantBranding;
  settings: TenantSettings;
  usage: Tenant['usage'];
  primaryDomain: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantMembershipView {
  tenant: TenantView;
  role: Role;
  permissions: Permission[];
}

export interface DomainListResult {
  items: TenantDomain[];
  enabled: boolean;
  reason?: string;
}

/* --------------------------------------------------------------- templates */

export interface StarterDesignView {
  key: string;
  name: string;
  category: string;
  description: string;
  accent: string;
  doc: TemplateDoc;
}

export interface PreviewResult {
  /** Only present when the route returns JSON; the PDF itself comes as bytes. */
  warnings?: string[];
  sha256?: string;
  bytes?: number;
}

/* ------------------------------------------------------------------ events */

export interface EventCounts {
  total: number;
  issued: number;
  pending: number;
  revoked: number;
  delivered: number;
}

export interface EventView {
  id: string;
  name: string;
  slug: string;
  status: CertificateEvent['status'];
  programmeName: string | null;
  date: string | null;
  venue: string | null;
  templateId: string;
  templateName: string | null;
  requireApproval: boolean;
  autoDeliverEmail: boolean;
  counts: EventCounts;
  createdAt: string;
  updatedAt: string;
}

export interface EventLimits {
  plan: PlanId;
  maxEvents: number;
  used: number;
  remaining: number;
}

/* ------------------------------------------------------------ certificates */

export interface PublicCertificate {
  id: string;
  serial: string;
  tenantId: string;
  eventId: string;
  templateId: string;
  status: CertificateStatus;
  recipient: {
    name: string;
    email: string | null;
    title: string | null;
    department: string | null;
    rollNumber: string | null;
    grade: string | null;
    hours: string | null;
  };
  issuedAt: string | null;
  issuedAtDisplay: string;
  approvedBy: string | null;
  batchId: string | null;
  hasPdf: boolean;
  pdfSha256: string | null;
  downloadCount: number;
  viewCount: number;
  downloadExpiresAt: string | null;
  revocation: { reason: string; revokedAt: string; revokedBy: string } | null;
  failureReason: string | null;
  lastRenderedAt: string | null;
  verifyUrl: string;
  createdAt: string;
  integrityOk: boolean;
}

/** `POST /certificates/issue` also returns the one-time private download link. */
export interface IssuedCertificateView extends PublicCertificate {
  downloadToken: string;
  downloadUrl: string;
}

export interface CertificateStats {
  total: number;
  byStatus: Record<CertificateStatus | string, number>;
  thisMonth: number;
  revoked: number;
  verifications: number;
  downloads: number;
}

export interface BulkIssueResult {
  jobId: string;
  total: number;
  chunks: number;
  batchId: string;
}

export type VerificationResultKind =
  'valid' | 'revoked' | 'not_issued' | 'pending_approval' | 'not_found' | 'malformed' | 'invalid';

export interface VerificationResult {
  result: VerificationResultKind | string;
  serial: string;
  found: boolean;
  verifyUrl: string;
  checkedAt: string;
  certificate?: {
    status: CertificateStatus;
    recipient: {
      name: string;
      title: string | null;
      department: string | null;
      grade: string | null;
    };
    eventName: string | null;
    tenantName: string;
    tenantSlug: string;
    issuedAt: string | null;
    issuedAtDisplay: string;
    integrityOk: boolean;
    downloadCount: number;
    viewCount: number;
    revocation: { reason: string; revokedAt: string } | null;
    branding?: TenantBranding;
  };
  reason?: string;
}

/* ----------------------------------------------------------------- imports */

export interface CanonicalColumn {
  key: string;
  label: string;
  required?: boolean;
  sample?: string;
  aliases?: string[];
}

export interface ImportStageResult {
  batchId: string;
  fileName: string;
  fileType: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  mapping: Record<string, string>;
  unmappedColumns: string[];
  confidence: number;
  preview: Record<string, string | number | null>[];
  errors: { row: number; message: string; field?: string }[];
  canonicalColumns: CanonicalColumn[];
  nextStep: string;
}

export interface ImportIssueResult {
  jobId: string;
  batchId: string;
  queued: number;
  skipped: number;
  total: number;
  chunks: number;
}

/* ------------------------------------------------------------------- team */

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'invited' | 'active' | 'suspended' | string;
  permissions: Permission[];
  joinedAt: string | null;
  invitedBy: string | null;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InviteResult {
  membershipId: string;
  email: string;
  role: Role;
  queued: boolean;
  /** Present only when no SMTP credentials are configured. */
  inviteUrl: string | null;
}

export interface PendingInvite {
  membershipId: string;
  email: string;
  role: Role;
  inviteExpiresAt: string | null;
  createdAt: string;
}

/* --------------------------------------------------------------- analytics */

export interface TimeSeriesPoint {
  date: string;
  issued: number;
  verified: number;
  revoked: number;
}

export interface AnalyticsOverview {
  totals: {
    certificates: number;
    issued: number;
    pendingApproval: number;
    revoked: number;
    failed: number;
    events: number;
    templates: number;
    members: number;
    verifications: number;
    downloads: number;
  };
  quota: {
    plan: PlanId | string;
    used: number;
    limit: number;
    remaining: number;
    percent: number;
    resetsOn: string;
  };
  deliveries: Record<string, number>;
  series: TimeSeriesPoint[];
  topEvents: { id: string; name: string; issued: number; revoked: number; pending: number }[];
  recentActivity: {
    at: string;
    serial: string;
    recipientName: string;
    eventName: string;
    status: string;
  }[];
  verificationResults: Record<string, number>;
}

/* ------------------------------------------------------------------ audit */

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  brokenAt?: string | null;
  message?: string;
}

/* ------------------------------------------------------------- invitations */

export interface InvitationDetails {
  email: string;
  name: string;
  tenantName: string;
  role: Role;
  expiresAt: string | null;
  hasPassword: boolean;
}

export type AcceptInvitationResult = AuthResult & {
  tenantId: string;
  tenantName: string;
  role: Role;
};

/* ------------------------------------------------------- jobs and realtime */

export interface JobQueueCounts {
  driver: string;
  counts: Record<string, number>;
}

export interface StreamMessage {
  type: string;
  tenantId?: string;
  at?: string;
  payload?: Record<string, unknown>;
}

/* --------------------------------------------------------------- billing */

export interface BillingSummary {
  plan: Plan;
  subscription: Subscription | null;
  provider: 'manual' | 'stripe';
  usage: { certificatesThisMonth: number; quota: number; percent: number; resetsOn: string };
  upgrades: { id: PlanId; name: string; reason: string }[];
  blockers: string[];
  paymentConfigured: boolean;
  notice: string | null;
}

export interface PlanChangeResult {
  subscription: Subscription;
  charged: boolean;
  notice: string;
}

export interface InvoiceListResult {
  items: unknown[];
  configured: boolean;
  reason?: string;
}

/* -------------------------------------------------- webhooks and api keys */

export type RedactedWebhook = Omit<WebhookEndpoint, 'secret'> & { secretPreview: string };

export interface WebhookCreateResult {
  endpoint: RedactedWebhook;
  secret: string;
}

export interface WebhookTestResult {
  deliveryId: string;
  status: string;
  attempts: number;
  responseStatus: number;
  responseBody: string | null;
  error: string | null;
}

export interface ApiKeyCreateResult {
  key: ApiKey;
  plaintext: string;
  warning: string;
  usage: string;
}

export interface ApiKeyScopes {
  scopes: string[];
}

/* ----------------------------------------------------------------- assets */

export interface AssetView extends Asset {
  /** Signed, short-lived URL resolved by the API when storage signs through it. */
  url?: string | null;
}

/* ------------------------------------------------------------------ health */

export interface ComponentHealth {
  status: 'ok' | 'degraded' | 'down' | string;
  driver: string;
  detail?: string;
  latencyMs?: number;
}

export interface ConfigWarning {
  area: string;
  severity: 'critical' | 'warning' | 'info' | string;
  message: string;
  remedy?: string;
}

export interface HealthReport {
  status: string;
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, ComponentHealth>;
  capabilities: Record<string, boolean>;
  warnings: ConfigWarning[];
}

/* ------------------------------------------------------------ misc aliases */

export type { AuditLog, ImportBatch, JobRecord, Template, WebhookDelivery, WebhookEvent };

export interface ListResult<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
}
