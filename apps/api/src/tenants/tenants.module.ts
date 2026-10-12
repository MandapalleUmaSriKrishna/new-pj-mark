import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';

/**
 * Organisations HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [TenantsController] })
export class TenantsModule {}
