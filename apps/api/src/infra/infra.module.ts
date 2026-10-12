import { Global, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CONFIG_WARNINGS, ENV_CONFIG } from '../config/config.tokens';
import type { ConfigWarning, Env } from '../config/env';
import { CACHE_PORT, type CachePort } from './cache/cache.port';
import { MemoryCache } from './cache/memory.cache';
import { RedisCache } from './cache/redis.cache';
import { CryptoService } from './crypto/crypto.service';
import { EVENT_BUS_PORT, type EventBusPort } from './events/eventbus.port';
import { MemoryEventBus } from './events/memory.eventbus';
import { RedisEventBus } from './events/redis.eventbus';
import { MAIL_PORT, type MailPort } from './mail/mail.port';
import { DisabledMail } from './mail/disabled.mail';
import { LogMail } from './mail/log.mail';
import { SmtpMail } from './mail/smtp.mail';
import {
  DATA_STORE,
  type CollectionName,
  type DataStore,
  type Repository,
} from './persistence/repository';
import { MemoryDataStore } from './persistence/memory.store';
import { MongoDataStore } from './persistence/mongo.store';
import { QUEUE_PORT, type QueuePort } from './queue/queue.port';
import { MemoryQueue } from './queue/memory.queue';
import { BullQueue } from './queue/bullmq.queue';
import { LocalStorage } from './storage/local.storage';
import { S3Storage } from './storage/s3.storage';
import { STORAGE_PORT, type StoragePort } from './storage/storage.port';
import type { BaseEntity } from '@kdc/shared';

/**
 * Infrastructure composition root.
 *
 * Every external system sits behind a port, and the concrete adapter is chosen
 * from the environment at boot. A single message logs which adapters are live so
 * an operator can never be unsure whether they are talking to real MongoDB and
 * Redis or to in-process stand-ins.
 */
@Global()
@Module({
  providers: [
    CryptoService,
    {
      provide: DATA_STORE,
      useFactory: async (env: Env, warnings: ConfigWarning[]): Promise<DataStore> => {
        const logger = new Logger('DataStore');
        if (env.DATA_DRIVER === 'mongo') {
          const store = new MongoDataStore(env.MONGODB_URI, env.MONGODB_DB);
          await store.connect();
          return store;
        }
        if (env.NODE_ENV === 'production') {
          const acknowledged = process.env.ALLOW_MEMORY_STORE_IN_PRODUCTION === 'true';
          if (!acknowledged) {
            throw new Error(
              'Refusing to start in production with DATA_DRIVER=memory (all data would be lost on restart). ' +
                'Set DATA_DRIVER=mongo + MONGODB_URI, or set ALLOW_MEMORY_STORE_IN_PRODUCTION=true to override explicitly.',
            );
          }
          logger.warn(
            'DATA_DRIVER=memory in production was explicitly acknowledged - data will NOT persist.',
          );
        }
        void warnings;
        return new MemoryDataStore();
      },
      inject: [ENV_CONFIG, CONFIG_WARNINGS],
    },
    {
      provide: QUEUE_PORT,
      useFactory: (env: Env): QueuePort => {
        if (env.QUEUE_DRIVER === 'bullmq') return new BullQueue(env.REDIS_URL, env.QUEUE_PREFIX);
        return new MemoryQueue();
      },
      inject: [ENV_CONFIG],
    },
    {
      provide: CACHE_PORT,
      useFactory: (env: Env): CachePort => {
        if (env.CACHE_DRIVER === 'redis')
          return new RedisCache(env.REDIS_URL, env.QUEUE_PREFIX, env.REDIS_MAX_RETRIES);
        return new MemoryCache();
      },
      inject: [ENV_CONFIG],
    },
    {
      provide: EVENT_BUS_PORT,
      useFactory: (env: Env): EventBusPort => {
        if (env.EVENT_BUS_DRIVER === 'redis')
          return new RedisEventBus(env.REDIS_URL, env.QUEUE_PREFIX);
        return new MemoryEventBus();
      },
      inject: [ENV_CONFIG],
    },
    {
      provide: MAIL_PORT,
      useFactory: (env: Env): MailPort => {
        if (env.MAIL_DRIVER === 'smtp' && env.SMTP_HOST) {
          return new SmtpMail({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            user: env.SMTP_USER,
            password: env.SMTP_PASSWORD,
            from: env.MAIL_FROM,
            replyTo: env.MAIL_REPLY_TO,
          });
        }
        if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
          new Logger('Mail').error(
            'MAIL_DRIVER=smtp but SMTP_HOST is unset - falling back to the log driver.',
          );
          return new LogMail(env.MAIL_LOG_DIR);
        }
        if (env.MAIL_DRIVER === 'disabled') return new DisabledMail();
        return new LogMail(env.MAIL_LOG_DIR);
      },
      inject: [ENV_CONFIG],
    },
    {
      provide: STORAGE_PORT,
      useFactory: (env: Env): StoragePort => {
        if (env.STORAGE_DRIVER === 's3') {
          if (!env.S3_BUCKET || !env.S3_REGION) {
            throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET and S3_REGION.');
          }
          return new S3Storage({
            bucket: env.S3_BUCKET,
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
          });
        }
        return new LocalStorage(env.STORAGE_LOCAL_DIR, env.ENCRYPTION_MASTER_KEY, env.API_URL);
      },
      inject: [ENV_CONFIG],
    },
  ],
  exports: [
    CryptoService,
    DATA_STORE,
    QUEUE_PORT,
    CACHE_PORT,
    EVENT_BUS_PORT,
    MAIL_PORT,
    STORAGE_PORT,
  ],
})
export class InfraModule implements OnApplicationShutdown {
  private readonly logger = new Logger('Infra');

  constructor(
    @Inject(DATA_STORE) private readonly dataStore: DataStore,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {
    this.logger.log(
      `adapters -> data:${dataStore.driver} queue:${queue.driver} cache:${cache.driver} ` +
        `events:${bus.driver} mail:${mail.driver} storage:${storage.driver}`,
    );
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutting down infrastructure adapters (${signal ?? 'signal'})`);
    await Promise.allSettled([
      this.queue.shutdown(),
      this.cache.close(),
      this.bus.close(),
      this.mail.close(),
      this.dataStore.close(),
    ]);
  }
}

/**
 * Typed accessor used by services instead of injecting a symbol everywhere.
 * Keeps tenant scoping visible at every call site.
 */
export function repo<T extends BaseEntity>(store: DataStore, name: CollectionName): Repository<T> {
  return store.repository<T>(name);
}
