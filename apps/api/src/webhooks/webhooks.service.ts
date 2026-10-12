import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WebhookDelivery, WebhookEndpoint } from '@kdc/shared';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_HEADERS,
  WEBHOOK_TOLERANCE_SECONDS,
  generateWebhookSecret,
  type WebhookEvent,
} from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { CryptoService } from '../infra/crypto/crypto.service';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { EVENT_BUS_PORT, type EventBusPort } from '../infra/events/eventbus.port';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { assertPublicWebhookUrl, assertResolvedAddressIsPublic } from './url-safety';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_ATTEMPTS = 8;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024;
/** Endpoints that fail this many times in a row are disabled automatically. */
const AUTO_DISABLE_AFTER = 25;

export interface WebhookPayload {
  event: WebhookEvent;
  data: Record<string, unknown>;
  tenantId: string;
  occurredAt: string;
}

/**
 * Outbound webhooks.
 *
 * Every delivery is signed `t=<unix>,v1=<hmac-sha256(t.body)>` with the
 * endpoint's own secret and sent with an idempotency id in
 * `x-kdc-delivery-id`, so a consumer can verify authenticity and de-duplicate
 * retries. Failures retry with exponential backoff and the endpoint is disabled
 * automatically after a sustained failure run, with the tenant notified in real
 * time rather than discovering it days later.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly endpoints: Repository<WebhookEndpoint>;
  private readonly deliveries: Repository<WebhookDelivery>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {
    this.endpoints = store.repository<WebhookEndpoint>('webhook_endpoints');
    this.deliveries = store.repository<WebhookDelivery>('webhook_deliveries');
  }

  static readonly EVENTS = WEBHOOK_EVENTS;

  /* ---------------------------------------------------------------- CRUD */

  async list(
    tenantId: string,
  ): Promise<(Omit<WebhookEndpoint, 'secret'> & { secretPreview: string })[]> {
    const rows = await this.endpoints.find({ tenantId }, { sort: { createdAt: -1 } });
    return rows.map((r) => redactEndpoint(r));
  }

  async get(tenantId: string, webhookId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.endpoints.findById(webhookId);
    if (!endpoint || endpoint.tenantId !== tenantId) throw AppException.notFound('Webhook');
    return endpoint;
  }

  async create(
    tenantId: string,
    input: { url: string; events: WebhookEvent[]; description?: string | null; active?: boolean },
    actorId: string,
  ): Promise<{
    endpoint: Omit<WebhookEndpoint, 'secret'> & { secretPreview: string };
    secret: string;
  }> {
    this.tenants.assertFeature(await this.tenants.planOf(tenantId), 'webhooks');
    await this.tenants.assertHeadroom(tenantId, 'webhooks');

    const check = assertPublicWebhookUrl(input.url);
    if (!check.ok || !check.url)
      throw AppException.validationFailed(check.reason ?? 'Invalid webhook URL');
    const normalised = check.url.toString();
    for (const event of input.events) {
      if (!WEBHOOK_EVENTS.includes(event))
        throw AppException.validationFailed(`Unknown webhook event "${event}"`);
    }
    if (input.events.length === 0) throw AppException.validationFailed('Select at least one event');

    const secret = generateWebhookSecret();
    const now = new Date();
    const endpoint: WebhookEndpoint = {
      id: newId(),
      tenantId,
      url: normalised,
      events: [...new Set(input.events)],
      secret,
      active: input.active ?? true,
      description: input.description ?? null,
      failureCount: 0,
      disabledAt: null,
      lastDeliveryAt: null,
      lastStatus: null,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.endpoints.insert(endpoint);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('That webhook URL is already registered');
      throw err;
    }
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'webhook.created',
      'webhook',
      endpoint.id,
      {
        url: normalised,
        events: endpoint.events,
      },
    );
    // The plaintext secret is returned exactly once and never again.
    return { endpoint: redactEndpoint(endpoint), secret };
  }

  async update(
    tenantId: string,
    webhookId: string,
    input: {
      url?: string;
      events?: WebhookEvent[];
      description?: string | null;
      active?: boolean;
      rotateSecret?: boolean;
    },
    actorId: string,
  ): Promise<{
    endpoint: Omit<WebhookEndpoint, 'secret'> & { secretPreview: string };
    secret?: string;
  }> {
    const existing = await this.get(tenantId, webhookId);
    const patch: Record<string, unknown> = {};
    let secret: string | undefined;

    if (input.url !== undefined && input.url !== existing.url) {
      const check = assertPublicWebhookUrl(input.url);
      if (!check.ok || !check.url)
        throw AppException.validationFailed(check.reason ?? 'Invalid webhook URL');
      patch.url = check.url.toString();
      patch.failureCount = 0;
      patch.disabledAt = null;
    }
    if (input.events) {
      for (const event of input.events) {
        if (!WEBHOOK_EVENTS.includes(event))
          throw AppException.validationFailed(`Unknown webhook event "${event}"`);
      }
      patch.events = [...new Set(input.events)];
    }
    if (input.description !== undefined) patch.description = input.description;
    if (input.active !== undefined) {
      patch.active = input.active;
      if (input.active) {
        patch.failureCount = 0;
        patch.disabledAt = null;
      }
    }
    if (input.rotateSecret) {
      secret = generateWebhookSecret();
      patch.secret = secret;
    }
    if (Object.keys(patch).length === 0) return { endpoint: redactEndpoint(existing) };

    const updated = await this.endpoints.updateById(webhookId, patch);
    if (!updated) throw AppException.notFound('Webhook');
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'webhook.updated',
      'webhook',
      webhookId,
      {
        changed: Object.keys(patch).filter((k) => k !== 'secret'),
        rotatedSecret: Boolean(input.rotateSecret),
      },
    );
    return { endpoint: redactEndpoint(updated), ...(secret ? { secret } : {}) };
  }

  async remove(tenantId: string, webhookId: string, actorId: string): Promise<{ ok: true }> {
    const existing = await this.get(tenantId, webhookId);
    await this.endpoints.deleteById(webhookId);
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'webhook.deleted',
      'webhook',
      webhookId,
      {
        url: existing.url,
      },
      'warning',
    );
    return { ok: true };
  }

  /* ----------------------------------------------------------- fan-out */

  /** Fans an event out to every matching active endpoint for the tenant. */
  async emit(
    tenantId: string,
    event: WebhookEvent,
    data: Record<string, unknown>,
  ): Promise<number> {
    const endpoints = await this.endpoints.find({
      tenantId,
      active: true,
      events: { $has: event },
    });
    if (endpoints.length === 0) return 0;
    const payload: WebhookPayload = { event, data, tenantId, occurredAt: new Date().toISOString() };
    for (const endpoint of endpoints) {
      const delivery = await this.createDelivery(endpoint, payload);
      await this.queue.enqueue(
        'webhook_delivery',
        { deliveryId: delivery.id, webhookId: endpoint.id, tenantId },
        { attempts: MAX_ATTEMPTS, backoffMs: 15_000, dedupeKey: `wh:${delivery.id}` },
      );
    }
    return endpoints.length;
  }

  private async createDelivery(
    endpoint: WebhookEndpoint,
    payload: WebhookPayload,
  ): Promise<WebhookDelivery> {
    const now = new Date();
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(now.getTime() / 1000);
    const signature = this.crypto.signWebhookPayload(endpoint.secret, timestamp, body);
    const delivery: WebhookDelivery = {
      id: newId(),
      tenantId: endpoint.tenantId,
      webhookId: endpoint.id,
      event: payload.event,
      payload: payload as unknown as Record<string, unknown>,
      signature,
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: now,
      responseStatus: null,
      responseBody: null,
      lastError: null,
      succeededAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.deliveries.insert(delivery);
    return delivery;
  }

  /* ----------------------------------------------------------- delivery */

  /** Worker entry point. Returns a result the queue can retry on failure. */
  async deliver(deliveryId: string): Promise<{ status: number; ok: boolean }> {
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery) throw AppException.notFound('Webhook delivery');
    const endpoint = await this.endpoints.findById(delivery.webhookId);
    if (!endpoint) {
      await this.deliveries.updateById(deliveryId, {
        status: 'abandoned',
        lastError: 'Endpoint was deleted',
      });
      return { status: 0, ok: false };
    }
    if (!endpoint.active) {
      await this.deliveries.updateById(deliveryId, {
        status: 'abandoned',
        lastError: 'Endpoint is disabled',
      });
      return { status: 0, ok: false };
    }

    const urlCheck = assertPublicWebhookUrl(endpoint.url);
    if (!urlCheck.ok || !urlCheck.url) {
      await this.deliveries.updateById(deliveryId, {
        status: 'abandoned',
        lastError: urlCheck.reason ?? 'URL rejected',
      });
      await this.endpoints.updateById(endpoint.id, { active: false, disabledAt: new Date() });
      return { status: 0, ok: false };
    }

    // Re-check what the hostname resolves to RIGHT NOW, so a DNS rebinding
    // attack cannot make us connect to an internal address.
    const hostname = urlCheck.url.hostname.replace(/^\[|\]$/g, '');
    if (!isIP(hostname)) {
      try {
        const records = await lookup(hostname, { all: true, verbatim: true });
        for (const record of records) assertResolvedAddressIsPublic(record.address);
      } catch (err) {
        const message = (err as Error).message;
        if (message.startsWith('Refusing to connect')) {
          await this.deliveries.updateById(deliveryId, { status: 'abandoned', lastError: message });
          await this.endpoints.updateById(endpoint.id, { active: false, disabledAt: new Date() });
          this.logger.error(`Webhook ${endpoint.id} disabled: ${message}`);
          return { status: 0, ok: false };
        }
        throw new Error(`Could not resolve webhook host ${hostname}: ${message}`, { cause: err });
      }
    }

    const body = JSON.stringify(delivery.payload);
    // Re-sign with a fresh timestamp on every attempt so the consumer's replay
    // window stays valid across retries.
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.crypto.signWebhookPayload(endpoint.secret, timestamp, body);

    let response: Response;
    try {
      response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'KrishnaDigitalCertificate-Webhook/1.0 (+https://kdc.example/webhooks)',
          accept: 'application/json',
          [WEBHOOK_HEADERS.signature]: signature,
          [WEBHOOK_HEADERS.timestamp]: String(timestamp),
          [WEBHOOK_HEADERS.deliveryId]: delivery.id,
          [WEBHOOK_HEADERS.event]: delivery.event,
        },
        body,
        redirect: 'error', // a redirect could point back inside the network
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return this.recordFailure(delivery, endpoint, `Request failed: ${(err as Error).message}`);
    }

    const text = (await response.text().catch(() => '')).slice(0, MAX_RESPONSE_BYTES);
    if (response.ok) {
      await this.deliveries.updateById(deliveryId, {
        status: 'succeeded',
        attempts: delivery.attempts + 1,
        responseStatus: response.status,
        responseBody: text || null,
        lastError: null,
        succeededAt: new Date(),
        signature,
      });
      await this.endpoints.updateById(endpoint.id, {
        failureCount: 0,
        lastDeliveryAt: new Date(),
        lastStatus: response.status,
      });
      await this.audit.record({
        tenantId: endpoint.tenantId,
        actorRole: 'system',
        action: 'webhook.delivered',
        entityType: 'webhook',
        entityId: endpoint.id,
        payload: {
          deliveryId,
          event: delivery.event,
          status: response.status,
          attempts: delivery.attempts + 1,
        },
      });
      return { status: response.status, ok: true };
    }
    return this.recordFailure(
      delivery,
      endpoint,
      `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      response.status,
    );
  }

  private async recordFailure(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
    reason: string,
    status?: number,
  ): Promise<{ status: number; ok: boolean }> {
    const attempts = delivery.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const failureCount = (endpoint.failureCount ?? 0) + 1;
    const autoDisable = failureCount >= AUTO_DISABLE_AFTER;

    await this.deliveries.updateById(delivery.id, {
      status: exhausted ? 'abandoned' : 'failed',
      attempts,
      responseStatus: status ?? null,
      lastError: reason,
      signature: delivery.signature,
      nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts)),
    });
    await this.endpoints.updateById(endpoint.id, {
      failureCount,
      lastDeliveryAt: new Date(),
      lastStatus: status ?? null,
      ...(autoDisable ? { active: false, disabledAt: new Date() } : {}),
    });
    await this.audit.record({
      tenantId: endpoint.tenantId,
      actorRole: 'system',
      action: 'webhook.failed',
      entityType: 'webhook',
      entityId: endpoint.id,
      payload: {
        deliveryId: delivery.id,
        event: delivery.event,
        attempts,
        reason,
        autoDisabled: autoDisable,
      },
      severity: autoDisable ? 'critical' : 'warning',
    });
    await this.bus
      .publish(endpoint.tenantId, 'webhook.failed', {
        webhookId: endpoint.id,
        deliveryId: delivery.id,
        event: delivery.event,
        attempts,
        reason,
        autoDisabled: autoDisable,
      })
      .catch(() => undefined);
    this.logger.warn(
      `Webhook ${endpoint.id} delivery ${delivery.id} failed (attempt ${attempts}): ${reason}`,
    );

    if (!exhausted) throw new Error(reason); // let the queue apply its backoff
    return { status: status ?? 0, ok: false };
  }

  /** Sends a synthetic ping so an operator can validate an endpoint. */
  async sendTest(tenantId: string, webhookId: string, actorId: string): Promise<WebhookDelivery> {
    const endpoint = await this.get(tenantId, webhookId);
    const payload: WebhookPayload = {
      event: 'certificate.issued',
      tenantId,
      occurredAt: new Date().toISOString(),
      data: {
        test: true,
        message:
          'This is a test delivery from Krishna Digital Certificate. No certificate was issued.',
        serial: null,
      },
    };
    const delivery = await this.createDelivery(endpoint, payload);
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'webhook.delivered',
      'webhook',
      webhookId,
      {
        test: true,
        deliveryId: delivery.id,
      },
    );
    const result = await this.deliver(delivery.id).catch((err: Error) => ({
      status: 0,
      ok: false,
      error: err.message,
    }));
    const fresh = await this.deliveries.findById(delivery.id);
    if (fresh) fresh.responseStatus = (result as { status: number }).status ?? fresh.responseStatus;
    return (fresh ?? delivery) as WebhookDelivery;
  }

  async listDeliveries(
    tenantId: string,
    webhookId?: string,
    limit = 50,
  ): Promise<WebhookDelivery[]> {
    const filter = webhookId ? { tenantId, webhookId } : { tenantId };
    return this.deliveries.find(filter, { sort: { createdAt: -1 }, limit: Math.min(200, limit) });
  }

  /** Public verification helper, mirrored in docs/API.md for integrators. */
  verifySignature(
    secret: string,
    signatureHeader: string,
    rawBody: string,
    toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
  ): boolean {
    return this.crypto.verifyWebhookSignature(secret, signatureHeader, rawBody, toleranceSeconds);
  }
}

export function redactEndpoint(
  endpoint: WebhookEndpoint,
): Omit<WebhookEndpoint, 'secret'> & { secretPreview: string } {
  const { secret, ...rest } = endpoint;
  return { ...rest, secretPreview: `${secret.slice(0, 10)}\u2026${secret.slice(-4)}` };
}

function backoffMs(attempt: number): number {
  // 15s, 60s, 4m, 15m, 1h, 3h, 6h - capped, so a dead endpoint stops quickly.
  const steps = [15_000, 60_000, 240_000, 900_000, 3_600_000, 10_800_000, 21_600_000];
  return steps[Math.min(attempt - 1, steps.length - 1)] ?? 21_600_000;
}
