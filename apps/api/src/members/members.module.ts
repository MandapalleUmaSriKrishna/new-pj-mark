import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';

/**
 * Teams HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [MembersController] })
export class MembersModule {}
