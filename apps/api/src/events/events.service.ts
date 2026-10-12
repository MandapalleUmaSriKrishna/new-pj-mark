import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Certificate, CertificateEvent, Template } from '@kdc/shared';
import { EVENT_STATUSES, getPlan } from '@kdc/shared';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import { buildFilter, type FieldOperators } from '../infra/persistence/filter';
import { escapeRegex } from '../common/dto/pagination.dto';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import type { CreateEventInput, ListEventsInput, UpdateEventInput } from './dto';

/**
 * Events (certificate campaigns).
 *
 * An event binds a design to a programme and carries the issuance policy:
 * whether approval is required, whether the certificate email goes out
 * automatically, and the email copy. Certificates snapshot the values they need
 * at issue time, so editing an event never rewrites issued certificates.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly events: Repository<CertificateEvent>;
  private readonly templates: Repository<Template>;
  private readonly certificates: Repository<Certificate>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {
    this.events = store.repository<CertificateEvent>('events');
    this.templates = store.repository<Template>('templates');
    this.certificates = store.repository<Certificate>('certificates');
  }

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    return base.length >= 2 ? base : 'event';
  }

  private async uniqueSlug(
    tenantId: string,
    preferred: string | undefined,
    name: string,
  ): Promise<string> {
    const base = this.slugify(preferred ?? name);
    let candidate = base;
    for (let i = 0; i < 30; i += 1) {
      if (!(await this.events.exists({ tenantId, slug: candidate }))) return candidate;
      candidate = `${base}-${(i + 2).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    }
    throw AppException.conflict('Could not derive a unique event URL; choose one explicitly');
  }

  async list(
    tenantId: string,
    input: Partial<ListEventsInput> = {},
  ): Promise<{ items: EventSummary[]; total: number }> {
    const filter: Record<string, unknown> = { tenantId };
    if (input.status) filter.status = input.status;
    if (input.templateId) filter.templateId = input.templateId;
    if (input.q) {
      const rx: FieldOperators = { $regex: escapeRegex(input.q), $options: 'i' };
      filter.$or = [{ name: rx }, { programmeName: rx }, { description: rx }, { venue: rx }];
    }
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const [rows, total] = await Promise.all([
      this.events.find(buildFilter(filter), {
        sort: { createdAt: -1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
      this.events.count(buildFilter(filter)),
    ]);
    const items = await Promise.all(rows.map((e) => this.summarise(e)));
    return { items, total };
  }

  async get(tenantId: string, eventId: string): Promise<CertificateEvent> {
    const event = await this.events.findById(eventId);
    if (!event || event.tenantId !== tenantId) throw AppException.notFound('Event');
    return event;
  }

  async create(
    tenantId: string,
    input: CreateEventInput,
    actorId: string,
  ): Promise<CertificateEvent> {
    await this.tenants.assertHeadroom(tenantId, 'events');
    const template = await this.templates.findById(input.templateId);
    if (!template || template.tenantId !== tenantId)
      throw AppException.notFound('Certificate design');

    const plan = await this.tenants.planOf(tenantId);
    if (input.requireApproval) this.tenants.assertFeature(plan, 'approvalWorkflows');
    if (input.autoDeliverEmail) this.tenants.assertFeature(plan, 'bulkEmailDelivery');

    const slug = await this.uniqueSlug(tenantId, input.slug, input.name);
    const now = new Date();
    const event: CertificateEvent = {
      id: newId(),
      tenantId,
      name: input.name.trim(),
      slug,
      description: input.description ?? null,
      templateId: template.id,
      status: 'active',
      programmeName: input.programmeName?.trim() || input.name.trim(),
      programmeDescription: input.programmeDescription ?? null,
      date: input.date ?? null,
      venue: input.venue ?? null,
      organiser: input.organiser ?? null,
      requireApproval: input.requireApproval ?? false,
      autoDeliverEmail: input.autoDeliverEmail ?? true,
      emailSubject: input.emailSubject ?? null,
      emailBody: input.emailBody ?? null,
      extraFields: input.extraFields ?? [],
      createdBy: actorId,
      issuedCount: 0,
      revokedCount: 0,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.events.insert(event);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('An event with that URL already exists');
      throw err;
    }
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'event.created',
      'event',
      event.id,
      {
        name: event.name,
        templateId: template.id,
        requireApproval: event.requireApproval,
      },
    );
    this.logger.log(`Event "${event.name}" created in tenant ${tenantId}`);
    return event;
  }

  async update(
    tenantId: string,
    eventId: string,
    input: UpdateEventInput,
    actorId: string,
  ): Promise<CertificateEvent> {
    const existing = await this.get(tenantId, eventId);
    const patch: Record<string, unknown> = {};

    if (input.requireApproval === true && !existing.requireApproval) {
      this.tenants.assertFeature(await this.tenants.planOf(tenantId), 'approvalWorkflows');
    }
    for (const key of [
      'name',
      'description',
      'templateId',
      'programmeName',
      'programmeDescription',
      'date',
      'venue',
      'organiser',
      'requireApproval',
      'autoDeliverEmail',
      'emailSubject',
      'emailBody',
      'extraFields',
      'startsAt',
      'endsAt',
      'status',
    ] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (key === 'templateId') {
        const template = await this.templates.findById(String(value));
        if (!template || template.tenantId !== tenantId)
          throw AppException.notFound('Certificate design');
      }
      if (key === 'status' && !EVENT_STATUSES.includes(value as (typeof EVENT_STATUSES)[number])) {
        throw AppException.validationFailed(`Status must be one of ${EVENT_STATUSES.join(', ')}`);
      }
      if (key === 'name') {
        patch.name = String(value).trim();
        continue;
      }
      patch[key] = value;
    }
    if (input.slug !== undefined)
      patch.slug = await this.uniqueSlug(tenantId, input.slug, existing.name);
    if (Object.keys(patch).length === 0) return existing;

    let updated: CertificateEvent | null;
    try {
      updated = await this.events.updateById(eventId, patch);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('An event with that URL already exists');
      throw err;
    }
    if (!updated) throw AppException.notFound('Event');
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'event.updated',
      'event',
      eventId,
      {
        changed: Object.keys(patch),
      },
    );
    return updated;
  }

  async remove(
    tenantId: string,
    eventId: string,
    actorId: string,
  ): Promise<{ ok: true; archived: boolean }> {
    const event = await this.get(tenantId, eventId);
    const issued = await this.certificates.count({ tenantId, eventId });
    if (issued > 0) {
      // Certificates are permanent records; archive the event instead of
      // deleting it and orphaning them.
      await this.events.updateById(eventId, { status: 'archived' });
      await this.audit.recordFrom(
        { tenantId, userId: actorId, role: 'admin' },
        'event.deleted',
        'event',
        eventId,
        {
          name: event.name,
          outcome: 'archived',
          issued,
        },
        'warning',
      );
      return { ok: true, archived: true };
    }
    await this.events.deleteById(eventId);
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'event.deleted',
      'event',
      eventId,
      {
        name: event.name,
        outcome: 'deleted',
      },
      'warning',
    );
    return { ok: true, archived: false };
  }

  async summarise(event: CertificateEvent): Promise<EventSummary> {
    const [total, issued, pending, revoked, delivered] = await Promise.all([
      this.certificates.count({ tenantId: event.tenantId, eventId: event.id }),
      this.certificates.count({
        tenantId: event.tenantId,
        eventId: event.id,
        status: { $in: ['issued', 'delivered'] },
      }),
      this.certificates.count({
        tenantId: event.tenantId,
        eventId: event.id,
        status: 'pending_approval',
      }),
      this.certificates.count({ tenantId: event.tenantId, eventId: event.id, status: 'revoked' }),
      this.certificates.count({ tenantId: event.tenantId, eventId: event.id, status: 'delivered' }),
    ]);
    const template = await this.templates.findById(event.templateId);
    return {
      id: event.id,
      name: event.name,
      slug: event.slug,
      status: event.status,
      programmeName: event.programmeName,
      date: event.date ? new Date(event.date).toISOString() : null,
      venue: event.venue ?? null,
      templateId: event.templateId,
      templateName: template?.name ?? null,
      requireApproval: event.requireApproval,
      autoDeliverEmail: event.autoDeliverEmail,
      counts: { total, issued, pending, revoked, delivered },
      createdAt: new Date(event.createdAt).toISOString(),
      updatedAt: new Date(event.updatedAt).toISOString(),
    };
  }

  /** Plan-aware limits, surfaced in the UI before the user hits a wall. */
  async limits(tenantId: string): Promise<{
    maxEvents: number;
    maxImportRows: number;
    monthlyCertificateQuota: number;
    plan: string;
  }> {
    const plan = await this.tenants.planOf(tenantId);
    const entitlements = getPlan(plan);
    return {
      plan,
      maxEvents: entitlements.maxEvents,
      maxImportRows: entitlements.maxImportRows,
      monthlyCertificateQuota: entitlements.monthlyCertificateQuota,
    };
  }
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  status: CertificateEvent['status'];
  programmeName: string;
  date: string | null;
  venue: string | null;
  templateId: string;
  templateName: string | null;
  requireApproval: boolean;
  autoDeliverEmail: boolean;
  counts: { total: number; issued: number; pending: number; revoked: number; delivered: number };
  createdAt: string;
  updatedAt: string;
}
