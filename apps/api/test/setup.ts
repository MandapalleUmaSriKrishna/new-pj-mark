import 'reflect-metadata';

/**
 * Test-suite global setup.
 *
 * The suite runs against the in-process adapters (memory data store, memory
 * queue, log mailer, local storage) so it needs no MongoDB, Redis or SMTP
 * server. Every value below is a TEST value; none of them are production
 * secrets and nothing here should be copied into a deployment.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DATA_DRIVER = 'memory';
process.env.QUEUE_DRIVER = 'memory';
process.env.CACHE_DRIVER = 'memory';
process.env.MAIL_DRIVER = 'log';
process.env.STORAGE_DRIVER = 'local';
process.env.EVENT_BUS_DRIVER = 'memory';
process.env.STORAGE_LOCAL_DIR = './data/test-storage';
process.env.MAIL_LOG_DIR = './data/test-mail';
process.env.ENCRYPTION_MASTER_KEY = 'test-master-key-do-not-use-in-prod-0000000000';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod-00000000';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod-0000000';
process.env.SESSION_COOKIE_SECRET = 'test-cookie-secret-do-not-use-in-prod-0000000';
process.env.WEBHOOK_SIGNING_FALLBACK_SECRET = 'test-webhook-secret-do-not-use-in-prod-00';
process.env.APP_URL = 'http://localhost:3000';
process.env.API_URL = 'http://localhost:4000';
process.env.PUBLIC_VERIFY_BASE_URL = 'http://localhost:3000';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';
