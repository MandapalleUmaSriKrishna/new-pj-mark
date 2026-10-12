import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { WebhooksService } from '../webhooks/webhooks.service';

export interface WebhookDeliveryPayload {
  deliveryId: string;
  webhookId: string;
  tenantId: string;
}

/**
 * Webhook delivery worker.
 *
 * Kept off the request path and off the mail worker so a slow or hostile
 * consumer cannot block certificate delivery. `WebhooksService.deliver` throws
 * when a retry is worthwhile, which is how the queue's backoff policy is driven.
 */
@Injectable()
export class WebhookProcessor implements OnModuleInit {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    private readonly webhooks: WebhooksService,
  ) {}

  onModuleInit(): void {
    this.queue.register<WebhookDeliveryPayload>(
      'webhook_delivery',
      (payload, ctx) => this.handle(payload, ctx),
      5,
    );
    this.logger.log(
      `Webhook delivery worker registered (queue=${this.queue.driver}, concurrency=5)`,
    );
  }

  async handle(
    payload: WebhookDeliveryPayload,
    ctx: {
      jobId: string;
      attempt: number;
      updateProgress: (percent: number, patch?: Record<string, unknown>) => Promise<void>;
    },
  ): Promise<{ status: number; ok: boolean; deliveryId: string }> {
    await ctx.updateProgress(25);
    const result = await this.webhooks.deliver(payload.deliveryId);
    await ctx.updateProgress(100);
    return { ...result, deliveryId: payload.deliveryId };
  }
}
