import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MAIL_PORT, type MailPort } from '../infra/mail/mail.port';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { STORAGE_PORT, type StoragePort } from '../infra/storage/storage.port';
import {
  NotificationsService,
  type EmailDeliveryPayload,
} from '../notifications/notifications.service';
import { ENV_CONFIG, type Env } from '../config/config.tokens';

/**
 * Mail worker.
 *
 * Runs off the `email_delivery` queue so bulk issuance never blocks on SMTP and
 * a slow or failing provider is retried with backoff instead of dropping the
 * notification. The PDF is fetched from storage at send time rather than being
 * carried in the job payload, which keeps queue messages small.
 */
@Injectable()
export class MailProcessor implements OnModuleInit {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.queue.register<EmailDeliveryPayload>(
      'email_delivery',
      (payload) => this.handle(payload),
      5,
    );
    this.logger.log(
      `Mail worker registered (driver=${this.mail.driver}, queue=${this.queue.driver})`,
    );
  }

  async handle(payload: EmailDeliveryPayload): Promise<{ status: string; provider: string }> {
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    if (payload.attachmentKey) {
      const buf = await this.storage.get(payload.attachmentKey);
      if (buf) {
        attachments.push({
          filename: payload.attachmentName ?? 'certificate.pdf',
          content: buf,
          contentType: 'application/pdf',
        });
      } else {
        this.logger.warn(
          `Attachment ${payload.attachmentKey} missing for delivery ${payload.deliveryId}; sending without it`,
        );
      }
    }

    const result = await this.mail.send({
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      attachments,
      category: payload.category,
      replyTo: this.env.MAIL_REPLY_TO,
      headers: {
        'X-KDC-Tenant': payload.tenantId,
        'X-KDC-Delivery': payload.deliveryId,
      },
    });

    await this.notifications.recordResult(payload.deliveryId, result);

    if (!result.delivered && result.status === 'failed') {
      // Throwing lets the queue apply its retry/backoff policy.
      throw new Error(`Mail transport failed: ${result.error ?? 'unknown error'}`);
    }
    return { status: result.status, provider: result.provider };
  }
}
