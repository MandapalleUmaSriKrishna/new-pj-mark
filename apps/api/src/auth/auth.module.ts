import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';

/**
 * Authentication HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [AuthController] })
export class AuthModule {}
