import { Module } from '@nestjs/common';
import { CertificatesController } from './certificates.controller';

/**
 * Certificates HTTP surface.
 *
 * Providers live in the global `CoreModule`, so this module only declares the
 * controllers - one place to see which routes belong to the feature.
 */
@Module({ controllers: [CertificatesController] })
export class CertificatesModule {}
