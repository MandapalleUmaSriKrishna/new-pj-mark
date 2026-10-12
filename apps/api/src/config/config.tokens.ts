import type { ConfigWarning, Env } from './env';

export type { ConfigWarning, Env };

export const ENV_CONFIG = Symbol('KDC_ENV_CONFIG');
export const CONFIG_WARNINGS = Symbol('KDC_CONFIG_WARNINGS');

export interface AppConfig {
  env: Env;
  warnings: ConfigWarning[];
}
