import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';

/**
 * Audit log HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [AuditController] })
export class AuditModule {}
