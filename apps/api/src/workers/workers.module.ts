import { Module } from '@nestjs/common';
import { MailProcessor } from '../processors/mail.processor';
import { PdfProcessor } from '../processors/pdf.processor';
import { IssuanceProcessor } from '../processors/issuance.processor';
import { WebhookProcessor } from '../processors/webhook.processor';

/**
 * Background workers.
 *
 * Each processor registers its queue handler in `onModuleInit`, so importing
 * this module is what makes bulk issuance, PDF rendering, email delivery and
 * webhook retries actually run. Every processor is idempotent (jobs carry a
 * dedupe key), so the same image can also be started as a worker-only fleet.
 */
@Module({ providers: [MailProcessor, PdfProcessor, IssuanceProcessor, WebhookProcessor] })
export class WorkersModule {}
