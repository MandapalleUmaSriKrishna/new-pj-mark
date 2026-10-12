import { Logger } from '@nestjs/common';
import {
  tenantChannel,
  type EventBusPort,
  type RealtimeEvent,
  type RealtimeListener,
  type RealtimeMessage,
} from './eventbus.port';

/** Single-process fan-out. Each subscriber gets its own listener set. */
export class MemoryEventBus implements EventBusPort {
  readonly driver = 'memory' as const;
  private readonly logger = new Logger('MemoryEventBus');
  private readonly listeners = new Map<string, Set<RealtimeListener>>();

  async publish<T>(tenantId: string, event: RealtimeEvent, data: T): Promise<void> {
    const message: RealtimeMessage = {
      event,
      tenantId,
      data: data as Record<string, unknown>,
      at: new Date().toISOString(),
    };
    const set = this.listeners.get(tenantChannel(tenantId));
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(message);
      } catch (err) {
        this.logger.warn(`Realtime listener threw: ${(err as Error).message}`);
      }
    }
  }

  subscribe(tenantId: string, listener: RealtimeListener): () => void {
    const key = tenantChannel(tenantId);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(key);
    };
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `in-process bus (${this.listeners.size} channels)` };
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }
}
