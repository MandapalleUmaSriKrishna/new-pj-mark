import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CertificateEvent, Template, TemplateDoc } from '@kdc/shared';
import { STARTER_DESIGNS, emptyTemplateDoc, safeParseTemplateDoc } from '@kdc/shared';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import { escapeRegex } from '../common/dto/pagination.dto';
import { buildFilter, type FieldOperators } from '../infra/persistence/filter';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import type {
  CreateTemplateInput,
  DuplicateTemplateInput,
  ListTemplatesInput,
  UpdateTemplateInput,
} from './dto';

/**
 * Certificate design CRUD.
 *
 * A template document is validated with the shared Zod schema on every write, so
 * an invalid design can never be persisted and later break the renderer.
 * `version` is incremented on each document change; issued certificates keep the
 * document they were rendered from, which is why a template edit never silently
 * rewrites history.
 */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private readonly templates: Repository<Template>;
  private readonly events: Repository<CertificateEvent>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {
    this.templates = store.repository<Template>('templates');
    this.events = store.repository<CertificateEvent>('events');
  }

  async list(tenantId: string, input: ListTemplatesInput = {}): Promise<Template[]> {
    const filter: Record<string, unknown> = { tenantId };
    if (input.category) filter.category = input.category;
    if (input.includeStarters === false) filter.isStarter = false;
    if (input.q) {
      const rx: FieldOperators = { $regex: escapeRegex(input.q), $options: 'i' };
      filter.$or = [{ name: rx }, { description: rx }, { category: rx }];
    }
    return this.templates.find(buildFilter(filter), { sort: { createdAt: -1 }, limit: 500 });
  }

  async get(tenantId: string, templateId: string): Promise<Template> {
    const template = await this.templates.findById(templateId);
    if (!template || template.tenantId !== tenantId) throw AppException.notFound('Template');
    return template;
  }

  async create(tenantId: string, input: CreateTemplateInput, actorId: string): Promise<Template> {
    await this.tenants.assertHeadroom(tenantId, 'templates');

    let doc: TemplateDoc;
    if (input.doc) {
      const parsed = safeParseTemplateDoc(input.doc);
      if (!parsed.success) throw AppException.templateInvalid(parsed.error.issues);
      doc = parsed.data;
    } else {
      const starter = STARTER_DESIGNS.find((d) => d.key === input.starterKey);
      doc = starter ? starter.build() : emptyTemplateDoc('a4_landscape');
    }

    const now = new Date();
    const template: Template = {
      id: newId(),
      tenantId,
      name: input.name.trim(),
      description: input.description ?? null,
      doc,
      thumbnailAssetId: null,
      category: input.category ?? 'General',
      isStarter: false,
      version: 1,
      createdBy: actorId,
      locked: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.templates.insert(template);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('A template with that name already exists');
      throw err;
    }
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'template.created',
      'template',
      template.id,
      { name: template.name, elements: doc.elements.length, starterKey: input.starterKey ?? null },
    );
    this.logger.log(`Template "${template.name}" created in tenant ${tenantId}`);
    return template;
  }

  async update(
    tenantId: string,
    templateId: string,
    input: UpdateTemplateInput,
    actorId: string,
  ): Promise<Template> {
    const existing = await this.get(tenantId, templateId);
    if (existing.locked)
      throw AppException.forbidden('This template is locked; duplicate it to make changes');

    const patch: Record<string, unknown> = {};
    let docChanged = false;
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.category !== undefined) patch.category = input.category;
    if (input.thumbnailAssetId !== undefined) patch.thumbnailAssetId = input.thumbnailAssetId;
    if (input.locked !== undefined) patch.locked = input.locked;
    if (input.doc !== undefined) {
      const parsed = safeParseTemplateDoc(input.doc);
      if (!parsed.success) throw AppException.templateInvalid(parsed.error.issues);
      patch.doc = parsed.data;
      patch.version = existing.version + 1;
      docChanged = true;
    }
    if (Object.keys(patch).length === 0) return existing;

    let updated: Template | null;
    try {
      updated = await this.templates.updateById(templateId, patch);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('A template with that name already exists');
      throw err;
    }
    if (!updated) throw AppException.notFound('Template');

    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'template.updated',
      'template',
      templateId,
      {
        name: updated.name,
        version: updated.version,
        docChanged,
        elements: updated.doc.elements.length,
      },
    );
    return updated;
  }

  async duplicate(
    tenantId: string,
    templateId: string,
    input: DuplicateTemplateInput,
    actorId: string,
  ): Promise<Template> {
    const source = await this.get(tenantId, templateId);
    await this.tenants.assertHeadroom(tenantId, 'templates');
    const now = new Date();
    const copy: Template = {
      ...source,
      id: newId(),
      name: input.name.trim(),
      description: source.description,
      doc: structuredClone(source.doc),
      thumbnailAssetId: null,
      isStarter: false,
      version: 1,
      createdBy: actorId,
      locked: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.templates.insert(copy);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('A template with that name already exists');
      throw err;
    }
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'template.created',
      'template',
      copy.id,
      {
        duplicatedFrom: templateId,
        name: copy.name,
      },
    );
    return copy;
  }

  async remove(
    tenantId: string,
    templateId: string,
    actorId: string,
  ): Promise<{ ok: true; inUseBy: number }> {
    const template = await this.get(tenantId, templateId);
    const inUse = await this.events.count({ tenantId, templateId });
    if (inUse > 0) {
      throw AppException.conflict(
        `This design is used by ${inUse} event${inUse === 1 ? '' : 's'}. Archive those events or point them at another design first.`,
      );
    }
    await this.templates.deleteById(templateId);
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'template.deleted',
      'template',
      templateId,
      { name: template.name },
      'warning',
    );
    return { ok: true, inUseBy: inUse };
  }

  /** The catalogue of built-in designs, without tenant state. */
  starters(): {
    key: string;
    name: string;
    category: string;
    description: string;
    accent: string;
    doc: TemplateDoc;
  }[] {
    return STARTER_DESIGNS.map((d) => ({
      key: d.key,
      name: d.name,
      category: d.category,
      description: d.description,
      accent: d.accent,
      doc: d.build(),
    }));
  }
}
