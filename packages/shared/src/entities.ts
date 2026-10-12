import type {
  AssetKind,
  AuditAction,
  CertificateStatus,
  DeliveryChannel,
  DeliveryStatus,
  EventStatus,
  JobStatus,
  JobType,
  Locale,
  PlanId,
  Role,
  SubscriptionStatus,
  TenantType,
  WebhookEvent,
} from './enums';
import type { TemplateDoc } from './template';

/**
 * Driver-agnostic domain entities.
 *
 * The API persists these through a `Repository<T>` port that has two adapters:
 * MongoDB (production) and an in-process store (local dev without MongoDB, and
 * the automated test-suite). Keeping the entities free of Mongoose decorators is
 * what makes that swap possible and keeps tenant scoping explicit.
 */

export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoAssetId?: string | null;
  faviconAssetId?: string | null;
  emailBannerAssetId?: string | null;
  tagline?: string | null;
  website?: string | null;
  supportEmail?: string | null;
  fontFamily?: string | null;
  certificateFooterText?: string | null;
  /** Hide the platform mark on certificates and the verify page. */
  hidePoweredBy: boolean;
}

export interface TenantSettings {
  locale: Locale;
  timezone: string;
  serialPrefix: string;
  /** Require an approver to sign off before certificates are issued. */
  requireApproval: boolean;
  /** Auto-send the certificate e-mail when issuance completes. */
  autoDeliverEmail: boolean;
  /** Recipients may download their own certificate from the verify page. */
  allowSelfDownload: boolean;
  /** Self download additionally requires the recipient e-mail for a match. */
  selfDownloadRequiresEmail: boolean;
  /** Days after which the private download link expires (0 = never). */
  downloadLinkTtlDays: number;
  /** Retention for verification analytics. */
  verificationPublic: boolean;
  watermarkDrafts: boolean;
  defaultEmailSubject: string;
  defaultEmailBody: string;
}

export interface TenantQuotaUsage {
  certificatesThisMonth: number;
  monthKey: string; // YYYY-MM (UTC)
}

export interface Tenant extends BaseEntity {
  name: string;
  slug: string;
  type: TenantType;
  ownerEmail: string;
  country: string;
  planId: PlanId;
  branding: TenantBranding;
  settings: TenantSettings;
  usage: TenantQuotaUsage;
  /** Tenant-scoped data encryption key, itself wrapped by the master key. */
  wrappedDek: string;
  status: 'active' | 'suspended' | 'pending_verification';
  primaryDomain?: string | null;
  deletedAt?: Date | null;
}

export interface TenantDomain extends BaseEntity {
  tenantId: string;
  hostname: string;
  status: 'pending' | 'verified' | 'failed';
  verificationToken: string;
  sslStatus: 'none' | 'provisioning' | 'ready' | 'failed';
  isPrimary: boolean;
  lastCheckedAt?: Date | null;
  dnsRecords: { type: 'CNAME' | 'TXT'; host: string; value: string }[];
}

export interface User extends BaseEntity {
  email: string;
  emailVerified: boolean;
  name: string;
  passwordHash?: string | null;
  googleId?: string | null;
  googleEmail?: string | null;
  avatarUrl?: string | null;
  locale: Locale;
  status: 'active' | 'invited' | 'suspended';
  lastLoginAt?: Date | null;
  mfaEnabled: boolean;
  /** Hashed refresh-token family, used for rotation + reuse detection. */
  refreshTokenFamily?: string | null;
}

export interface Membership extends BaseEntity {
  tenantId: string;
  userId: string;
  role: Role;
  status: 'active' | 'invited' | 'suspended';
  invitedBy?: string | null;
  inviteToken?: string | null;
  inviteExpiresAt?: Date | null;
  joinedAt?: Date | null;
}

export interface Template extends BaseEntity {
  tenantId: string;
  name: string;
  description?: string | null;
  doc: TemplateDoc;
  thumbnailAssetId?: string | null;
  category: string;
  isStarter: boolean;
  version: number;
  createdBy: string;
  locked: boolean;
}

export interface EventField {
  key: string;
  label: string;
  required: boolean;
  type: 'text' | 'number' | 'date' | 'email';
}

export interface CertificateEvent extends BaseEntity {
  tenantId: string;
  name: string;
  slug: string;
  description?: string | null;
  templateId: string;
  status: EventStatus;
  /** Programme metadata used by merge fields. */
  programmeName: string;
  programmeDescription?: string | null;
  date?: Date | null;
  venue?: string | null;
  organiser?: string | null;
  requireApproval: boolean;
  autoDeliverEmail: boolean;
  emailSubject?: string | null;
  emailBody?: string | null;
  extraFields: EventField[];
  createdBy: string;
  issuedCount: number;
  revokedCount: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface Recipient {
  name: string;
  email?: string | null;
  title?: string | null;
  department?: string | null;
  rollNumber?: string | null;
  grade?: string | null;
  hours?: string | null;
  /** Arbitrary additional columns captured from the import file. */
  meta?: Record<string, string> | null;
}

export interface RevocationInfo {
  reason: string;
  revokedBy: string;
  revokedAt: Date;
  notifyRecipient: boolean;
}

export interface Certificate extends BaseEntity {
  tenantId: string;
  eventId: string;
  templateId: string;
  serial: string;
  recipient: Recipient;
  /** Encrypted at rest with the tenant DEK. */
  recipientEmailEnc?: string | null;
  status: CertificateStatus;
  issuedAt?: Date | null;
  issuedBy?: string | null;
  approvedBy?: string | null;
  approvalNote?: string | null;
  pdfAssetId?: string | null;
  pdfSha256?: string | null;
  downloadToken?: string | null;
  downloadTokenHash?: string | null;
  downloadExpiresAt?: Date | null;
  downloadCount: number;
  viewCount: number;
  batchId?: string | null;
  revocation?: RevocationInfo | null;
  /** HMAC over (tenantId|serial|recipient|issuedAt) - proves non-tampering. */
  integritySignature: string;
  mergeValues: Record<string, string>;
  metadata: Record<string, string>;
  lastRenderedAt?: Date | null;
  failureReason?: string | null;
}

export interface ImportBatch extends BaseEntity {
  tenantId: string;
  eventId: string;
  fileName: string;
  fileType: 'csv' | 'xlsx';
  status: 'parsing' | 'parsed' | 'queued' | 'processing' | 'completed' | 'failed';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  issuedRows: number;
  failedRows: number;
  columnMapping: Record<string, string>;
  errors: { row: number; message: string; field?: string }[];
  preview: Record<string, string>[];
  jobId?: string | null;
  uploadedBy: string;
  completedAt?: Date | null;
}

export interface ApprovalRequest extends BaseEntity {
  tenantId: string;
  eventId: string;
  certificateId: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string | null;
  decidedAt?: Date | null;
  note?: string | null;
  reason?: string | null;
}

export interface Delivery extends BaseEntity {
  tenantId: string;
  certificateId: string;
  channel: DeliveryChannel;
  to: string;
  status: DeliveryStatus;
  subject?: string | null;
  attempts: number;
  lastError?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date | null;
  openedAt?: Date | null;
}

export interface AuditLog extends BaseEntity {
  tenantId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: Role | 'system' | 'anonymous' | 'api_key' | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  /** Redacted, safe-for-storage description of the change. */
  payload: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  /** SHA-256(prevHash || canonical(payload)) -> tamper-evident chain. */
  prevHash: string;
  hash: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface WebhookEndpoint extends BaseEntity {
  tenantId: string;
  url: string;
  events: WebhookEvent[];
  secret: string; // HMAC key; stored encrypted
  active: boolean;
  description?: string | null;
  failureCount: number;
  disabledAt?: Date | null;
  lastDeliveryAt?: Date | null;
  lastStatus?: number | null;
  createdBy: string;
}

export interface WebhookDelivery extends BaseEntity {
  tenantId: string;
  webhookId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  signature: string;
  status: 'pending' | 'succeeded' | 'failed' | 'abandoned';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: Date | null;
  responseStatus?: number | null;
  responseBody?: string | null;
  lastError?: string | null;
  succeededAt?: Date | null;
}

export interface ApiKey extends BaseEntity {
  tenantId: string;
  name: string;
  keyId: string;
  /** SHA-256 of the secret. The plaintext is shown exactly once. */
  secretHash: string;
  prefix: string;
  scopes: string[];
  active: boolean;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
  createdBy: string;
}

export interface Asset extends BaseEntity {
  tenantId: string | null;
  kind: AssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
  width?: number | null;
  height?: number | null;
  uploadedBy?: string | null;
  /** Public assets (logos on the verify page) may be served unauthenticated. */
  isPublic: boolean;
}

export interface JobRecord extends BaseEntity {
  tenantId: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  driver: 'bullmq' | 'memory';
  attempts: number;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdBy?: string | null;
}

export interface Subscription extends BaseEntity {
  tenantId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  seats: number;
  interval: 'month' | 'year';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  /**
   * `manual` = changed in-app with no PSP attached (the default in this repo,
   * because no payment credentials are bundled). `stripe` is populated only
   * when STRIPE_* env vars are supplied and the adapter is enabled.
   */
  provider: 'manual' | 'stripe';
  providerSubscriptionId?: string | null;
  trialEndsAt?: Date | null;
}

export interface VerificationEvent extends BaseEntity {
  tenantId: string;
  certificateId: string;
  serial: string;
  result: 'valid' | 'revoked' | 'not_found' | 'malformed';
  ip: string | null;
  userAgent: string | null;
  country?: string | null;
  referer?: string | null;
}

export interface NotificationPreference extends BaseEntity {
  tenantId: string;
  userId: string;
  emailIssuanceComplete: boolean;
  emailApprovalNeeded: boolean;
  emailQuotaWarning: boolean;
  emailWeeklyDigest: boolean;
  webhookFailures: boolean;
}

export interface RefreshTokenRecord extends BaseEntity {
  userId: string;
  family: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  replacedBy?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}
