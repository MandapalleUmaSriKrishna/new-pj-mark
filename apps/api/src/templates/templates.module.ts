import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';

/**
 * Designs HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [TemplatesController] })
export class TemplatesModule {}
