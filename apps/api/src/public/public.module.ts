import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';

/**
 * Public HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [PublicController] })
export class PublicModule {}
