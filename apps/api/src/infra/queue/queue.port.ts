import type { JobStatus, JobType } from '@kdc/shared';

/**
 * Background job port.
 *
 * Production uses BullMQ on Redis (durable, retried, delayed, rate-limited,
 * visible across processes). Local dev and the test suite use an in-process
 * driver with the same semantics minus durability. Modules only ever see this
 * interface, so switching drivers is a configuration change, not a code change.
 */

export interface JobOptions {
  /** Delay before the job becomes eligible, in milliseconds. */
  delayMs?: number;
  /** Total attempts including the first. */
  attempts?: number;
  /** Exponential backoff base in milliseconds. */
  backoffMs?: number;
  /** Keeps the job unique while one with the same key is pending. */
  dedupeKey?: string;
  priority?: number;
}

export interface QueuedJob<T = Record<string, unknown>> {
  id: string;
  type: JobType;
  payload: T;
  attempts: number;
  status: JobStatus;
  progress: number;
  queuedAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  error?: string | null;
}

export type JobHandler<T = Record<string, unknown>> = (
  payload: T,
  ctx: {
    jobId: string;
    attempt: number;
    updateProgress: (percent: number, patch?: Record<string, unknown>) => Promise<void>;
  },
) => Promise<Record<string, unknown> | void>;

export interface QueuePort {
  readonly driver: 'bullmq' | 'memory';
  register<T = Record<string, unknown>>(
    type: JobType,
    handler: JobHandler<T>,
    concurrency?: number,
  ): void;
  enqueue<T = Record<string, unknown>>(
    type: JobType,
    payload: T,
    options?: JobOptions,
  ): Promise<string>;
  getJob(id: string): Promise<QueuedJob | null>;
  counts(type?: JobType): Promise<Record<string, number>>;
  retryFailed(type?: JobType): Promise<number>;
  shutdown(): Promise<void>;
}

export const QUEUE_PORT = Symbol('KDC_QUEUE_PORT');
