import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { STARTER_DESIGNS } from '@kdc/shared';
import type { Env } from '../config/env';
import { AuthService } from '../auth/auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { TemplatesService } from '../templates/templates.service';
import { EventsService } from '../events/events.service';
import { CertificatesService } from '../certificates/certificates.service';
import { JobsService } from '../jobs/jobs.service';
import { AuditService } from '../audit/audit.service';

const logger = new Logger('Seed');

export interface SeedOptions {
  email: string;
  password: string;
  organisationName?: string;
  slug?: string;
  /** How many demo certificates to issue into the seeded event. */
  certificates?: number;
  /** Seconds to wait for queued renders before giving up. */
  drainTimeoutSeconds?: number;
  force?: boolean;
}

export interface SeedResult {
  seeded: boolean;
  reason?: string;
  tenantId?: string;
  tenantSlug?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  templateCount?: number;
  eventId?: string;
  certificatesIssued?: number;
  verifyUrls?: string[];
}

const DEMO_RECIPIENTS = [
  {
    name: 'Demo Recipient One',
    email: 'demo.recipient.one@example.test',
    title: 'B.Tech Graduate',
    department: 'Computer Science',
    roll: 'DEMO-0001',
    grade: '9.4 CGPA',
  },
  {
    name: 'Demo Recipient Two',
    email: 'demo.recipient.two@example.test',
    title: 'B.Tech Graduate',
    department: 'Electronics',
    roll: 'DEMO-0002',
    grade: '8.9 CGPA',
  },
  {
    name: 'Demo Recipient Three',
    email: 'demo.recipient.three@example.test',
    title: 'B.Tech Graduate',
    department: 'Mechanical',
    roll: 'DEMO-0003',
    grade: '9.1 CGPA',
  },
  {
    name: 'Demo Recipient Four',
    email: 'demo.recipient.four@example.test',
    title: 'Workshop Participant',
    department: 'Robotics',
    roll: 'DEMO-0004',
    grade: 'Excellent',
  },
  {
    name: 'Demo Recipient Five',
    email: 'demo.recipient.five@example.test',
    title: 'Workshop Participant',
    department: 'Robotics',
    roll: 'DEMO-0005',
    grade: 'Excellent',
  },
];

/**
 * Idempotent demo seed.
 *
 * Everything it creates goes through the same services the HTTP API uses, so a
 * seeded tenant is indistinguishable from a real one - including its starter
 * designs, subscription row, wrapped data-encryption key and audit trail. The
 * organisation is named "Demo Organisation" and recipients are called
 * "Demo Recipient N" at `example.test` (a reserved, non-deliverable domain) so
 * nobody can mistake seeded rows for live data.
 */
export async function seed(
  app: INestApplicationContext,
  env: Env,
  options: Partial<SeedOptions> = {},
): Promise<SeedResult> {
  const email = (options.email ?? env.SEED_DEMO_EMAIL).toLowerCase();
  const password = options.password ?? env.SEED_DEMO_PASSWORD;
  const organisationName = options.organisationName ?? 'Demo Organisation';
  // `demo` is a reserved slug (see TenantsService.RESERVED_SLUGS), so the seed
  // uses `demo-org` and the idempotency check below matches what is created.
  const slug = options.slug ?? 'demo-org';
  const certificateCount = Math.max(
    0,
    Math.min(DEMO_RECIPIENTS.length, options.certificates ?? DEMO_RECIPIENTS.length),
  );

  const tenants = app.get(TenantsService);
  const auth = app.get(AuthService);
  const templates = app.get(TemplatesService);
  const events = app.get(EventsService);
  const certificates = app.get(CertificatesService);
  const jobs = app.get(JobsService);
  const audit = app.get(AuditService);

  const existing = await tenants.findBySlug(slug);
  if (existing && !options.force) {
    logger.log(`Organisation "${slug}" already exists (${existing.id}); nothing to seed`);
    return {
      seeded: false,
      reason: 'already_exists',
      tenantId: existing.id,
      tenantSlug: existing.slug,
    };
  }

  logger.log(`Seeding organisation "${organisationName}" (${slug}) with owner ${email}`);
  const result = await auth.register(
    {
      name: 'Demo Administrator',
      email,
      password,
      locale: 'en',
      organisation: { name: organisationName, slug, type: 'college', country: 'IN' },
    },
    { requestId: 'seed', ip: '127.0.0.1', userAgent: 'kdc-seed/1.0' },
  );
  const tenantSummary = result.tenants.find((t) => t.slug === slug) ?? result.tenants[0];
  if (!tenantSummary) throw new Error('Registration did not produce an organisation');
  const tenantId = tenantSummary.id;

  const ownedTemplates = await templates.list(tenantId, {});
  logger.log(`Designs available to the demo organisation: ${ownedTemplates.length}`);

  const preferred = STARTER_DESIGNS[0]?.name;
  const starter =
    ownedTemplates.find((t) => t.isStarter && (preferred ? t.name === preferred : true)) ??
    ownedTemplates.find((t) => t.isStarter) ??
    ownedTemplates[0];
  if (!starter) throw new Error('No template was provisioned for the demo organisation');

  const event = await events.create(
    tenantId,
    {
      name: 'Demo Convocation 2026',
      description: 'Seeded example event. Delete it or issue into your own events.',
      templateId: starter.id,
      programmeName: 'Bachelor of Technology - Demo Convocation',
      programmeDescription: 'Awarded for the successful completion of the demonstration programme.',
      date: new Date(),
      venue: 'Demo Campus Auditorium',
      organiser: organisationName,
      requireApproval: false,
      autoDeliverEmail: false,
      emailSubject: null,
      emailBody: null,
      startsAt: null,
      endsAt: null,
      extraFields: [],
    },
    result.user.id,
  );
  logger.log(`Demo event created: ${event.name} (${event.id})`);

  const verifyUrls: string[] = [];
  let issued = 0;
  for (const recipient of DEMO_RECIPIENTS.slice(0, certificateCount)) {
    const certificate = await certificates.issueOne(
      tenantId,
      {
        eventId: event.id,
        recipient: {
          name: recipient.name,
          email: recipient.email,
          title: recipient.title,
          department: recipient.department,
          roll_number: recipient.roll,
          grade: recipient.grade,
        },
        sendEmail: false,
      },
      { actorId: result.user.id, requestId: 'seed', ip: '127.0.0.1', userAgent: 'kdc-seed/1.0' },
    );
    verifyUrls.push(certificates.verifyUrlFor(certificate.serial));
    issued += 1;
  }

  if (issued > 0) {
    await drainQueue(jobs, options.drainTimeoutSeconds ?? 30);
  }

  await audit.record({
    tenantId,
    actorId: result.user.id,
    actorRole: 'owner',
    action: 'tenant.created',
    entityType: 'tenant',
    entityId: tenantId,
    payload: { seeded: true, certificates: issued, note: 'Created by the demo seed script' },
    severity: 'info',
  });
  void env;

  logger.log(`Seed complete: ${issued} demo certificate(s) issued into "${event.name}"`);
  return {
    seeded: true,
    tenantId,
    tenantSlug: tenantSummary.slug,
    ownerEmail: email,
    ownerPassword: password,
    templateCount: ownedTemplates.length,
    eventId: event.id,
    certificatesIssued: issued,
    verifyUrls,
  };
}

/** Waits until the queue reports no pending or active jobs, or the timeout hits. */
async function drainQueue(jobs: JobsService, timeoutSeconds: number): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const counts = await jobs.queueCounts();
    const pending = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
    if (pending === 0) {
      logger.log(
        `Queue drained (completed=${counts.completed ?? 0}, failed=${counts.failed ?? 0})`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  logger.warn(`Queue did not drain within ${timeoutSeconds}s; PDF renders may still be in flight`);
}

/** Called from `main.ts` when SEED_DEMO_DATA=true. */
export async function runSeedIfRequested(app: INestApplicationContext, env: Env): Promise<void> {
  if (!env.SEED_DEMO_DATA) return;
  try {
    const result = await seed(app, env);
    if (result.seeded) {
      logger.warn('='.repeat(72));
      logger.warn(
        'DEMO DATA SEEDED - this organisation and its certificates are examples, not live records',
      );
      logger.warn(`  Sign in:  ${result.ownerEmail} / ${result.ownerPassword}`);
      logger.warn(`  Tenant:   ${result.tenantSlug} (${result.tenantId})`);
      logger.warn(`  Verify:   ${result.verifyUrls?.[0] ?? '(none)'}`);
      logger.warn('  Turn SEED_DEMO_DATA off once you have finished exploring.');
      logger.warn('='.repeat(72));
    }
  } catch (err) {
    // A seed failure must not take the API down: the service is still usable.
    logger.error(`Seeding failed: ${(err as Error).message}`);
  }
}

/** `npm run seed` entry point. */
async function main(): Promise<void> {
  // Loaded lazily so importing this module for `runSeedIfRequested` does not
  // pull the whole application graph into every process.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { loadEnv } = await import('../config/env');
  const { env } = loadEnv();

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  const force = process.argv.includes('--force');
  const countArg = process.argv.find((a) => a.startsWith('--certificates='));
  const certificates = countArg ? Number.parseInt(countArg.split('=')[1] ?? '', 10) : undefined;

  try {
    const result = await seed(app, env, {
      force,
      ...(Number.isFinite(certificates) ? { certificates } : {}),
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.seeded || result.reason === 'already_exists' ? 0 : 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
