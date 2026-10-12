import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobRecord, JobType } from '@kdc/shared';
import { DATA_STORE, type DataStore, type Repository } from '../infra/persistence/repository';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { EVENT_BUS_PORT, type EventBusPort } from '../infra/events/eventbus.port';
import { buildFilter } from '../infra/persistence/filter';
import { newId, dayKey } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';

export interface JobStreamMessage {
  event: string;
  tenantId: string;
  data: Record<string, unknown>;
  at: string;
}

/**
 * Background job bookkeeping and the realtime stream.
 *
 * `JobRecord` rows are the durable view of progress (they survive restarts and
 * are queryable), while the queue driver holds the actual execution state. The
 * SSE endpoint replays recent records on connect and then forwards live messages
 * from the event bus, so a browser that was closed during a bulk run still sees
 * the final state when it reopens.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly jobs: Repository<JobRecord>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
  ) {
    this.jobs = store.repository<JobRecord>('jobs');
  }

  async create(
    tenantId: string,
    type: JobType,
    payload: Record<string, unknown>,
    total = 0,
    createdBy?: string | null,
  ): Promise<JobRecord> {
    const now = new Date();
    const job: JobRecord = {
      id: newId(),
      tenantId,
      type,
      status: 'queued',
      progress: 0,
      total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      payload,
      result: null,
      error: null,
      driver: this.queue.driver,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      createdBy: createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.insert(job);
    return job;
  }

  async get(tenantId: string, jobId: string): Promise<JobRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job || job.tenantId !== tenantId) throw AppException.notFound('Job');
    // Merge live queue state when the driver can report it.
    const live = await this.queue.getJob(String(job.payload.queueJobId ?? '')).catch(() => null);
    if (live && live.status !== job.status) {
      return { ...job, status: live.status, progress: Math.max(job.progress, live.progress) };
    }
    return job;
  }

  async list(
    tenantId: string,
    opts: { type?: JobType; status?: string; limit?: number } = {},
  ): Promise<JobRecord[]> {
    const filter: Record<string, unknown> = { tenantId };
    if (opts.type) filter.type = opts.type;
    if (opts.status) filter.status = opts.status;
    return this.jobs.find(buildFilter(filter), {
      sort: { createdAt: -1 },
      limit: Math.min(200, opts.limit ?? 50),
    });
  }

  async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    return this.jobs.updateById(jobId, patch as Record<string, unknown>);
  }

  async retry(tenantId: string, jobId: string): Promise<{ ok: true; job: JobRecord }> {
    const job = await this.get(tenantId, jobId);
    if (job.status !== 'failed')
      throw AppException.conflict(`Only failed jobs can be retried; this one is ${job.status}`);
    const updated = await this.jobs.updateById(jobId, {
      status: 'queued',
      error: null,
      progress: 0,
      attempts: (job.attempts ?? 0) + 1,
    });
    if (!updated) throw AppException.notFound('Job');
    await this.bus.publish(tenantId, 'job.progress', { jobId, status: 'queued', progress: 0 });
    return { ok: true, job: updated };
  }

  /** Which queue driver is live, so the UI can say whether jobs survive a restart. */
  get driver(): 'bullmq' | 'memory' {
    return this.queue.driver;
  }

  async queueCounts(): Promise<Record<string, number>> {
    return this.queue.counts();
  }

  async retryFailedInQueue(type?: JobType): Promise<number> {
    const n = await this.queue.retryFailed(type);
    this.logger.warn(`Re-queued ${n} failed job(s)${type ? ` of type ${type}` : ''}`);
    return n;
  }

  /** Subscribes to the tenant's realtime channel; returns an unsubscribe fn. */
  subscribe(tenantId: string, onMessage: (message: JobStreamMessage) => void): () => void {
    return this.bus.subscribe(tenantId, (message) => {
      onMessage({
        event: message.event,
        tenantId: message.tenantId,
        data: message.data,
        at: message.at,
      });
    });
  }

  /** Housekeeping: drop finished job rows older than the retention window. */
  async prune(retentionDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const removed = await this.jobs.deleteMany({
      status: { $in: ['completed', 'failed', 'cancelled'] },
      createdAt: { $lt: cutoff },
    });
    if (removed > 0) this.logger.log(`Pruned ${removed} job records older than ${dayKey(cutoff)}`);
    return removed;
  }
}
