import { Logger } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import {
  tenantChannel,
  type EventBusPort,
  type RealtimeEvent,
  type RealtimeListener,
  type RealtimeMessage,
} from './eventbus.port';

/**
 * Redis pub/sub fan-out so realtime updates reach clients connected to ANY API
 * replica. A dedicated subscriber connection is required because an IORedis
 * client in subscribe mode cannot issue normal commands.
 */
export class RedisEventBus implements EventBusPort {
  readonly driver = 'redis' as const;
  private readonly logger = new Logger('RedisEventBus');
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly listeners = new Map<string, Set<RealtimeListener>>();
  private readonly subscribed = new Set<string>();

  constructor(
    private readonly redisUrl: string,
    private readonly prefix: string,
  ) {
    this.pub = new IORedis(redisUrl, { maxRetriesPerRequest: 3 });
    this.sub = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.sub.on('message', (channel, payload) => this.onMessage(channel, payload));
    this.sub.on('error', (err) => this.logger.error(`Redis subscriber error: ${err.message}`));
    this.pub.on('error', (err) => this.logger.error(`Redis publisher error: ${err.message}`));
  }

  private channel(tenantId: string): string {
    return `${this.prefix}:${tenantChannel(tenantId)}`;
  }

  private onMessage(channel: string, payload: string): void {
    const localKey = channel.startsWith(`${this.prefix}:`)
      ? channel.slice(this.prefix.length + 1)
      : channel;
    const set = this.listeners.get(localKey);
    if (!set || set.size === 0) return;
    let message: RealtimeMessage;
    try {
      message = JSON.parse(payload) as RealtimeMessage;
    } catch {
      return;
    }
    for (const listener of [...set]) {
      try {
        listener(message);
      } catch (err) {
        this.logger.warn(`Realtime listener threw: ${(err as Error).message}`);
      }
    }
  }

  async publish<T>(tenantId: string, event: RealtimeEvent, data: T): Promise<void> {
    const message: RealtimeMessage = {
      event,
      tenantId,
      data: data as Record<string, unknown>,
      at: new Date().toISOString(),
    };
    await this.pub.publish(this.channel(tenantId), JSON.stringify(message));
    // Also deliver locally: a client may be attached to this same replica and we
    // do not want to depend on pub/sub round-trip latency for that path.
    const set = this.listeners.get(tenantChannel(tenantId));
    if (set) for (const listener of [...set]) listener(message);
  }

  subscribe(tenantId: string, listener: RealtimeListener): () => void {
    const key = tenantChannel(tenantId);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    const channel = this.channel(tenantId);
    if (!this.subscribed.has(channel)) {
      this.subscribed.add(channel);
      void this.sub
        .subscribe(channel)
        .catch((err: Error) => this.logger.error(`subscribe failed: ${err.message}`));
    }
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(key);
        this.subscribed.delete(channel);
        void this.sub.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const pong = await this.pub.ping();
      return { ok: pong === 'PONG', detail: `redis pubsub ${pong}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    this.listeners.clear();
    await this.sub.quit().catch(() => this.sub.disconnect());
    await this.pub.quit().catch(() => this.pub.disconnect());
  }
}
