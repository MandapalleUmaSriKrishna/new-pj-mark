#!/usr/bin/env node
/**
 * Production entrypoint.
 *
 * Boots the HTTP server, validates configuration, logs safe startup metadata
 * (never secrets) and shuts down gracefully on SIGTERM/SIGINT.
 */
import 'dotenv/config';
import http from 'node:http';
import { loadConfig, ConfigurationError } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';
import { createTwilioVerifyProvider } from './services/verify-provider.js';

function boot() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error('\n  Configuration error\n  -------------------');
      console.error(`  ${error.message}`);
      for (const detail of error.details) console.error(`   • ${detail}`);
      console.error('\n  Copy .env.example to .env and fill in the values.\n');
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: config.logLevel });
  const provider = createTwilioVerifyProvider(config, logger);
  const app = createApp({ config, provider, logger });
  const server = http.createServer(app);

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  server.listen(config.port, config.host, () => {
    logger.info('server.started', {
      env: config.env,
      host: config.host,
      port: config.port,
      provider: provider.name,
      providerConfigured: provider.configured,
      authMode: provider.mode,
      otpTtlSeconds: config.otp.ttlSeconds,
      resendCooldownSeconds: config.otp.resendCooldownSeconds,
      allowedCountries: config.otp.allowedCountries.length
        ? config.otp.allowedCountries
        : 'all supported',
    });
    for (const warning of config.warnings) logger.warn('config.warning', { message: warning });
    if (!config.twilio.configured) {
      logger.warn('provider.not_configured', {
        message:
          'SMS sending and verification are disabled. OTP endpoints return HTTP 503 until valid Twilio Verify credentials are set.',
        missing: config.twilio.missingCredentials,
      });
    }
    logger.info('server.ready', { url: `http://${config.host}:${config.port}` });
  });

  server.on('error', (error) => {
    logger.error('server.error', { error });
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server.shutdown', { signal });
    const forceExit = setTimeout(() => {
      logger.error('server.shutdown.forced');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async () => {
      app.locals.close?.();
      logger.info('server.closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandledRejection', { error: reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('process.uncaughtException', { error });
    shutdown('uncaughtException');
  });

  return server;
}

boot();
