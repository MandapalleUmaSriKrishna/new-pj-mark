/**
 * Realtime fan-out port.
 *
 * The web app subscribes over Server-Sent Events to a tenant channel and gets
 * live job progress, issuance counts and approval notifications. SSE was chosen
 * over WebSockets because it survives HTTP proxies, needs no extra port, and
 * degrades to polling on a flaky mobile connection.
 *
 * `memory` publishes within the current process (fine for one replica and for
 * tests); `redis` publishes over pub/sub so every replica reaches every client.
 */

export const REALTIME_EVENTS = [
  'job.progress',
  'job.completed',
  'job.failed',
  'certificate.issued',
  'certificate.revoked',
  'certificate.approved',
  'certificate.rejected',
  'import.progress',
  'import.completed',
  'import.failed',
  'quota.warning',
  'webhook.failed',
  'delivery.failed',
  'tenant.updated',
] as const;
export type RealtimeEvent = (typeof REALTIME_EVENTS)[number];

export interface RealtimeMessage<T = Record<string, unknown>> {
  event: RealtimeEvent;
  tenantId: string;
  data: T;
  at: string;
}

export type RealtimeListener = (message: RealtimeMessage) => void;

export interface EventBusPort {
  readonly driver: 'redis' | 'memory';
  publish<T>(tenantId: string, event: RealtimeEvent, data: T): Promise<void>;
  subscribe(tenantId: string, listener: RealtimeListener): () => void;
  ping(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}

export const EVENT_BUS_PORT = Symbol('KDC_EVENT_BUS_PORT');

export function tenantChannel(tenantId: string): string {
  return `kdc:rt:${tenantId}`;
}
