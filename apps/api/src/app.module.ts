import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { InfraModule } from './infra/infra.module';
import { CoreModule } from './core/core.module';
import { WorkersModule } from './workers/workers.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { MembersModule } from './members/members.module';
import { TemplatesModule } from './templates/templates.module';
import { EventsModule } from './events/events.module';
import { CertificatesModule } from './certificates/certificates.module';
import { ImportsModule } from './imports/imports.module';
import { AssetsModule } from './assets/assets.module';
import { AuditModule } from './audit/audit.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ApiKeysModule } from './apikeys/api-keys.module';
import { JobsModule } from './jobs/jobs.module';
import { BillingModule } from './billing/billing.module';
import { HealthModule } from './health/health.module';
import { FilesModule } from './files/files.module';
import { PublicModule } from './public/public.module';
import { AuthContextGuard } from './common/guards/auth-context.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Application composition root.
 *
 * Guard order matters and is fixed here:
 *   1. `AuthContextGuard` resolves WHO is calling and WHICH tenant they are
 *      acting in (404, not 403, for a tenant they do not belong to);
 *   2. `CsrfGuard` rejects cross-site state changes made with cookie credentials;
 *   3. `RateLimitGuard` throttles before any expensive work happens;
 *   4. `PermissionsGuard` enforces the role the caller holds INSIDE that tenant.
 */
@Module({
  imports: [
    ConfigModule,
    InfraModule,
    CoreModule,
    WorkersModule,
    AuthModule,
    TenantsModule,
    MembersModule,
    TemplatesModule,
    EventsModule,
    CertificatesModule,
    ImportsModule,
    AssetsModule,
    AuditModule,
    AnalyticsModule,
    WebhooksModule,
    ApiKeysModule,
    JobsModule,
    BillingModule,
    HealthModule,
    FilesModule,
    PublicModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AuthContextGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
