import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';

/**
 * Files HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [FilesController] })
export class FilesModule {}
