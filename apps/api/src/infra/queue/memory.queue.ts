import { Logger } from '@nestjs/common';
import type { JobType } from '@kdc/shared';
import { newId } from '../ids';
import type { JobHandler, JobOptions, QueuedJob, QueuePort } from './queue.port';

/**
 * In-process queue driver.
 *
 * Implements the same contract as the BullMQ adapter: retries with exponential
 * backoff, per-type concurrency, delayed jobs, progress reporting and
 * de-duplication. Jobs are held in memory, so they do NOT survive a restart -
 * that limitation is reported by the health endpoint and the config warnings.
 */

interface InternalJob extends QueuedJob {
  options: JobOptions;
  runAt: number;
}

export class MemoryQueue implements QueuePort {
  readonly driver = 'memory' as const;
  private readonly logger = new Logger('MemoryQueue');
  private readonly handlers = new Map<
    JobType,
    { handler: JobHandler; concurrency: number; active: number }
  >();
  private readonly jobs = new Map<string, InternalJob>();
  private readonly dedupe = new Map<string, string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;

  register<T>(type: JobType, handler: JobHandler<T>, concurrency = 4): void {
    // Payload types differ per job type; the queue validates at the boundary.
    this.handlers.set(type, { handler: handler as JobHandler, concurrency, active: 0 });
    this.drain();
  }

  async enqueue<T>(type: JobType, payload: T, options: JobOptions = {}): Promise<string> {
    if (options.dedupeKey) {
      const existingId = this.dedupe.get(`${type}:${options.dedupeKey}`);
      if (existingId) {
        const existing = this.jobs.get(existingId);
        if (existing && (existing.status === 'queued' || existing.status === 'active'))
          return existingId;
      }
    }
    const id = newId();
    const now = Date.now();
    const job: InternalJob = {
      id,
      type,
      payload: payload as Record<string, unknown>,
      attempts: 0,
      status: 'queued',
      progress: 0,
      queuedAt: new Date(),
      startedAt: null,
      finishedAt: null,
      error: null,
      options,
      runAt: now + (options.delayMs ?? 0),
    };
    this.jobs.set(id, job);
    if (options.dedupeKey) this.dedupe.set(`${type}:${options.dedupeKey}`, id);
    this.scheduleDrain(Math.max(0, job.runAt - now));
    return id;
  }

  async getJob(id: string): Promise<QueuedJob | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    const { options: _o, runAt: _r, ...rest } = job;
    void _o;
    void _r;
    return { ...rest };
  }

  async counts(type?: JobType): Promise<Record<string, number>> {
    const out: Record<string, number> = {
      queued: 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const job of this.jobs.values()) {
      if (type && job.type !== type) continue;
      out[job.status] = (out[job.status] ?? 0) + 1;
    }
    return out;
  }

  async retryFailed(type?: JobType): Promise<number> {
    let n = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== 'failed') continue;
      if (type && job.type !== type) continue;
      job.status = 'queued';
      job.error = null;
      job.runAt = Date.now();
      n += 1;
    }
    if (n > 0) this.scheduleDrain(0);
    return n;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private scheduleDrain(delayMs: number): void {
    if (this.closed) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        void this.drain();
      },
      Math.min(delayMs, 5_000),
    );
    // Never hold the Node event loop open just for queued work.
    timer.unref?.();
    this.timers.add(timer);
  }

  private drain(): void {
    if (this.closed) return;
    const now = Date.now();
    let scheduled = false;
    for (const job of this.jobs.values()) {
      if (job.status !== 'queued') continue;
      if (job.runAt > now) {
        this.scheduleDrain(job.runAt - now);
        continue;
      }
      const entry = this.handlers.get(job.type);
      if (!entry) continue; // no worker registered; stays queued
      if (entry.active >= entry.concurrency) {
        scheduled = true;
        continue;
      }
      entry.active += 1;
      job.status = 'active';
      job.attempts += 1;
      job.startedAt = new Date();
      void this.run(job, entry);
    }
    if (scheduled) this.scheduleDrain(25);
  }

  private async run(
    job: InternalJob,
    entry: { handler: JobHandler; concurrency: number; active: number },
  ): Promise<void> {
    const attempt = job.attempts;
    try {
      const result = await entry.handler(job.payload, {
        jobId: job.id,
        attempt,
        updateProgress: async (percent, patch) => {
          job.progress = Math.max(0, Math.min(100, Math.round(percent)));
          if (patch) Object.assign(job.payload, patch);
        },
      });
      job.status = 'completed';
      job.progress = 100;
      job.finishedAt = new Date();
      if (result && typeof result === 'object')
        job.payload = { ...job.payload, result: result as Record<string, unknown> };
    } catch (err) {
      const maxAttempts = job.options.attempts ?? 3;
      job.error = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        const backoff = (job.options.backoffMs ?? 500) * 2 ** (attempt - 1);
        job.status = 'queued';
        job.runAt = Date.now() + backoff;
        this.logger.warn(
          `Job ${job.type} ${job.id} failed (attempt ${attempt}/${maxAttempts}), retrying in ${backoff}ms: ${job.error}`,
        );
        this.scheduleDrain(backoff);
      } else {
        job.status = 'failed';
        job.finishedAt = new Date();
        this.logger.error(
          `Job ${job.type} ${job.id} permanently failed after ${attempt} attempts: ${job.error}`,
        );
      }
    } finally {
      entry.active = Math.max(0, entry.active - 1);
      this.drain();
    }
  }

  /** Test helper: resolves once no job is queued or running. */
  async drainAll(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pending = [...this.jobs.values()].some(
        (j) => j.status === 'queued' || j.status === 'active',
      );
      if (!pending) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`MemoryQueue did not drain within ${timeoutMs}ms`);
  }
}
