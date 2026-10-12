import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';

/**
 * API keys HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [ApiKeysController] })
export class ApiKeysModule {}
