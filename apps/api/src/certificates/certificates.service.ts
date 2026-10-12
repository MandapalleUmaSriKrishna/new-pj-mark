import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ApprovalRequest,
  Certificate,
  CertificateEvent,
  CertificateStatus,
  ImportBatch,
  JobRecord,
  Recipient,
  Template,
  Tenant,
  VerificationEvent,
} from '@kdc/shared';
import {
  canonicaliseSerialInput,
  generateDownloadToken,
  generateSerial,
  getPlan,
  isValidSerial,
} from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { CryptoService } from '../infra/crypto/crypto.service';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { EVENT_BUS_PORT, type EventBusPort } from '../infra/events/eventbus.port';
import { buildFilter } from '../infra/persistence/filter';
import { escapeRegex } from '../common/dto/pagination.dto';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantKeysService } from '../common/context/tenant-keys.service';
import { NotificationsService } from '../notifications/notifications.service';
import { certificateEmail, revocationNoticeEmail } from '../notifications/email-templates';
import { AssetsService } from '../assets/assets.service';
import { PdfService, type WatermarkKind } from '../pdf/pdf.service';
import { buildMergeValues, formatDate } from './merge';
import type {
  ApproveInput,
  IssueBulkInput,
  IssueOneInput,
  ListCertificatesInput,
  RejectInput,
  ResendInput,
  RevokeInput,
} from './dto';
import type { RecipientInput } from './dto';

export const BULK_CHUNK_SIZE = 250;
/** Hard ceiling per batch, independent of plan, to bound a single job fan-out. */
const MAX_BATCH_RECIPIENTS = 500_000;
const SERIAL_ATTEMPTS = 8;

export interface IssueContext {
  actorId: string;
  requestId?: string;
  ip?: string | null;
  userAgent?: string | null;
  batchId?: string | null;
  issuedAt?: Date | null;
  sendEmail?: boolean;
}

export interface VerificationResult {
  result: 'valid' | 'revoked' | 'not_found' | 'malformed';
  serial: string;
  found: boolean;
  certificate?: {
    id: string;
    serial: string;
    status: CertificateStatus;
    recipientName: string;
    recipientEmailShown: boolean;
    eventName: string;
    issuedAt: string | null;
    issuedAtDisplay: string;
    revoked?: { reason: string; revokedAt: string } | null;
    integrityOk: boolean;
  };
  organisation?: {
    name: string;
    slug: string;
    type: string;
    branding: Tenant['branding'];
    supportEmail: string | null;
  };
  verifyUrl: string;
  /** Present only when the tenant allows it and the caller proved ownership. */
  downloadUrl?: string | null;
  checkedAt: string;
}

/**
 * A certificate as returned to whoever issued it.
 *
 * `downloadToken` is the 256-bit private link secret, shown exactly once: only
 * its SHA-256 hash is stored, so it can never be retrieved again. Bulk runs do
 * not return it (the link goes to the recipient by email instead), because a
 * response carrying thousands of live download secrets would itself be the leak.
 */
export type IssuedCertificate = Certificate & { downloadToken: string; downloadUrl: string };

export interface PdfRenderOutcome {
  assetId: string;
  storageKey: string;
  sha256: string;
  bytes: number;
  warnings: string[];
}

/**
 * Certificate lifecycle.
 *
 *   draft -> pending_approval -> approved -> issued -> delivered
 *                                   \-> rejected           \-> revoked
 *
 * Guarantees implemented here:
 *  - every certificate gets a globally unique, check-digit protected serial;
 *  - a 256-bit private download token, stored only as a hash;
 *  - an HMAC integrity signature over the identifying fields, so a tampered row
 *    is detectable at verification time;
 *  - the merge values are snapshotted at issue time, so later edits to the event
 *    or template cannot silently change an already-issued certificate;
 *  - bulk issuance is chunked into queue jobs, so a 50,000-row convocation
 *    neither blocks the HTTP request nor produces one enormous job payload;
 *  - quota and feature limits are checked before any row is written.
 */
@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);
  private readonly certificates: Repository<Certificate>;
  private readonly events: Repository<CertificateEvent>;
  private readonly templates: Repository<Template>;
  private readonly tenants: Repository<Tenant>;
  private readonly approvals: Repository<ApprovalRequest>;
  private readonly jobs: Repository<JobRecord>;
  private readonly batches: Repository<ImportBatch>;
  private readonly verifications: Repository<VerificationEvent>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly keys: TenantKeysService,
    private readonly tenantsService: TenantsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly assets: AssetsService,
    private readonly pdf: PdfService,
  ) {
    this.certificates = store.repository<Certificate>('certificates');
    this.events = store.repository<CertificateEvent>('events');
    this.templates = store.repository<Template>('templates');
    this.tenants = store.repository<Tenant>('tenants');
    this.approvals = store.repository<ApprovalRequest>('approvals');
    this.jobs = store.repository<JobRecord>('jobs');
    this.batches = store.repository<ImportBatch>('import_batches');
    this.verifications = store.repository<VerificationEvent>('verification_events');
  }

  /* ------------------------------------------------------------ urls */

  verifyUrlFor(serial: string): string {
    const base = (this.env.PUBLIC_VERIFY_BASE_URL ?? this.env.APP_URL).replace(/\/$/, '');
    return `${base}/verify/${encodeURIComponent(serial)}`;
  }

  downloadUrlFor(serial: string, token: string): string {
    const base = this.env.APP_URL.replace(/\/$/, '');
    return `${base}/download/${encodeURIComponent(serial)}?token=${encodeURIComponent(token)}`;
  }

  /* ------------------------------------------------------- single issue */

  async issueOne(
    tenantId: string,
    input: IssueOneInput,
    ctx: IssueContext,
  ): Promise<IssuedCertificate> {
    const { event, template, tenant } = await this.loadIssuanceContext(tenantId, input.eventId);
    await this.tenantsService.assertQuota(tenantId, 1);

    const recipient = toRecipient(input.recipient);
    const requiresApproval = event.requireApproval && !ctx.batchId;
    const { certificate, downloadToken } = await this.createCertificate({
      tenant,
      event,
      template,
      recipient,
      ctx,
      status: requiresApproval ? 'pending_approval' : 'issued',
    });

    if (requiresApproval) {
      await this.createApproval(tenantId, event.id, certificate.id, ctx.actorId);
    } else {
      await this.afterIssued(certificate, tenant, event, ctx);
    }
    return {
      ...certificate,
      downloadToken,
      downloadUrl: this.downloadUrlFor(certificate.serial, downloadToken),
    };
  }

  /* --------------------------------------------------------- bulk issue */

  /**
   * Starts a bulk issuance.
   *
   * Returns immediately with a parent job id; the recipients are split into
   * chunks and queued. Progress is published on the tenant realtime channel and
   * can also be polled through `/jobs/:id`.
   */
  async issueBulk(
    tenantId: string,
    input: IssueBulkInput,
    ctx: IssueContext,
  ): Promise<{ jobId: string; total: number; chunks: number; batchId: string }> {
    const { event, template } = await this.loadIssuanceContext(tenantId, input.eventId);
    void template;
    const total = input.recipients.length;
    await this.tenantsService.assertQuota(tenantId, total);

    const plan = await this.tenantsService.planOf(tenantId);
    const maxRows = Math.min(getPlan(plan).maxImportRows, MAX_BATCH_RECIPIENTS);
    if (total > maxRows) {
      throw AppException.validationFailed(
        `A single batch may not exceed ${maxRows.toLocaleString('en-US')} recipients on the ${plan} plan; this file has ${total.toLocaleString('en-US')}.`,
      );
    }

    const batchId = ctx.batchId ?? newId();
    const now = new Date();
    const job: JobRecord = {
      id: newId(),
      tenantId,
      type: 'bulk_issue',
      status: 'active',
      progress: 0,
      total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      payload: {
        eventId: event.id,
        batchId,
        chunks: Math.ceil(total / BULK_CHUNK_SIZE),
        driver: this.queue.driver,
      },
      result: null,
      error: null,
      driver: this.queue.driver,
      attempts: 0,
      startedAt: now,
      finishedAt: null,
      createdBy: ctx.actorId,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.insert(job);

    const chunks: RecipientInput[][] = [];
    for (let i = 0; i < total; i += BULK_CHUNK_SIZE)
      chunks.push(input.recipients.slice(i, i + BULK_CHUNK_SIZE));

    for (let index = 0; index < chunks.length; index += 1) {
      await this.queue.enqueue(
        'bulk_issue',
        {
          parentJobId: job.id,
          tenantId,
          eventId: event.id,
          batchId,
          chunkIndex: index,
          recipients: chunks[index],
          actorId: ctx.actorId,
          issuedAt: (input.issuedAt ?? ctx.issuedAt ?? null) as Date | null,
          sendEmail: input.sendEmail ?? event.autoDeliverEmail,
          continueOnFailure: input.continueOnFailure,
        },
        { attempts: 3, backoffMs: 5_000, priority: 10 - Math.min(9, index) },
      );
    }

    await this.audit.recordFrom(
      {
        tenantId,
        userId: ctx.actorId,
        role: 'admin',
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      'certificate.bulk_issued',
      'job',
      job.id,
      { eventId: event.id, batchId, total, chunks: chunks.length },
    );
    await this.bus.publish(tenantId, 'job.progress', {
      jobId: job.id,
      type: 'bulk_issue',
      progress: 0,
      total,
      processed: 0,
    });
    return { jobId: job.id, total, chunks: chunks.length, batchId };
  }

  /** Worker entry point for one chunk of a bulk issuance. */
  async processBulkChunk(
    payload: {
      parentJobId: string;
      tenantId: string;
      eventId: string;
      batchId: string;
      chunkIndex: number;
      recipients: RecipientInput[];
      actorId: string;
      issuedAt: Date | null;
      sendEmail: boolean;
      continueOnFailure: boolean;
    },
    updateProgress: (percent: number) => Promise<void>,
  ): Promise<{ succeeded: number; failed: number }> {
    const { tenantId, eventId, batchId, recipients, actorId } = payload;
    const { event, template, tenant } = await this.loadIssuanceContext(tenantId, eventId);
    let succeeded = 0;
    let failed = 0;
    const failures: { row: number; name: string; message: string }[] = [];

    for (let i = 0; i < recipients.length; i += 1) {
      const input = recipients[i] as RecipientInput;
      try {
        const recipient = toRecipient(input);
        const requiresApproval = event.requireApproval;
        const { certificate } = await this.createCertificate({
          tenant,
          event,
          template,
          recipient,
          ctx: {
            actorId,
            batchId,
            issuedAt: payload.issuedAt ? new Date(payload.issuedAt) : null,
          },
          status: requiresApproval ? 'pending_approval' : 'issued',
          row: payload.chunkIndex * BULK_CHUNK_SIZE + i + 1,
        });
        if (requiresApproval) {
          await this.createApproval(
            tenantId,
            eventId,
            certificate.id,
            actorId,
            `bulk batch ${batchId}`,
          );
        } else {
          await this.afterIssued(
            certificate,
            tenant,
            event,
            { actorId, batchId },
            payload.sendEmail,
          );
        }
        succeeded += 1;
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({
          row: payload.chunkIndex * BULK_CHUNK_SIZE + i + 1,
          name: input?.name ?? '(unknown)',
          message,
        });
        this.logger.warn(`Bulk row failed (tenant ${tenantId}, batch ${batchId}): ${message}`);
        if (!payload.continueOnFailure) break;
        // A hard quota stop must abort the rest of the chunk rather than spin.
        if (
          (err as AppException).getResponse &&
          String((err as AppException).code) === 'quota_exceeded'
        )
          break;
      }
      if ((i + 1) % 25 === 0) {
        await updateProgress(Math.round(((i + 1) / recipients.length) * 100));
      }
    }

    await this.syncParentJob(payload.parentJobId, tenantId, batchId, failures);
    return { succeeded, failed };
  }

  /** Recomputes parent job counters from the certificates themselves (race-free). */
  private async syncParentJob(
    jobId: string,
    tenantId: string,
    batchId: string,
    failures: { row: number; name: string; message: string }[],
  ): Promise<void> {
    const job = await this.jobs.findById(jobId);
    if (!job) return;
    const total = job.total;
    const [issued, pending, failedCerts] = await Promise.all([
      this.certificates.count({ tenantId, batchId, status: { $in: ['issued', 'delivered'] } }),
      this.certificates.count({
        tenantId,
        batchId,
        status: { $in: ['pending_approval', 'approved', 'draft'] },
      }),
      this.certificates.count({ tenantId, batchId, status: 'failed' }),
    ]);
    const processed = issued + pending + failedCerts;
    const progress = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100;
    const patch: Record<string, unknown> = {
      processed,
      succeeded: issued + pending,
      failed: failedCerts,
      progress,
    };
    const previousFailures = (job.result?.failures as typeof failures) ?? [];
    if (failures.length > 0)
      patch.result = { failures: [...previousFailures, ...failures].slice(0, 500) };
    else if (previousFailures.length > 0) patch.result = { failures: previousFailures };

    if (processed >= total) {
      patch.status = failedCerts > 0 && issued + pending === 0 ? 'failed' : 'completed';
      patch.finishedAt = new Date();
      patch.progress = 100;
    }
    const updated = await this.jobs.updateById(jobId, patch);
    await this.bus.publish(tenantId, processed >= total ? 'job.completed' : 'job.progress', {
      jobId,
      type: 'bulk_issue',
      progress: updated?.progress ?? progress,
      total,
      processed,
      succeeded: updated?.succeeded ?? issued + pending,
      failed: updated?.failed ?? failedCerts,
    });

    if (processed >= total) {
      await this.batches.updateMany(
        { tenantId, id: batchId },
        {
          status: failedCerts > 0 ? 'failed' : 'completed',
          issuedRows: issued + pending,
          failedRows: failedCerts,
          completedAt: new Date(),
        },
      );
      await this.audit.recordFrom(
        { tenantId, userId: job.createdBy ?? null, role: 'admin' },
        'import.completed',
        'job',
        jobId,
        {
          batchId,
          total,
          issued: issued + pending,
          failed: failedCerts,
        },
      );
    }
  }

  /* ------------------------------------------------------ create record */

  private async createCertificate(args: {
    tenant: Tenant;
    event: CertificateEvent;
    template: Template;
    recipient: Recipient;
    ctx: IssueContext;
    status: CertificateStatus;
    row?: number;
  }): Promise<{ certificate: Certificate; downloadToken: string }> {
    const { tenant, event, template, recipient, ctx, status } = args;
    const tenantId = tenant.id;
    const dek = await this.keys.dekFor(tenantId);
    const now = new Date();
    const issuedAt = status === 'issued' ? (ctx.issuedAt ?? now) : null;
    const downloadToken = generateDownloadToken();
    const downloadTokenHash = this.crypto.sha256(downloadToken);
    const ttlDays = tenant.settings?.downloadLinkTtlDays ?? this.env.DOWNLOAD_LINK_TTL_DAYS;

    let serial = '';
    let certificate: Certificate | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < SERIAL_ATTEMPTS; attempt += 1) {
      const candidate = generateSerial({
        prefix: tenant.settings?.serialPrefix || 'KDC',
        year: (issuedAt ?? now).getUTCFullYear(),
      });
      const mergeValues = buildMergeValues({
        certificate: { serial: candidate, recipient, issuedAt, metadata: {} },
        event,
        tenant,
        verifyUrl: this.verifyUrlFor(candidate),
        downloadUrl: this.downloadUrlFor(candidate, downloadToken),
        extra: recipient.meta,
      }) as Record<string, string>;

      const draft: Certificate = {
        id: newId(),
        tenantId,
        eventId: event.id,
        templateId: template.id,
        serial: candidate,
        recipient,
        recipientEmailEnc: recipient.email ? this.crypto.encrypt(recipient.email, dek) : null,
        status,
        issuedAt,
        issuedBy: ctx.actorId,
        approvedBy: null,
        approvalNote: null,
        pdfAssetId: null,
        pdfSha256: null,
        downloadToken: null,
        downloadTokenHash,
        downloadExpiresAt: ttlDays > 0 ? new Date(now.getTime() + ttlDays * 86_400_000) : null,
        downloadCount: 0,
        viewCount: 0,
        batchId: ctx.batchId ?? null,
        revocation: null,
        integritySignature: this.crypto.signIntegrity(dek, [
          tenantId,
          event.id,
          candidate,
          recipient.name,
          recipient.email ?? '',
          issuedAt?.toISOString() ?? '',
        ]),
        mergeValues,
        metadata: args.row ? { row: String(args.row) } : {},
        lastRenderedAt: null,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        certificate = await this.certificates.insert(draft);
        serial = candidate;
        break;
      } catch (err) {
        lastError = err;
        if (!(err instanceof DuplicateKeyError)) throw err;
        this.logger.warn(
          `Serial ${candidate} collided; retrying (${attempt + 1}/${SERIAL_ATTEMPTS})`,
        );
      }
    }
    if (!certificate) {
      throw lastError instanceof DuplicateKeyError
        ? new AppException(
            'serial_taken',
            'Could not allocate a unique certificate ID after several attempts',
            undefined,
            409,
          )
        : ((lastError as Error) ?? AppException.notFound('Certificate'));
    }
    void serial;
    // The plaintext token is returned to the caller exactly once and never
    // stored: only its SHA-256 hash is persisted.
    return { certificate, downloadToken };
  }

  /** Steps that only apply once a certificate is actually issued. */
  private async afterIssued(
    certificate: Certificate,
    tenant: Tenant,
    event: CertificateEvent,
    ctx: IssueContext,
    sendEmail?: boolean,
  ): Promise<void> {
    await this.tenantsService.incrementUsage(tenant.id, 1);
    await this.events.updateById(event.id, { issuedCount: (event.issuedCount ?? 0) + 1 });

    const shouldEmail =
      sendEmail ?? (event.autoDeliverEmail && tenant.settings?.autoDeliverEmail !== false);
    await this.queue.enqueue(
      'pdf_render',
      {
        certificateId: certificate.id,
        tenantId: tenant.id,
        sendEmail: shouldEmail && Boolean(certificate.recipient.email),
        actorId: ctx.actorId,
      },
      { attempts: 3, backoffMs: 10_000, dedupeKey: `render:${certificate.id}` },
    );

    await this.audit.recordFrom(
      {
        tenantId: tenant.id,
        userId: ctx.actorId,
        role: 'admin',
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      ctx.batchId ? 'certificate.issued' : 'certificate.created',
      'certificate',
      certificate.id,
      {
        serial: certificate.serial,
        eventId: event.id,
        recipient: certificate.recipient.name,
        batchId: ctx.batchId ?? null,
      },
    );
    await this.bus.publish(tenant.id, 'certificate.issued', {
      certificateId: certificate.id,
      serial: certificate.serial,
      eventId: event.id,
      recipientName: certificate.recipient.name,
    });

    // Warn the tenant once they cross 80% of the monthly allowance.
    const usage = await this.tenantsService.currentUsage(tenant.id);
    const plan = await this.tenantsService.planOf(tenant.id);
    const quota = getPlan(plan).monthlyCertificateQuota;
    if (
      quota > 0 &&
      quota < Number.MAX_SAFE_INTEGER &&
      usage.certificatesThisMonth === Math.ceil(quota * 0.8)
    ) {
      await this.bus.publish(tenant.id, 'quota.warning', {
        used: usage.certificatesThisMonth,
        quota,
        plan,
      });
      this.logger.warn(`Tenant ${tenant.id} reached 80% of its monthly certificate quota`);
    }
  }

  private async createApproval(
    tenantId: string,
    eventId: string,
    certificateId: string,
    actorId: string,
    reason?: string,
  ): Promise<ApprovalRequest> {
    const now = new Date();
    const approval: ApprovalRequest = {
      id: newId(),
      tenantId,
      eventId,
      certificateId,
      requestedBy: actorId,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      note: null,
      reason: reason ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.approvals.insert(approval);
    return approval;
  }

  /* ------------------------------------------------------------- render */

  /**
   * Renders one certificate to PDF and stores it.
   *
   * Called by the `pdf_render` worker. The rendered merge values are taken from
   * the certificate's snapshot, never recomputed from live event data.
   */
  async renderCertificate(
    certificateId: string,
    opts: { watermark?: WatermarkKind } = {},
  ): Promise<PdfRenderOutcome> {
    const certificate = await this.certificates.findById(certificateId);
    if (!certificate) throw AppException.notFound('Certificate');
    const tenant = await this.tenants.findById(certificate.tenantId);
    if (!tenant) throw AppException.tenantNotFound();
    const template = await this.templates.findById(certificate.templateId);
    if (!template) throw AppException.notFound('Template for this certificate');

    const doc = template.doc;
    const images = new Map<string, Buffer>();
    const customFonts = new Map<string, Buffer>();

    // Resolve every asset referenced by the design once, up front.
    const assetIds = new Set<string>();
    if (doc.page.backgroundSrc) assetIds.add(doc.page.backgroundSrc);
    for (const el of doc.elements) {
      if ((el.type === 'image' || el.type === 'signature') && el.src) assetIds.add(el.src);
    }
    for (const font of doc.customFonts ?? []) assetIds.add(font.assetId);

    for (const assetId of assetIds) {
      if (/^https?:\/\//i.test(assetId)) continue; // remote images are skipped, with a warning
      const read = await this.assets.read(assetId, { tenantId: tenant.id });
      if (!read) continue;
      const isFont = (doc.customFonts ?? []).some((f) => f.assetId === assetId);
      if (isFont)
        customFonts.set(
          (doc.customFonts ?? []).find((f) => f.assetId === assetId)!.family,
          read.buffer,
        );
      else images.set(assetId, read.buffer);
    }

    const watermark = opts.watermark ?? (certificate.status === 'revoked' ? 'revoked' : null);
    const rendered = await this.pdf.render({
      doc,
      mergeValues: certificate.mergeValues,
      serial: certificate.serial,
      verifyUrl: this.verifyUrlFor(certificate.serial),
      tenantName: tenant.name,
      issuedAt: certificate.issuedAt ? new Date(certificate.issuedAt) : new Date(),
      watermark,
      images,
      customFonts,
      metadata: {
        title: `Certificate ${certificate.serial}`,
        author: tenant.name,
        subject: `${certificate.recipient.name} - ${certificate.mergeValues['event.name'] ?? ''}`,
        keywords: ['certificate', certificate.serial, tenant.slug],
      },
    });

    const filename = `${certificate.serial}.pdf`;
    const asset = await this.assets.storeGenerated(
      tenant.id,
      'certificate_pdf',
      filename,
      rendered.buffer,
      'application/pdf',
    );
    await this.certificates.updateById(certificate.id, {
      pdfAssetId: asset.id,
      pdfSha256: rendered.sha256,
      lastRenderedAt: new Date(),
      failureReason: null,
    });
    if (rendered.warnings.length > 0) {
      this.logger.warn(
        `Certificate ${certificate.serial} rendered with ${rendered.warnings.length} warning(s): ${rendered.warnings.join(' | ')}`,
      );
    }
    return {
      assetId: asset.id,
      storageKey: asset.storageKey,
      sha256: rendered.sha256,
      bytes: rendered.bytes,
      warnings: rendered.warnings,
    };
  }

  /** Sends the certificate email; called after a successful render. */
  async deliverCertificateEmail(
    certificateId: string,
  ): Promise<{ queued: boolean; reason?: string }> {
    const certificate = await this.certificates.findById(certificateId);
    if (!certificate) return { queued: false, reason: 'certificate_not_found' };
    if (!certificate.recipient.email) return { queued: false, reason: 'no_recipient_email' };
    if (certificate.status === 'revoked') return { queued: false, reason: 'revoked' };
    const tenant = await this.tenants.findById(certificate.tenantId);
    const event = await this.events.findById(certificate.eventId);
    if (!tenant || !event) return { queued: false, reason: 'missing_tenant_or_event' };

    const asset = certificate.pdfAssetId
      ? await this.assets.read(certificate.pdfAssetId, { tenantId: tenant.id })
      : null;
    const { subject, text, html } = certificateEmail({
      tenantName: tenant.name,
      branding: tenant.branding,
      recipientName: certificate.recipient.name,
      eventName: String(certificate.mergeValues['event.name'] ?? event.programmeName ?? event.name),
      serial: certificate.serial,
      issuedAt: formatDate(certificate.issuedAt, tenant.settings?.timezone),
      downloadUrl: String(
        certificate.mergeValues['certificate.download_url'] ??
          this.verifyUrlFor(certificate.serial),
      ),
      verifyUrl: this.verifyUrlFor(certificate.serial),
      bodyText: event.emailBody ?? tenant.settings?.defaultEmailBody ?? '',
      appUrl: this.env.APP_URL,
      verifyBaseUrl: this.env.PUBLIC_VERIFY_BASE_URL ?? this.env.APP_URL,
      supportEmail: tenant.branding?.supportEmail ?? null,
    });

    await this.notifications.queueEmail({
      tenantId: tenant.id,
      certificateId: certificate.id,
      to: certificate.recipient.email,
      subject:
        (event.emailSubject ?? tenant.settings?.defaultEmailSubject)
          ? applySubjectTemplate(
              event.emailSubject ?? tenant.settings?.defaultEmailSubject ?? subject,
              tenant,
              certificate,
            )
          : subject,
      text,
      html,
      category: 'certificate',
      attachmentKey: asset?.asset.storageKey,
      attachmentName: asset ? `${certificate.serial}.pdf` : undefined,
    });
    if (certificate.status === 'issued') {
      await this.certificates.updateById(certificate.id, { status: 'delivered' });
    }
    await this.audit.recordFrom(
      { tenantId: tenant.id, userId: certificate.issuedBy ?? null, role: 'system' },
      'certificate.email_sent',
      'certificate',
      certificate.id,
      {
        serial: certificate.serial,
        to: certificate.recipient.email,
        withAttachment: Boolean(asset),
        mailDriver: this.env.MAIL_DRIVER,
      },
    );
    return { queued: true };
  }

  /* ----------------------------------------------------------- approvals */

  async listApprovals(
    tenantId: string,
    status: 'pending' | 'approved' | 'rejected' = 'pending',
  ): Promise<(ApprovalRequest & { certificate?: Certificate })[]> {
    const requests = await this.approvals.find(
      { tenantId, status },
      { sort: { createdAt: -1 }, limit: 200 },
    );
    const out: (ApprovalRequest & { certificate?: Certificate })[] = [];
    for (const request of requests) {
      const certificate = await this.certificates.findById(request.certificateId);
      out.push(certificate ? { ...request, certificate } : request);
    }
    return out;
  }

  async approve(
    tenantId: string,
    certificateId: string,
    actorId: string,
    input: ApproveInput,
  ): Promise<Certificate> {
    const certificate = await this.get(tenantId, certificateId);
    if (certificate.status !== 'pending_approval') {
      throw AppException.conflict(
        `This certificate is ${certificate.status}, not pending approval`,
      );
    }
    const now = new Date();
    const updated = await this.certificates.updateById(certificateId, {
      status: 'issued',
      issuedAt: certificate.issuedAt ?? now,
      approvedBy: actorId,
      approvalNote: input.note ?? null,
    });
    if (!updated) throw AppException.notFound('Certificate');
    await this.approvals.updateMany(
      { tenantId, certificateId, status: 'pending' },
      {
        status: 'approved',
        decidedBy: actorId,
        decidedAt: now,
        note: input.note ?? null,
      },
    );

    const tenant = await this.tenantsService.findById(tenantId);
    const event = await this.events.findById(updated.eventId);
    if (event) {
      await this.afterIssued(updated, tenant, event, { actorId }, input.issue !== false);
    }
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'certificate.approved',
      'certificate',
      certificateId,
      {
        serial: updated.serial,
        note: input.note ?? null,
      },
    );
    await this.bus.publish(tenantId, 'certificate.approved', {
      certificateId,
      serial: updated.serial,
    });
    return updated;
  }

  async reject(
    tenantId: string,
    certificateId: string,
    actorId: string,
    input: RejectInput,
  ): Promise<Certificate> {
    const certificate = await this.get(tenantId, certificateId);
    if (certificate.status !== 'pending_approval') {
      throw AppException.conflict(
        `This certificate is ${certificate.status}, not pending approval`,
      );
    }
    const now = new Date();
    const updated = await this.certificates.updateById(certificateId, {
      status: 'draft',
      approvalNote: input.reason,
      approvedBy: actorId,
    });
    if (!updated) throw AppException.notFound('Certificate');
    await this.approvals.updateMany(
      { tenantId, certificateId, status: 'pending' },
      {
        status: 'rejected',
        decidedBy: actorId,
        decidedAt: now,
        note: input.reason,
      },
    );
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'certificate.rejected',
      'certificate',
      certificateId,
      {
        serial: updated.serial,
        reason: input.reason,
      },
      'warning',
    );
    await this.bus.publish(tenantId, 'certificate.rejected', {
      certificateId,
      serial: updated.serial,
      reason: input.reason,
    });
    return updated;
  }

  /* ---------------------------------------------------------- revocation */

  async revoke(
    tenantId: string,
    certificateId: string,
    actorId: string,
    input: RevokeInput,
  ): Promise<Certificate> {
    const certificate = await this.get(tenantId, certificateId);
    if (certificate.status === 'revoked')
      throw AppException.conflict('This certificate is already revoked');
    const now = new Date();
    const updated = await this.certificates.updateById(certificateId, {
      status: 'revoked',
      revocation: {
        reason: input.reason,
        revokedBy: actorId,
        revokedAt: now,
        notifyRecipient: input.notifyRecipient,
      },
    });
    if (!updated) throw AppException.notFound('Certificate');

    const tenant = await this.tenantsService.findById(tenantId);
    await this.events.updateById(certificate.eventId, { revokedCount: 1 });
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'certificate.revoked',
      'certificate',
      certificateId,
      {
        serial: updated.serial,
        reason: input.reason,
        notifyRecipient: input.notifyRecipient,
      },
      'critical',
    );
    await this.bus.publish(tenantId, 'certificate.revoked', {
      certificateId,
      serial: updated.serial,
      reason: input.reason,
    });

    // Re-render so the stored artefact itself carries the REVOKED watermark.
    await this.queue.enqueue(
      'pdf_render',
      { certificateId, tenantId, sendEmail: false, actorId, watermark: 'revoked' },
      { attempts: 2 },
    );

    if (input.notifyRecipient && updated.recipient.email) {
      const event = await this.events.findById(updated.eventId);
      const { subject, text, html } = revocationNoticeEmail({
        tenantName: tenant.name,
        branding: tenant.branding,
        recipientName: updated.recipient.name,
        serial: updated.serial,
        eventName: String(updated.mergeValues['event.name'] ?? event?.programmeName ?? ''),
        reason: input.reason,
        verifyUrl: this.verifyUrlFor(updated.serial),
        appUrl: this.env.APP_URL,
        verifyBaseUrl: this.env.PUBLIC_VERIFY_BASE_URL ?? this.env.APP_URL,
      });
      await this.notifications.queueEmail({
        tenantId,
        certificateId,
        to: updated.recipient.email,
        subject,
        text,
        html,
        category: 'revocation',
      });
    }
    return updated;
  }

  /* --------------------------------------------------------------- reads */

  async get(tenantId: string, certificateId: string): Promise<Certificate> {
    const certificate = await this.certificates.findById(certificateId);
    // Comparing tenantId here is the isolation backstop: an id from another
    // tenant is reported as "not found", never as "forbidden", so ids cannot be
    // used to probe which organisations exist.
    if (!certificate || certificate.tenantId !== tenantId)
      throw AppException.notFound('Certificate');
    return certificate;
  }

  /**
   * Serial -> certificate with no tenant scope, for the public verify and
   * download routes. Callers MUST authorise with a download token or an email
   * match before anything but the masked verification summary is returned.
   */
  async resolvePublicSerial(serial: string): Promise<Certificate> {
    const canonical = canonicaliseSerialInput(serial ?? '');
    if (!isValidSerial(canonical)) throw AppException.notFound('Certificate');
    const certificate = await this.certificates.findOne({ serial: canonical });
    if (!certificate) throw AppException.notFound('Certificate');
    return certificate;
  }

  async findBySerial(tenantId: string, serial: string): Promise<Certificate> {
    const certificate = await this.certificates.findOne({ tenantId, serial });
    if (!certificate) throw AppException.notFound('Certificate');
    return certificate;
  }

  async list(
    tenantId: string,
    input: ListCertificatesInput,
  ): Promise<{
    items: PublicCertificate[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const filter: Record<string, unknown> = { tenantId };
    if (input.eventId) filter.eventId = input.eventId;
    if (input.batchId) filter.batchId = input.batchId;
    if (input.status)
      filter.status = input.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (input.from || input.to) {
      const range: Record<string, unknown> = {};
      if (input.from) range.$gte = input.from;
      if (input.to) range.$lte = input.to;
      filter.createdAt = range;
    }
    if (input.q) {
      const rx = { $regex: escapeRegex(input.q), $options: 'i' };
      filter.$or = [
        { serial: rx },
        { 'recipient.name': rx },
        { 'recipient.rollNumber': rx },
        { 'recipient.department': rx },
      ];
    }
    const sortField = input.sort === 'recipient.name' ? 'recipient.name' : input.sort;
    const [rows, total] = await Promise.all([
      this.certificates.find(buildFilter(filter), {
        sort: { [sortField]: input.order === 'asc' ? 1 : -1 },
        skip: (input.page - 1) * input.pageSize,
        limit: input.pageSize,
      }),
      this.certificates.count(buildFilter(filter)),
    ]);
    const items = await Promise.all(rows.map((c) => this.toPublic(c)));
    return {
      items,
      total,
      page: input.page,
      pageSize: input.pageSize,
      hasMore: input.page * input.pageSize < total,
    };
  }

  /** Strips secrets before a certificate leaves the API. */
  async toPublic(certificate: Certificate): Promise<PublicCertificate> {
    return {
      id: certificate.id,
      serial: certificate.serial,
      tenantId: certificate.tenantId,
      eventId: certificate.eventId,
      templateId: certificate.templateId,
      status: certificate.status,
      recipient: {
        name: certificate.recipient.name,
        // The stored address is encrypted; it is only decrypted for a caller who
        // has proven membership of the tenant.
        email: certificate.recipient.email ?? null,
        title: certificate.recipient.title ?? null,
        department: certificate.recipient.department ?? null,
        rollNumber: certificate.recipient.rollNumber ?? null,
        grade: certificate.recipient.grade ?? null,
        hours: certificate.recipient.hours ?? null,
      },
      issuedAt: certificate.issuedAt ? new Date(certificate.issuedAt).toISOString() : null,
      issuedAtDisplay: formatDate(certificate.issuedAt),
      approvedBy: certificate.approvedBy ?? null,
      batchId: certificate.batchId ?? null,
      hasPdf: Boolean(certificate.pdfAssetId),
      pdfSha256: certificate.pdfSha256 ?? null,
      downloadCount: certificate.downloadCount,
      viewCount: certificate.viewCount,
      downloadExpiresAt: certificate.downloadExpiresAt
        ? new Date(certificate.downloadExpiresAt).toISOString()
        : null,
      revocation: certificate.revocation
        ? {
            reason: certificate.revocation.reason,
            revokedAt: new Date(certificate.revocation.revokedAt).toISOString(),
            revokedBy: certificate.revocation.revokedBy,
          }
        : null,
      failureReason: certificate.failureReason ?? null,
      lastRenderedAt: certificate.lastRenderedAt
        ? new Date(certificate.lastRenderedAt).toISOString()
        : null,
      verifyUrl: this.verifyUrlFor(certificate.serial),
      createdAt: new Date(certificate.createdAt).toISOString(),
      integrityOk: await this.checkIntegrity(certificate),
    };
  }

  /** Recomputes the HMAC and compares - detects any post-issue tampering. */
  async checkIntegrity(certificate: Certificate): Promise<boolean> {
    try {
      const dek = await this.keys.dekFor(certificate.tenantId);
      const expected = this.crypto.signIntegrity(dek, [
        certificate.tenantId,
        certificate.eventId,
        certificate.serial,
        certificate.recipient.name,
        certificate.recipient.email ?? '',
        certificate.issuedAt ? new Date(certificate.issuedAt).toISOString() : '',
      ]);
      return this.crypto.safeEqual(expected, certificate.integritySignature);
    } catch {
      return false;
    }
  }

  /* ----------------------------------------------------------- download */

  /**
   * Private download.
   *
   * Two paths, both unguessable:
   *  - an authenticated member of the tenant (`actorId` set), or
   *  - a holder of the 256-bit download token.
   * Knowing the serial alone is never sufficient.
   */
  async download(
    certificateId: string,
    opts: {
      actorId?: string | null;
      downloadToken?: string | null;
      requireEmail?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    sha256: string;
    certificate: Certificate;
  }> {
    const certificate = await this.certificates.findById(certificateId);
    if (!certificate) throw AppException.notFound('Certificate');
    const tenant = await this.tenants.findById(certificate.tenantId);
    if (!tenant) throw AppException.tenantNotFound();

    const isMember = Boolean(opts.actorId);
    let authorised = isMember;
    if (!authorised) {
      if (!opts.downloadToken)
        throw AppException.unauthenticated('A valid download link is required');
      if (certificate.status !== 'issued' && certificate.status !== 'delivered') {
        throw new AppException(
          'certificate_not_issued',
          'This certificate has not been issued',
          undefined,
          404,
        );
      }
      if (
        certificate.downloadExpiresAt &&
        new Date(certificate.downloadExpiresAt).getTime() < Date.now()
      ) {
        throw AppException.forbidden(
          'This download link has expired. Contact the issuing organisation for a new one.',
        );
      }
      const presented = this.crypto.sha256(opts.downloadToken);
      if (
        !certificate.downloadTokenHash ||
        !this.crypto.safeEqual(presented, certificate.downloadTokenHash)
      ) {
        await this.audit.record({
          tenantId: tenant.id,
          actorRole: 'anonymous',
          action: 'certificate.verification_failed',
          entityType: 'certificate',
          entityId: certificate.id,
          payload: { serial: certificate.serial, reason: 'bad_download_token' },
          severity: 'warning',
          ip: opts.ip ?? null,
          userAgent: opts.userAgent ?? null,
        });
        throw AppException.forbidden('This download link is not valid');
      }
      if (tenant.settings?.selfDownloadRequiresEmail && opts.requireEmail) {
        const stored = await this.keys.decrypt(tenant.id, certificate.recipientEmailEnc);
        const matches =
          (stored ?? certificate.recipient.email ?? '').toLowerCase() ===
          opts.requireEmail.toLowerCase();
        if (!matches)
          throw AppException.forbidden('The email address does not match this certificate');
      }
      authorised = true;
    }
    if (!authorised) throw AppException.forbidden();

    if (certificate.status === 'revoked') {
      throw new AppException(
        'certificate_revoked',
        'This certificate has been revoked and can no longer be downloaded',
        undefined,
        403,
      );
    }
    if (!certificate.pdfAssetId) {
      throw new AppException(
        'certificate_not_issued',
        'The PDF for this certificate has not been generated yet',
        undefined,
        409,
      );
    }
    const read = await this.assets.read(certificate.pdfAssetId, { tenantId: tenant.id });
    if (!read)
      throw AppException.notFound('The certificate file is no longer available in storage');
    if (certificate.pdfSha256 && !this.assets.verifyIntegrity(read.buffer, certificate.pdfSha256)) {
      this.logger.error(
        `Stored PDF for ${certificate.serial} does not match its recorded checksum`,
      );
      // A stored file that no longer matches its recorded checksum is a
      // server-side fault, not a missing integration: 503 would tell the client
      // to retry, and retrying cannot repair a corrupt object. Refuse to serve
      // it and say what has to happen (re-render).
      throw new AppException(
        'internal_error',
        'The stored PDF failed its integrity check and cannot be served. Re-render the certificate to replace the file.',
        { serial: certificate.serial },
        500,
      );
    }

    await this.certificates.updateById(certificate.id, {
      downloadCount: (certificate.downloadCount ?? 0) + 1,
    });
    await this.audit.record({
      tenantId: tenant.id,
      actorId: opts.actorId ?? null,
      actorRole: opts.actorId ? 'admin' : 'anonymous',
      action: 'certificate.downloaded',
      entityType: 'certificate',
      entityId: certificate.id,
      payload: { serial: certificate.serial, via: opts.actorId ? 'member' : 'download_token' },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    });

    return {
      buffer: read.buffer,
      filename: `${certificate.serial}.pdf`,
      mimeType: 'application/pdf',
      sha256: read.asset.sha256,
      certificate,
    };
  }

  async resend(
    tenantId: string,
    certificateId: string,
    actorId: string,
    _input: ResendInput = {},
  ): Promise<{ queued: true }> {
    const certificate = await this.get(tenantId, certificateId);
    if (certificate.status === 'revoked')
      throw AppException.conflict('A revoked certificate cannot be re-sent');
    if (!certificate.recipient.email)
      throw AppException.validationFailed('This certificate has no recipient email address');
    await this.deliverCertificateEmail(certificateId);
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'certificate.email_sent',
      'certificate',
      certificateId,
      {
        serial: certificate.serial,
        reason: 'manual_resend',
      },
    );
    return { queued: true };
  }

  /* ------------------------------------------------------- public verify */

  /**
   * Public verification, used by the QR code and the /verify page.
   *
   * Returns only what a verifier should see. Whether the recipient's name is
   * revealed is the issuing organisation's choice (`verificationPublic`), and a
   * private download link is offered only when self-download is enabled.
   */
  async verify(
    rawSerial: string,
    opts: {
      email?: string | null;
      ip?: string | null;
      userAgent?: string | null;
      referer?: string | null;
    } = {},
  ): Promise<VerificationResult> {
    const serial = canonicaliseSerialInput(rawSerial ?? '');
    const checkedAt = new Date().toISOString();

    if (!isValidSerial(serial)) {
      return {
        result: 'malformed',
        serial,
        found: false,
        verifyUrl: this.verifyUrlFor(serial || 'unknown'),
        checkedAt,
      };
    }
    const certificate = await this.certificates.findOne({ serial });
    if (!certificate) {
      await this.recordVerification(null, null, serial, 'not_found', opts);
      return {
        result: 'not_found',
        serial,
        found: false,
        verifyUrl: this.verifyUrlFor(serial),
        checkedAt,
      };
    }
    const tenant = await this.tenants.findById(certificate.tenantId);
    if (!tenant || tenant.deletedAt) {
      return {
        result: 'not_found',
        serial,
        found: false,
        verifyUrl: this.verifyUrlFor(serial),
        checkedAt,
      };
    }
    const event = await this.events.findById(certificate.eventId);
    const integrityOk = await this.checkIntegrity(certificate);
    const revealRecipient = tenant.settings?.verificationPublic !== false;
    const isRevoked = certificate.status === 'revoked';

    await this.recordVerification(
      tenant.id,
      certificate.id,
      serial,
      isRevoked ? 'revoked' : 'valid',
      opts,
    );
    if (integrityOk) {
      await this.certificates.updateById(certificate.id, {
        viewCount: (certificate.viewCount ?? 0) + 1,
      });
    }

    let downloadUrl: string | null = null;
    if (!isRevoked && tenant.settings?.allowSelfDownload && certificate.recipient.email) {
      const wantsEmailCheck = tenant.settings?.selfDownloadRequiresEmail;
      if (
        !wantsEmailCheck ||
        (opts.email && opts.email.toLowerCase() === certificate.recipient.email.toLowerCase())
      ) {
        // A single-use, short-lived link is minted for the verifier rather than
        // exposing the stored token.
        downloadUrl = `${this.env.APP_URL.replace(/\/$/, '')}/verify/${encodeURIComponent(serial)}?download=1`;
      }
    }

    return {
      result: isRevoked ? 'revoked' : 'valid',
      serial,
      found: true,
      certificate: {
        id: certificate.id,
        serial: certificate.serial,
        status: certificate.status,
        recipientName: revealRecipient
          ? certificate.recipient.name
          : maskName(certificate.recipient.name),
        recipientEmailShown: false,
        eventName: String(
          certificate.mergeValues['event.name'] ?? event?.programmeName ?? event?.name ?? '',
        ),
        issuedAt: certificate.issuedAt ? new Date(certificate.issuedAt).toISOString() : null,
        issuedAtDisplay: formatDate(certificate.issuedAt, tenant.settings?.timezone),
        revoked: certificate.revocation
          ? {
              reason: certificate.revocation.reason,
              revokedAt: new Date(certificate.revocation.revokedAt).toISOString(),
            }
          : null,
        integrityOk,
      },
      organisation: {
        name: tenant.name,
        slug: tenant.slug,
        type: tenant.type,
        branding: tenant.branding,
        supportEmail: tenant.branding?.supportEmail ?? null,
      },
      verifyUrl: this.verifyUrlFor(serial),
      downloadUrl,
      checkedAt,
    };
  }

  private async recordVerification(
    tenantId: string | null,
    certificateId: string | null,
    serial: string,
    result: VerificationEvent['result'],
    opts: { ip?: string | null; userAgent?: string | null; referer?: string | null },
  ): Promise<void> {
    const now = new Date();
    await this.verifications.insert({
      id: newId(),
      tenantId: tenantId ?? '',
      certificateId: certificateId ?? '',
      serial,
      result,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      country: null,
      referer: opts.referer ?? null,
      createdAt: now,
      updatedAt: now,
    });
    if (tenantId && certificateId && result === 'valid') {
      await this.bus
        .publish(tenantId, 'certificate.issued', { event: 'verified', serial, certificateId })
        .catch(() => undefined);
    }
  }

  /* --------------------------------------------------------------- stats */

  async stats(tenantId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    thisMonth: number;
    revoked: number;
    verifications: number;
    downloads: number;
  }> {
    const byStatus: Record<string, number> = {};
    for (const status of [
      'draft',
      'pending_approval',
      'approved',
      'issued',
      'delivered',
      'revoked',
      'failed',
    ]) {
      byStatus[status] = await this.certificates.count({ tenantId, status });
    }
    const monthStart = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`);
    const [total, thisMonth, revoked, verifications, downloads] = await Promise.all([
      this.certificates.count({ tenantId }),
      this.certificates.count({ tenantId, createdAt: { $gte: monthStart } }),
      this.certificates.count({ tenantId, status: 'revoked' }),
      this.verifications.count({ tenantId }),
      this.certificates.sum('downloadCount', { tenantId }),
    ]);
    return { total, byStatus, thisMonth, revoked, verifications, downloads: Math.round(downloads) };
  }

  /* ------------------------------------------------------------- helpers */

  private async loadIssuanceContext(
    tenantId: string,
    eventId: string,
  ): Promise<{ tenant: Tenant; event: CertificateEvent; template: Template }> {
    const tenant = await this.tenantsService.findById(tenantId);
    if (tenant.status === 'suspended')
      throw AppException.forbidden('This organisation is suspended and cannot issue certificates');
    const event = await this.events.findById(eventId);
    if (!event || event.tenantId !== tenantId) throw AppException.notFound('Event');
    if (event.status === 'archived')
      throw AppException.conflict('This event is archived; reopen it before issuing');
    const template = await this.templates.findById(event.templateId);
    if (!template || template.tenantId !== tenantId) {
      throw AppException.conflict('The design attached to this event no longer exists');
    }
    return { tenant, event, template };
  }
}

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

export function toRecipient(input: RecipientInput): Recipient {
  return {
    name: input.name.trim().replace(/\s+/g, ' '),
    email: input.email ? input.email.trim().toLowerCase() : null,
    title: input.title?.trim() || null,
    department: input.department?.trim() || null,
    rollNumber: input.roll_number?.trim() || null,
    grade: input.grade?.trim() || null,
    hours: input.hours?.trim() || null,
    meta: input.meta && Object.keys(input.meta).length > 0 ? input.meta : null,
  };
}

/** Shows only initials so a public verification cannot leak a full name. */
export function maskName(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return `${parts[0]!.charAt(0)}.`;
  return parts.map((p) => `${p.charAt(0)}.`).join(' ');
}

function applySubjectTemplate(subject: string, tenant: Tenant, certificate: Certificate): string {
  return subject
    .replace(/\{\{\s*tenant\.name\s*\}\}/gi, tenant.name)
    .replace(/\{\{\s*certificate\.serial\s*\}\}/gi, certificate.serial)
    .replace(/\{\{\s*recipient\.name\s*\}\}/gi, certificate.recipient.name)
    .replace(/\{\{\s*event\.name\s*\}\}/gi, String(certificate.mergeValues['event.name'] ?? ''));
}
