import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';

/**
 * Billing HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [BillingController] })
export class BillingModule {}
