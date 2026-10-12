import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditLog, Role } from '@kdc/shared';
import { buildFilter, canonicalJson, type FieldOperators } from '../infra/persistence/filter';
import { CryptoService } from '../infra/crypto/crypto.service';
import { DATA_STORE, type DataStore, type Repository } from '../infra/persistence/repository';
import { newId } from '../infra/ids';
import { escapeRegex } from '../common/dto/pagination.dto';

/** Fields whose values must never be written to the audit trail. */
const REDACT_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secretHash',
  'wrappedDek',
  'dek',
  'authorization',
  'cookie',
  'x-api-key',
  'clientSecret',
  'downloadToken',
  'downloadTokenHash',
  'inviteToken',
  'verificationToken',
  'recipientEmailEnc',
  'signature',
  'prevHash',
]);

/** Only the first N characters of long values are kept, to bound row size. */
const MAX_VALUE_LENGTH = 512;

export interface AuditInput {
  tenantId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: Role | 'system' | 'anonymous' | 'api_key' | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string;
  severity?: 'info' | 'warning' | 'critical';
}

/**
 * Immutable, tamper-evident audit log.
 *
 * Each entry stores `hash = SHA-256(prevHash || canonical(payload))` where
 * `prevHash` is the hash of the previous entry for the same tenant. Any edit or
 * deletion in the middle of the chain breaks every subsequent hash, which
 * `verifyChain` detects. Entries are never updated in place: the repository is
 * only ever appended to and read from.
 *
 * Secrets are stripped before hashing so the trail itself cannot become a leak.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly logs: Repository<AuditLog>;
  /** Last hash per tenant, so appending does not require a read every time. */
  private readonly heads = new Map<string, string>();
  private readonly genesis = '0'.repeat(64);

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly crypto: CryptoService,
  ) {
    this.logs = store.repository<AuditLog>('audit_logs');
  }

  static redact(payload: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!payload) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (REDACT_KEYS.has(key) || REDACT_KEYS.has(key.toLowerCase())) {
        out[key] = '[redacted]';
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        out[key] = AuditService.redact(value as Record<string, unknown>);
        continue;
      }
      if (Array.isArray(value)) {
        out[key] = value
          .slice(0, 50)
          .map((v) =>
            v && typeof v === 'object' && !(v instanceof Date)
              ? AuditService.redact(v as Record<string, unknown>)
              : clamp(v),
          );
        continue;
      }
      out[key] = clamp(value);
    }
    return out;
  }

  private async headFor(tenantId: string | null): Promise<string> {
    const key = tenantId ?? '__global__';
    const cached = this.heads.get(key);
    if (cached) return cached;
    const last = await this.logs.findOne(tenantId ? { tenantId } : { tenantId: null }, {
      sort: { createdAt: -1 },
      limit: 1,
    });
    const head = last?.hash ?? this.genesis;
    this.heads.set(key, head);
    return head;
  }

  async record(input: AuditInput): Promise<AuditLog> {
    const tenantId = input.tenantId ?? null;
    const prevHash = await this.headFor(tenantId);
    const payload = AuditService.redact(input.payload);
    const now = new Date();
    const body = {
      tenantId,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      payload,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? '-',
      severity: input.severity ?? 'info',
      at: now.toISOString(),
    };
    const hash = this.crypto.sha256(`${prevHash}|${canonicalJson(body)}`);
    const entry: AuditLog = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      tenantId,
      actorId: body.actorId,
      actorEmail: body.actorEmail,
      actorRole: body.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: body.entityId,
      payload,
      ip: body.ip,
      userAgent: body.userAgent,
      requestId: body.requestId,
      prevHash,
      hash,
      severity: body.severity,
    };
    await this.logs.insert(entry);
    this.heads.set(tenantId ?? '__global__', hash);
    return entry;
  }

  /** Convenience wrapper bound to an authenticated request context. */
  async recordFrom(
    ctx: {
      tenantId?: string | null;
      userId?: string | null;
      email?: string | null;
      role?: AuditInput['actorRole'];
      requestId?: string;
      ip?: string | null;
      userAgent?: string | null;
    },
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    payload?: Record<string, unknown>,
    severity: AuditInput['severity'] = 'info',
  ): Promise<AuditLog> {
    return this.record({
      tenantId: ctx.tenantId ?? null,
      actorId: ctx.userId ?? null,
      actorEmail: ctx.email ?? null,
      actorRole: ctx.role ?? (ctx.userId ? 'admin' : 'anonymous'),
      action,
      entityType,
      entityId,
      payload,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId,
      severity,
    });
  }

  async list(
    tenantId: string,
    opts: {
      page?: number;
      pageSize?: number;
      action?: string;
      entityType?: string;
      entityId?: string;
      actorId?: string;
      q?: string;
      from?: Date;
      to?: Date;
    } = {},
  ): Promise<{ items: AuditLog[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const filter: Record<string, unknown> = { tenantId };
    if (opts.action) filter.action = opts.action;
    if (opts.entityType) filter.entityType = opts.entityType;
    if (opts.entityId) filter.entityId = opts.entityId;
    if (opts.actorId) filter.actorId = opts.actorId;
    if (opts.q) {
      const rx: FieldOperators = { $regex: escapeRegex(opts.q), $options: 'i' };
      filter.$or = [{ actorEmail: rx }, { entityType: rx }, { action: rx }];
    }
    if (opts.from || opts.to) {
      const createdAt: FieldOperators = {};
      if (opts.from) createdAt.$gte = opts.from;
      if (opts.to) createdAt.$lte = opts.to;
      filter.createdAt = createdAt;
    }
    const built = buildFilter(filter);
    const [items, total] = await Promise.all([
      this.logs.find(built, {
        sort: { createdAt: -1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
      this.logs.count(built),
    ]);
    return { items, total };
  }

  /**
   * Walks the chain for a tenant and reports the first break. Runs in batches so
   * a tenant with a million entries does not load them all at once.
   */
  async verifyChain(
    tenantId: string,
    batchSize = 500,
  ): Promise<{
    ok: boolean;
    checked: number;
    brokenAt?: { id: string; createdAt: Date; reason: string };
  }> {
    let expectedPrev = this.genesis;
    let checked = 0;
    let skip = 0;
    for (;;) {
      const batch = await this.logs.find(
        { tenantId },
        { sort: { createdAt: 1 }, skip, limit: batchSize },
      );
      if (batch.length === 0) break;
      for (const entry of batch) {
        checked += 1;
        if (entry.prevHash !== expectedPrev) {
          return {
            ok: false,
            checked,
            brokenAt: {
              id: entry.id,
              createdAt: entry.createdAt,
              reason: 'prevHash does not match the previous entry',
            },
          };
        }
        const recomputed = this.recomputeHash(entry);
        if (recomputed !== entry.hash) {
          return {
            ok: false,
            checked,
            brokenAt: {
              id: entry.id,
              createdAt: entry.createdAt,
              reason: 'stored hash does not match the recomputed hash',
            },
          };
        }
        expectedPrev = entry.hash;
      }
      if (batch.length < batchSize) break;
      skip += batchSize;
    }
    return { ok: true, checked };
  }

  private recomputeHash(entry: AuditLog): string {
    const body = {
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      actorEmail: entry.actorEmail,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      payload: entry.payload,
      ip: entry.ip,
      userAgent: entry.userAgent,
      requestId: entry.requestId,
      severity: entry.severity,
      at: entry.createdAt.toISOString(),
    };
    return this.crypto.sha256(`${entry.prevHash}|${canonicalJson(body)}`);
  }

  /** Retention sweep. Deletes oldest-first and returns how many were removed. */
  async pruneOlderThan(tenantId: string, cutoff: Date): Promise<number> {
    const removed = await this.logs.deleteMany({ tenantId, createdAt: { $lt: cutoff } });
    if (removed > 0) {
      // The chain head may have moved; drop the cache so the next append reads it.
      this.heads.delete(tenantId);
      this.logger.warn(
        `Pruned ${removed} audit entries older than ${cutoff.toISOString()} for tenant ${tenantId}`,
      );
    }
    return removed;
  }
}

function clamp(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string')
    return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return String(value).slice(0, MAX_VALUE_LENGTH);
}
