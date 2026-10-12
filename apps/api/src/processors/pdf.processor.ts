import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { CertificatesService } from '../certificates/certificates.service';
import { AuditService } from '../audit/audit.service';

export interface PdfRenderPayload {
  certificateId: string;
  tenantId: string;
  sendEmail: boolean;
  actorId: string | null;
  watermark?: 'draft' | 'specimen' | 'revoked' | null;
}

/**
 * PDF render worker.
 *
 * Rendering is CPU-bound and produces megabytes of output, so it never happens
 * inside the HTTP request that issued the certificate. The worker renders,
 * stores the PDF, records the SHA-256 that later downloads are re-verified
 * against, and - only when the render succeeded and the event asks for email -
 * hands off to the mail worker. Render warnings (text overflow, missing assets,
 * substituted fonts) are persisted on the job so an operator can see why a
 * certificate looks wrong instead of guessing.
 */
@Injectable()
export class PdfProcessor implements OnModuleInit {
  private readonly logger = new Logger(PdfProcessor.name);

  constructor(
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    private readonly certificates: CertificatesService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Two concurrent renders: PDF generation is single-threaded CPU work, and
    // going higher would starve the request path on a small container.
    this.queue.register<PdfRenderPayload>(
      'pdf_render',
      (payload, ctx) => this.handle(payload, ctx),
      2,
    );
    this.logger.log(`PDF render worker registered (queue=${this.queue.driver}, concurrency=2)`);
  }

  async handle(
    payload: PdfRenderPayload,
    ctx: {
      jobId: string;
      attempt: number;
      updateProgress: (percent: number, patch?: Record<string, unknown>) => Promise<void>;
    },
  ): Promise<{ assetId: string; bytes: number; warnings: string[]; emailed: boolean }> {
    await ctx.updateProgress(10);
    const outcome = await this.certificates.renderCertificate(payload.certificateId, {
      watermark: payload.watermark ?? null,
    });
    await ctx.updateProgress(80, {
      result: { bytes: outcome.bytes, sha256: outcome.sha256, warnings: outcome.warnings },
    });

    let emailed = false;
    if (payload.sendEmail && !payload.watermark) {
      const result = await this.certificates.deliverCertificateEmail(payload.certificateId);
      emailed = result.queued;
      if (!result.queued)
        this.logger.debug(`Email skipped for ${payload.certificateId}: ${result.reason}`);
    }

    if (outcome.warnings.length > 0) {
      await this.audit.record({
        tenantId: payload.tenantId,
        actorId: payload.actorId ?? undefined,
        actorRole: 'system',
        action: 'certificate.created',
        entityType: 'certificate',
        entityId: payload.certificateId,
        payload: {
          stage: 'pdf_render',
          warnings: outcome.warnings.slice(0, 25),
          jobId: ctx.jobId,
          attempt: ctx.attempt,
        },
        severity: 'warning',
      });
      this.logger.warn(
        `Render of ${payload.certificateId} produced ${outcome.warnings.length} warning(s): ${outcome.warnings.slice(0, 3).join(' | ')}`,
      );
    }
    await ctx.updateProgress(100);
    return { assetId: outcome.assetId, bytes: outcome.bytes, warnings: outcome.warnings, emailed };
  }
}
