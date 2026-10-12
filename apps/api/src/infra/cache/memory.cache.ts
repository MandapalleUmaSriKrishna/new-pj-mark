import type { CachePort } from './cache.port';

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/** In-process cache. Counters and locks are per-process only. */
export class MemoryCache implements CachePort {
  readonly driver = 'memory' as const;
  private readonly store = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodic sweep so long-lived processes do not accumulate expired keys.
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.store)
      if (v.expiresAt !== null && v.expiresAt <= now) this.store.delete(k);
  }

  private live(key: string): Entry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.live(key);
    return entry ? (entry.value as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<number> {
    let n = 0;
    for (const k of [...this.store.keys()])
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        n += 1;
      }
    return n;
  }

  async incr(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    const existing = this.live(key);
    const count = existing ? (existing.value as number) + 1 : 1;
    const expiresAt = existing?.expiresAt ?? Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value: count, expiresAt });
    return { count, ttlSeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) };
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    if (this.live(lockKey)) return false;
    await this.set(lockKey, true, ttlSeconds);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    await this.del(`lock:${key}`);
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `in-process cache (${this.store.size} keys)` };
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.store.clear();
  }
}
