import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Delivery, DeliveryChannel } from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { DATA_STORE, type DataStore, type Repository } from '../infra/persistence/repository';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { EVENT_BUS_PORT, type EventBusPort } from '../infra/events/eventbus.port';
import { buildFilter } from '../infra/persistence/filter';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';

export interface QueuedEmail {
  tenantId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  category: 'certificate' | 'invite' | 'welcome' | 'approval' | 'quota' | 'revocation' | 'system';
  certificateId?: string;
  channel?: DeliveryChannel;
  /** Storage key of a PDF to attach, resolved by the worker at send time. */
  attachmentKey?: string;
  attachmentName?: string;
}

export interface EmailDeliveryPayload {
  deliveryId: string;
  tenantId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  category: string;
  certificateId?: string;
  attachmentKey?: string;
  attachmentName?: string;
}

/**
 * Outbound notification orchestration.
 *
 * Emails are recorded as a `Delivery` row BEFORE they are queued, so there is
 * always an audit trail of what the system intended to send even if the worker
 * never runs. The worker then updates that row with the transport's real result.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly deliveries: Repository<Delivery>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {
    this.deliveries = store.repository<Delivery>('deliveries');
  }

  async queueEmail(input: QueuedEmail): Promise<Delivery> {
    if (!isValidRecipient(input.to)) {
      throw AppException.validationFailed(`"${input.to}" is not a deliverable email address`);
    }
    const now = new Date();
    const delivery: Delivery = {
      id: newId(),
      tenantId: input.tenantId,
      certificateId: input.certificateId ?? '',
      channel: input.channel ?? 'email',
      to: input.to.toLowerCase(),
      status: 'pending',
      subject: input.subject,
      attempts: 0,
      lastError: null,
      provider: null,
      providerMessageId: null,
      sentAt: null,
      openedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.deliveries.insert(delivery);

    const payload: EmailDeliveryPayload = {
      deliveryId: delivery.id,
      tenantId: input.tenantId,
      to: delivery.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      category: input.category,
      certificateId: input.certificateId,
      attachmentKey: input.attachmentKey,
      attachmentName: input.attachmentName,
    };
    const jobId = await this.queue.enqueue('email_delivery', payload, {
      attempts: this.env.MAIL_MAX_ATTEMPTS,
      backoffMs: 30_000,
      dedupeKey: `delivery:${delivery.id}`,
    });
    await this.deliveries.updateById(delivery.id, {
      provider: `queue:${this.queue.driver}:${jobId}`,
    });
    return delivery;
  }

  async recordResult(
    deliveryId: string,
    result: {
      delivered: boolean;
      status: 'captured' | 'sent' | 'failed';
      provider: string;
      providerMessageId?: string;
      error?: string;
    },
  ): Promise<Delivery | null> {
    const existing = await this.deliveries.findById(deliveryId);
    if (!existing) return null;
    const patch: Record<string, unknown> = {
      status: result.status === 'captured' ? 'captured' : result.delivered ? 'sent' : 'failed',
      attempts: existing.attempts + 1,
      provider: result.provider,
      providerMessageId: result.providerMessageId ?? existing.providerMessageId,
      lastError: result.error ?? null,
      sentAt: result.delivered ? new Date() : existing.sentAt,
    };
    const updated = await this.deliveries.updateById(deliveryId, patch);
    if (updated && updated.status === 'failed') {
      await this.bus.publish(existing.tenantId, 'delivery.failed', {
        deliveryId,
        to: existing.to,
        subject: existing.subject,
        error: result.error ?? 'unknown',
        attempts: updated.attempts,
      });
      this.logger.warn(
        `Email delivery ${deliveryId} to ${existing.to} failed: ${result.error ?? 'unknown'}`,
      );
    }
    return updated;
  }

  async markDelivered(deliveryId: string): Promise<void> {
    await this.deliveries.updateById(deliveryId, { status: 'delivered', sentAt: new Date() });
  }

  async listForCertificate(tenantId: string, certificateId: string): Promise<Delivery[]> {
    return this.deliveries.find(
      { tenantId, certificateId },
      { sort: { createdAt: -1 }, limit: 50 },
    );
  }

  async listForTenant(
    tenantId: string,
    opts: { status?: string; limit?: number } = {},
  ): Promise<Delivery[]> {
    const filter: Record<string, unknown> = { tenantId };
    if (opts.status) filter.status = opts.status;
    return this.deliveries.find(buildFilter(filter), {
      sort: { createdAt: -1 },
      limit: Math.min(200, opts.limit ?? 50),
    });
  }

  /** Delivery counts used by the dashboard. */
  async stats(tenantId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {
      pending: 0,
      captured: 0,
      sent: 0,
      delivered: 0,
      bounced: 0,
      failed: 0,
    };
    for (const status of Object.keys(out)) {
      out[status] = await this.deliveries.count({ tenantId, status });
    }
    return out;
  }
}

/**
 * Recipient validation.
 *
 * Deliberately stricter than a bare regex on the whole address: the local part
 * must not contain spaces or punctuation that gateways reject, and the domain
 * must have a dot. This catches the most common CSV import errors before we
 * spend a send attempt on them.
 */
export function isValidRecipient(value: string): boolean {
  const email = (value ?? '').trim();
  if (!email || email.length > 254) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64) return false;
  if (/[\s,;:()<>[\]\\"]/.test(local)) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain))
    return false;
  if (domain.length > 253) return false;
  return true;
}
