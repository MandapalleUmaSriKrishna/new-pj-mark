import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';

/**
 * Events HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [EventsController] })
export class EventsModule {}
