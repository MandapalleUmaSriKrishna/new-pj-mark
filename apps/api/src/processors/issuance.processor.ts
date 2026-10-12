import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { CertificatesService } from '../certificates/certificates.service';
import type { RecipientInput } from '../certificates/dto';

export interface BulkIssuePayload {
  parentJobId: string;
  tenantId: string;
  eventId: string;
  batchId: string;
  chunkIndex: number;
  recipients: RecipientInput[];
  actorId: string;
  issuedAt: Date | string | null;
  sendEmail: boolean;
  continueOnFailure: boolean;
}

/**
 * Bulk issuance worker.
 *
 * Each job handles one chunk of at most `BULK_CHUNK_SIZE` recipients, so a
 * 50,000-row convocation becomes 200 independently retryable jobs rather than
 * one monolithic unit of work. Progress is reported per chunk and the parent
 * job's counters are recomputed by counting the certificates written for the
 * batch, which stays correct no matter how many chunks run in parallel or are
 * retried.
 */
@Injectable()
export class IssuanceProcessor implements OnModuleInit {
  private readonly logger = new Logger(IssuanceProcessor.name);

  constructor(
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    private readonly certificates: CertificatesService,
  ) {}

  onModuleInit(): void {
    this.queue.register<BulkIssuePayload>(
      'bulk_issue',
      (payload, ctx) => this.handle(payload, ctx),
      3,
    );
    this.logger.log(`Bulk issuance worker registered (queue=${this.queue.driver}, concurrency=3)`);
  }

  async handle(
    payload: BulkIssuePayload,
    ctx: {
      jobId: string;
      attempt: number;
      updateProgress: (percent: number, patch?: Record<string, unknown>) => Promise<void>;
    },
  ): Promise<{ succeeded: number; failed: number; chunkIndex: number }> {
    const total = payload.recipients.length;
    this.logger.log(
      `Chunk ${payload.chunkIndex}: issuing ${total} certificate(s) for tenant ${payload.tenantId}`,
    );

    // `issuedAt` crosses a JSON queue boundary as a string; restore it here.
    const issuedAt = payload.issuedAt ? new Date(payload.issuedAt) : null;
    const result = await this.certificates.processBulkChunk({ ...payload, issuedAt }, (percent) =>
      ctx.updateProgress(percent),
    );

    this.logger.log(
      `Chunk ${payload.chunkIndex} finished: ${result.succeeded} issued, ${result.failed} failed`,
    );
    await ctx.updateProgress(100, { result: { ...result, chunkIndex: payload.chunkIndex } });
    return { ...result, chunkIndex: payload.chunkIndex };
  }
}
