import { Logger } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import type { CachePort } from './cache.port';

/**
 * Redis cache driver: shared counters (rate limits), locks and short-lived
 * lookups across API replicas.
 */
export class RedisCache implements CachePort {
  readonly driver = 'redis' as const;
  private readonly logger = new Logger('RedisCache');
  private readonly client: Redis;

  constructor(
    redisUrl: string,
    private readonly prefix: string,
    maxRetries = 3,
  ) {
    this.client = new IORedis(redisUrl, {
      maxRetriesPerRequest: maxRetries,
      keyPrefix: `${prefix}:cache:`,
    });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) await this.client.set(key, raw, 'EX', ttlSeconds);
    else await this.client.set(key, raw);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async delByPrefix(prefix: string): Promise<number> {
    // SCAN (not KEYS) so a large keyspace never blocks the server.
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) deleted += await this.client.del(...keys);
    } while (cursor !== '0');
    return deleted;
  }

  async incr(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, ttlSeconds);
    const ttl = await this.client.ttl(key);
    return { count, ttlSeconds: ttl > 0 ? ttl : ttlSeconds };
  }

  /** NX + PX in one round trip: safe mutual exclusion. */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(`lock:${key}`, '1', 'EX', Math.max(1, ttlSeconds), 'NX');
    return res === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(`lock:${key}`);
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const pong = await this.client.ping();
      return { ok: pong === 'PONG', detail: `redis ${pong}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
