import 'reflect-metadata';
import { Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadEnv, type ConfigWarning, type Env } from './config/env';
import { SecurityMiddleware } from './common/middleware/security.middleware';
import { runSeedIfRequested } from './database/seed';

const logger = new Logger('Bootstrap');

function logLevels(level: Env['LOG_LEVEL']): LogLevel[] {
  const order: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  const index = order.indexOf(level);
  return index < 0 ? order.slice(0, 4) : order.slice(0, index + 1);
}

function printWarnings(warnings: ConfigWarning[]): void {
  const critical = warnings.filter((w) => w.severity === 'critical');
  const warn = warnings.filter((w) => w.severity === 'warning');
  const info = warnings.filter((w) => w.severity === 'info');
  if (warnings.length === 0) {
    logger.log('Configuration check passed with no warnings');
    return;
  }
  logger.warn(
    `Configuration check: ${critical.length} critical, ${warn.length} warning, ${info.length} info`,
  );
  for (const w of [...critical, ...warn, ...info]) {
    const line = `[${w.severity.toUpperCase()}] ${w.area}: ${w.message}${w.remedy ? ` -> ${w.remedy}` : ''}`;
    if (w.severity === 'critical') logger.error(line);
    else if (w.severity === 'warning') logger.warn(line);
    else logger.log(line);
  }
}

function setupSwagger(app: NestExpressApplication, env: Env): void {
  if (!env.ENABLE_SWAGGER) {
    logger.log('Swagger UI disabled (ENABLE_SWAGGER=false)');
    return;
  }
  const config = new DocumentBuilder()
    .setTitle('Krishna Digital Certificate API')
    .setDescription(
      [
        'Multi-tenant certificate issuance, verification and lifecycle API.',
        '',
        '## Authentication',
        'Send `Authorization: Bearer <accessToken>` (from `/auth/login`) or the `kdc_access` HttpOnly cookie.',
        'Cookie-authenticated state changes also require the `x-kdc-csrf` header matching the `kdc_csrf` cookie.',
        'Routes marked *key-accessible* also accept `Authorization: Bearer kdc_...` or `X-API-Key: kdc_...`.',
        '',
        '## Errors',
        'Every error is `{ statusCode, error, message, details?, requestId }`. `error` is a stable machine code.',
        '',
        '## Tenant scoping',
        'All organisation data lives under `/tenants/:tenantId/...`. A tenant you are not a member of returns 404.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addCookieAuth('kdc_access', { type: 'apiKey', in: 'cookie' }, 'cookie')
    .addServer(env.API_URL.replace(/\/$/, ''))
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
  const path = `${env.API_PREFIX}/docs`;

  // Basic auth in front of the docs, but only when credentials are supplied;
  // otherwise the docs would be world-readable in production.
  if (env.SWAGGER_USER && env.SWAGGER_PASSWORD) {
    const expected = `${env.SWAGGER_USER}:${env.SWAGGER_PASSWORD}`;
    app.use(
      `/${path}`,
      (
        req: { headers: { authorization?: string } },
        res: {
          setHeader: (k: string, v: string) => void;
          status: (n: number) => { end: (b?: string) => void };
        },
        next: () => void,
      ) => {
        const header = req.headers.authorization ?? '';
        const supplied = header.startsWith('Basic ')
          ? Buffer.from(header.slice(6), 'base64').toString('utf8')
          : '';
        if (supplied !== expected) {
          res.setHeader('WWW-Authenticate', 'Basic realm="KDC API docs"');
          res.status(401).end('Authentication required');
          return;
        }
        next();
      },
    );
    logger.log(`Swagger UI protected with HTTP basic auth (user "${env.SWAGGER_USER}")`);
  } else if (env.NODE_ENV === 'production') {
    logger.warn(
      'Swagger UI is publicly reachable: set SWAGGER_USER and SWAGGER_PASSWORD, or ENABLE_SWAGGER=false',
    );
  }

  SwaggerModule.setup(path, app, document, {
    jsonDocumentUrl: `${path}/json`,
    yamlDocumentUrl: `${path}/yaml`,
    customSiteTitle: 'Krishna Digital Certificate API',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
    },
  });
  logger.log(`API documentation: /${path} (OpenAPI JSON at /${path}/json)`);
}

async function bootstrap(): Promise<void> {
  // `loadEnv` throws with a per-key report if the environment is invalid, so a
  // misconfigured deployment fails at boot instead of limping along.
  const { env, warnings } = loadEnv();
  Logger.overrideLogger(logLevels(env.LOG_LEVEL));

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
    abortOnError: true,
  });

  // Security headers, cookie parsing and compression run before anything else.
  const security = new SecurityMiddleware(env);
  app.use(security.use.bind(security));

  if (env.TRUST_PROXY) {
    // Behind a load balancer or the preview proxy, `req.ip` and the cookie
    // `secure` flag both depend on trusting exactly one hop.
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');
  app.setGlobalPrefix(env.API_PREFIX, { exclude: [''] });
  app.useBodyParser('json', { limit: '4mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  const origins = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 && origins[0] !== '*' ? origins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-KDC-CSRF',
      'X-Request-Id',
      'Accept',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
      'X-KDC-Serial',
      'X-KDC-SHA256',
    ],
    maxAge: 86_400,
  });

  // There is deliberately no global ValidationPipe: every route validates its
  // body with the shared Zod schemas through `ZodValidationPipe`, so the browser
  // and the API enforce identical rules. Nest's ValidationPipe would pull in
  // class-validator and a second, divergent set of constraints.

  app.enableShutdownHooks();
  setupSwagger(app, env);

  printWarnings(warnings);

  await app.listen(env.PORT, env.HOST);
  const url = `http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`;
  logger.log(`API listening on ${url} (prefix /${env.API_PREFIX}, env=${env.NODE_ENV})`);
  logger.log(`Health: ${url}/${env.API_PREFIX}/health`);

  if (env.SEED_DEMO_DATA) await runSeedIfRequested(app, env);

  const shutdown = async (signal: string): Promise<void> => {
    logger.warn(`${signal} received; draining (timeout ${env.SHUTDOWN_TIMEOUT_MS}ms)`);
    const timer = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      await app.close();
      logger.log('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error(`Shutdown failed: ${(err as Error).message}`);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
    // Exit so the orchestrator restarts a known-good process rather than
    // continuing in an undefined state.
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start the API:', err);
  process.exit(1);
});
