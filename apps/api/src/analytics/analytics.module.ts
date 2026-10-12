import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';

/**
 * Analytics HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
