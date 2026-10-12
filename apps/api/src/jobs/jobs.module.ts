import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { RealtimeController } from './realtime.controller';

/**
 * Jobs and realtime HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [JobsController, RealtimeController] })
export class JobsModule {}
