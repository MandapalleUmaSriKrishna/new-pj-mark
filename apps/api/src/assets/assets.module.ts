import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';

/**
 * Assets HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [AssetsController] })
export class AssetsModule {}
