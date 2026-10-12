/**
 * Cache / distributed-state port: short-lived values, counters for rate limits,
 * and simple locks. Redis in production, in-process elsewhere.
 */
export interface CachePort {
  readonly driver: 'redis' | 'memory';
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<number>;
  /** Atomic increment returning the new value; used by the rate limiter. */
  incr(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number }>;
  /** Best-effort mutual exclusion. Returns false when already held. */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
  ping(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}

export const CACHE_PORT = Symbol('KDC_CACHE_PORT');
