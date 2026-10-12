import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';

/**
 * Webhooks HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [WebhooksController] })
export class WebhooksModule {}
