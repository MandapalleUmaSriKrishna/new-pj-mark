import { Logger } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import IORedis from 'ioredis';
import type { JobStatus, JobType } from '@kdc/shared';
import { newId } from '../ids';
import type { JobHandler, JobOptions, QueuedJob, QueuePort } from './queue.port';

/**
 * BullMQ queue driver (production).
 *
 * One Redis-backed queue per job type plus one worker per registered handler.
 * Jobs carry our own identifier in the payload so `getJob` keeps working
 * uniformly across drivers; BullMQ's internal id is used for the queue lookup.
 */
export class BullQueue implements QueuePort {
  readonly driver = 'bullmq' as const;
  private readonly logger = new Logger('BullQueue');
  private readonly connection: ConnectionOptions;
  private readonly queues = new Map<JobType, Queue>();
  private readonly workers = new Map<JobType, Worker>();
  /** ourJobId -> `${type}:${bullJobId}` */
  private readonly index = new Map<string, { type: JobType; bullId: string }>();

  constructor(
    redisUrl: string,
    private readonly prefix: string,
  ) {
    // BullMQ needs `maxRetriesPerRequest: null` on a blocking connection.
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  private queueFor(type: JobType): Queue {
    let q = this.queues.get(type);
    if (!q) {
      q = new Queue(`${this.prefix}:${type}`, {
        connection: this.connection,
        defaultJobOptions: { removeOnComplete: { count: 2_000 }, removeOnFail: { count: 5_000 } },
      });
      this.queues.set(type, q);
    }
    return q;
  }

  register<T>(type: JobType, handler: JobHandler<T>, concurrency = 4): void {
    if (this.workers.has(type)) return;
    const worker = new Worker(
      `${this.prefix}:${type}`,
      async (job: Job) => {
        const payload = (job.data?.payload ?? {}) as T;
        const result = await handler(payload, {
          jobId: String(job.data?.jobId ?? job.id),
          attempt: job.attemptsMade + 1,
          updateProgress: async (percent) => {
            await job.updateProgress(Math.max(0, Math.min(100, Math.round(percent))));
          },
        });
        return (result ?? {}) as Record<string, unknown>;
      },
      { connection: this.connection, concurrency },
    );
    worker.on('failed', (job, err) => {
      this.logger.warn(
        `BullMQ job ${type}/${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });
    worker.on('error', (err) =>
      this.logger.error(`BullMQ worker error on ${type}: ${err.message}`),
    );
    this.workers.set(type, worker);
  }

  async enqueue<T>(type: JobType, payload: T, options: JobOptions = {}): Promise<string> {
    const jobId = newId();
    const queue = this.queueFor(type);
    const bull = await queue.add(
      type,
      { jobId, payload },
      {
        jobId: `${type}:${jobId}`,
        delay: options.delayMs,
        attempts: options.attempts ?? 3,
        backoff: { type: 'exponential', delay: options.backoffMs ?? 1_000 },
        priority: options.priority,
        ...(options.dedupeKey ? { jobId: `${type}:${options.dedupeKey}` } : {}),
      },
    );
    this.index.set(jobId, { type, bullId: String(bull.id) });
    return jobId;
  }

  async getJob(id: string): Promise<QueuedJob | null> {
    const ref = this.index.get(id);
    if (!ref) return null;
    const queue = this.queueFor(ref.type);
    const job = await queue.getJob(ref.bullId);
    if (!job) return null;
    return mapBullJob(job, id);
  }

  async counts(type?: JobType): Promise<Record<string, number>> {
    const types = type ? [type] : [...this.queues.keys()];
    const total: Record<string, number> = {
      queued: 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const t of types) {
      const c = await this.queueFor(t).getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );
      total.queued += (c.waiting ?? 0) + (c.delayed ?? 0);
      total.active += c.active ?? 0;
      total.completed += c.completed ?? 0;
      total.failed += c.failed ?? 0;
    }
    return total;
  }

  async retryFailed(type?: JobType): Promise<number> {
    const types = type ? [type] : [...this.queues.keys()];
    let n = 0;
    for (const t of types) {
      const failed = await this.queueFor(t).getJobs(['failed']);
      for (const job of failed) {
        await job.retry();
        n += 1;
      }
    }
    return n;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    const conn = this.connection as IORedis;
    await conn.quit().catch(() => conn.disconnect());
  }
}

function mapBullJob(job: Job, ourId: string): QueuedJob {
  const state = job.finishedOn
    ? job.returnvalue !== undefined
      ? 'completed'
      : 'failed'
    : job.processedOn
      ? 'active'
      : 'queued';
  return {
    id: ourId,
    type: job.name as JobType,
    payload: (job.data?.payload ?? {}) as Record<string, unknown>,
    attempts: job.attemptsMade,
    status: state as JobStatus,
    progress: typeof job.progress === 'number' ? job.progress : 0,
    queuedAt: new Date(job.timestamp),
    startedAt: job.processedOn ? new Date(job.processedOn) : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    error: job.failedReason ?? null,
  };
}
