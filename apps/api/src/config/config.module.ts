import { Global, Module } from '@nestjs/common';
import { CONFIG_WARNINGS, ENV_CONFIG } from './config.tokens';
import { loadEnv } from './env';

/**
 * Loads and validates the environment exactly once, then exposes the parsed
 * config and its capability warnings to the whole application.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV_CONFIG,
      useFactory: () => loadEnv().env,
    },
    {
      provide: CONFIG_WARNINGS,
      useFactory: () => loadEnv().warnings,
    },
  ],
  exports: [ENV_CONFIG, CONFIG_WARNINGS],
})
export class ConfigModule {}
