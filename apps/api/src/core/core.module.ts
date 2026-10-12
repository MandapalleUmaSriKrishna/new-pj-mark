import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CryptoService } from '../infra/crypto/crypto.service';
import { TenantKeysService } from '../common/context/tenant-keys.service';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from '../auth/token.service';
import { AuthService } from '../auth/auth.service';
import { GoogleOAuthService } from '../auth/google-oauth.service';
import { QrService } from '../pdf/qr.service';
import { PdfService } from '../pdf/pdf.service';
import { AssetsService } from '../assets/assets.service';
import { TemplatesService } from '../templates/templates.service';
import { EventsService } from '../events/events.service';
import { CertificatesService } from '../certificates/certificates.service';
import { ImportsService } from '../imports/imports.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ApiKeysService } from '../apikeys/api-keys.service';
import { JobsService } from '../jobs/jobs.service';
import { MembersService } from '../members/members.service';
import { BillingService } from '../billing/billing.service';

const SERVICES = [
  CryptoService,
  TenantKeysService,
  AuditService,
  TenantsService,
  NotificationsService,
  TokenService,
  AuthService,
  GoogleOAuthService,
  QrService,
  PdfService,
  AssetsService,
  TemplatesService,
  EventsService,
  CertificatesService,
  ImportsService,
  WebhooksService,
  AnalyticsService,
  ApiKeysService,
  JobsService,
  MembersService,
  BillingService,
];

/**
 * Domain services, shared across every feature module.
 *
 * `@Global` is deliberate here: the services form one dependency graph (a
 * certificate needs its tenant's key, the audit trail, the asset store, the PDF
 * renderer and the queue), and re-declaring that graph in seventeen feature
 * modules would only add places for it to drift. Controllers live in their own
 * modules so the HTTP surface stays organised by feature.
 */
@Global()
@Module({
  // `JwtModule` is registered without a global secret on purpose: TokenService
  // signs and verifies with an explicit secret, algorithm and TTL per call, so
  // the access and refresh tokens can never be confused with each other.
  imports: [JwtModule.register({})],
  providers: SERVICES,
  exports: [...SERVICES, JwtModule],
})
export class CoreModule {}
