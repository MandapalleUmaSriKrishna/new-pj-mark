import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ENV_CONFIG, CONFIG_WARNINGS, type Env } from '../config/config.tokens';
import type { ConfigWarning } from '../config/env';
import { googleOAuthConfigured, smtpConfigured, s3Configured } from '../config/env';
import { DATA_STORE, type DataStore } from '../infra/persistence/repository';
import { QUEUE_PORT, type QueuePort } from '../infra/queue/queue.port';
import { CACHE_PORT, type CachePort } from '../infra/cache/cache.port';
import { EVENT_BUS_PORT, type EventBusPort } from '../infra/events/eventbus.port';
import { STORAGE_PORT, type StoragePort } from '../infra/storage/storage.port';
import { MAIL_PORT, type MailPort } from '../infra/mail/mail.port';
import { Public } from '../common/decorators/permissions.decorator';

export interface ComponentHealth {
  status: 'up' | 'degraded' | 'down';
  driver: string;
  detail?: string;
  latencyMs?: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, ComponentHealth>;
  capabilities: {
    googleOAuth: boolean;
    smtp: boolean;
    objectStorage: boolean;
    customDomains: boolean;
    payments: boolean;
    metrics: boolean;
    swagger: boolean;
    realtime: 'sse';
  };
  /** Honest report of what is not configured in this deployment. */
  warnings: ConfigWarning[];
}

const SERVICE_NAME = 'krishna-digital-certificate-api';
const VERSION = process.env.npm_package_version ?? '1.0.0';

/**
 * Liveness, readiness and a capability report.
 *
 * `/health` always answers 200 while the process is alive. `/health/ready`
 * answers 503 when a dependency the request path needs is down, so a load
 * balancer can stop sending traffic without killing the container that is
 * still draining work. The capability block tells an operator exactly which
 * integrations are live and which are not, so nothing has to be guessed at.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(ENV_CONFIG) private readonly env: Env,
    @Inject(CONFIG_WARNINGS) private readonly warnings: ConfigWarning[],
    @Inject(DATA_STORE) private readonly store: DataStore,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and dependency report' })
  async health(): Promise<HealthReport> {
    return this.build(false);
  }

  @Public()
  @Get('ready')
  @HttpCode(200)
  @ApiOperation({ summary: 'Readiness probe; 503 when a required dependency is down' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.build(true);
    if (report.status === 'down') {
      res.status(503);
    } else if (report.status === 'degraded') {
      res.status(200);
    }
    return report;
  }

  @Public()
  @Get('live')
  @HttpCode(200)
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000) };
  }

  private async build(strict: boolean): Promise<HealthReport> {
    const [storeHealth, cacheHealth, busHealth, storageHealth, mailHealth, queueHealth] =
      await Promise.all([
        probe('database', this.store.driver, () => this.store.ping()),
        probe('cache', this.cache.driver, () => this.cache.ping()),
        probe('realtime', this.bus.driver, () => this.bus.ping()),
        probe('storage', this.storage.driver, () => this.storage.ping()),
        probe('mail', this.mail.driver, () => this.mail.verify()),
        probe('queue', this.queue.driver, async () => {
          await this.queue.counts();
          return { ok: true };
        }),
      ]);
    const components = {
      database: storeHealth,
      cache: cacheHealth,
      realtime: busHealth,
      storage: storageHealth,
      mail: mailHealth,
      queue: queueHealth,
    };

    // Memory-backed drivers are fine for development but not for production:
    // report them as degraded so a mis-set env var shows up on the dashboard
    // instead of silently losing data on restart.
    const nonProductionDriverDowngrade =
      this.env.NODE_ENV === 'production' &&
      (storeHealth.driver === 'memory' ||
        queueHealth.driver === 'memory' ||
        cacheHealth.driver === 'memory');

    let status: HealthReport['status'] = 'ok';
    const hardDown = [storeHealth, queueHealth, storageHealth].some((c) => c.status === 'down');
    if (hardDown || (strict && storeHealth.status === 'down')) status = 'down';
    else if (
      nonProductionDriverDowngrade ||
      Object.values(components).some((c) => c.status === 'degraded') ||
      this.warnings.some((w) => w.severity === 'critical')
    ) {
      status = 'degraded';
    }

    return {
      status,
      service: SERVICE_NAME,
      version: VERSION,
      environment: this.env.NODE_ENV,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      components,
      capabilities: {
        googleOAuth: googleOAuthConfigured(this.env),
        smtp: smtpConfigured(this.env),
        objectStorage: s3Configured(this.env),
        customDomains: this.env.CUSTOM_DOMAINS_ENABLED,
        payments: this.env.BILLING_PROVIDER === 'stripe' && Boolean(this.env.STRIPE_SECRET_KEY),
        metrics: this.env.ENABLE_METRICS,
        swagger: this.env.ENABLE_SWAGGER,
        realtime: 'sse',
      },
      warnings: this.warnings,
    };
  }
}

async function probe(
  _name: string,
  driver: string,
  check: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<ComponentHealth> {
  const started = process.hrtime.bigint();
  try {
    const result = await check();
    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      status: result.ok ? 'up' : 'down',
      driver,
      detail: result.detail,
      latencyMs: Math.round(latencyMs * 10) / 10,
    };
  } catch (err) {
    return { status: 'down', driver, detail: (err as Error).message };
  }
}
