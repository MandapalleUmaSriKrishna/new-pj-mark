import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiKey } from '@kdc/shared';
import { generateApiKey } from '@kdc/shared';
import { CryptoService } from '../infra/crypto/crypto.service';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';

/** Scopes map onto the same permission strings used by the RBAC matrix. */
export const API_KEY_SCOPES = [
  'certificates:read',
  'certificates:write',
  'events:read',
  'events:write',
  'templates:read',
  'verify:read',
  'analytics:read',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * API keys for programmatic access.
 *
 * Only the SHA-256 hash of the secret is stored; the plaintext is returned once
 * at creation and can never be retrieved again. Keys are tenant-scoped, so an
 * integration for one organisation cannot read another's data even with a valid
 * key.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private readonly keys: Repository<ApiKey>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly crypto: CryptoService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {
    this.keys = store.repository<ApiKey>('api_keys');
  }

  static get SCOPES(): readonly ApiKeyScope[] {
    return API_KEY_SCOPES;
  }

  async list(tenantId: string): Promise<Omit<ApiKey, 'secretHash'>[]> {
    const rows = await this.keys.find({ tenantId }, { sort: { createdAt: -1 } });
    return rows.map(redact);
  }

  async create(
    tenantId: string,
    input: { name: string; scopes: string[]; expiresAt?: Date | null },
    actorId: string,
  ): Promise<{ key: Omit<ApiKey, 'secretHash'>; plaintext: string }> {
    this.tenants.assertFeature(await this.tenants.planOf(tenantId), 'apiAccess');
    await this.tenants.assertHeadroom(tenantId, 'apiKeys');

    const name = input.name.trim();
    if (name.length < 2 || name.length > 80)
      throw AppException.validationFailed('Key name must be 2-80 characters');
    const scopes = [...new Set(input.scopes ?? [])];
    if (scopes.length === 0) throw AppException.validationFailed('Select at least one scope');
    for (const scope of scopes) {
      if (!API_KEY_SCOPES.includes(scope as ApiKeyScope)) {
        throw AppException.validationFailed(
          `Unknown scope "${scope}". Valid scopes: ${API_KEY_SCOPES.join(', ')}`,
        );
      }
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw AppException.validationFailed('Expiry must be in the future');
    }

    const generated = generateApiKey('kdc');
    const now = new Date();
    const record: ApiKey = {
      id: newId(),
      tenantId,
      name,
      keyId: generated.id,
      secretHash: this.crypto.hashApiKey(generated.secret),
      prefix: generated.plain.slice(0, 12),
      scopes,
      active: true,
      lastUsedAt: null,
      expiresAt: input.expiresAt ?? null,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.keys.insert(record);
    } catch (err) {
      if (err instanceof DuplicateKeyError)
        throw AppException.conflict('A key with that identifier already exists; try again');
      throw err;
    }
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'apikey.created',
      'api_key',
      record.id,
      {
        name,
        scopes,
        keyId: record.keyId,
        expiresAt: record.expiresAt,
      },
      'warning',
    );
    this.logger.log(`API key ${record.keyId} created for tenant ${tenantId}`);
    return { key: redact(record), plaintext: generated.plain };
  }

  async revoke(tenantId: string, keyId: string, actorId: string): Promise<{ ok: true }> {
    const record = await this.keys.findById(keyId);
    if (!record || record.tenantId !== tenantId) throw AppException.notFound('API key');
    await this.keys.updateById(keyId, { active: false });
    await this.audit.recordFrom(
      { tenantId, userId: actorId, role: 'admin' },
      'apikey.revoked',
      'api_key',
      keyId,
      {
        name: record.name,
        keyId: record.keyId,
      },
      'critical',
    );
    return { ok: true };
  }

  async rotate(
    tenantId: string,
    keyId: string,
    actorId: string,
  ): Promise<{ key: Omit<ApiKey, 'secretHash'>; plaintext: string }> {
    const existing = await this.keys.findById(keyId);
    if (!existing || existing.tenantId !== tenantId) throw AppException.notFound('API key');
    await this.revoke(tenantId, keyId, actorId);
    return this.create(
      tenantId,
      { name: existing.name, scopes: existing.scopes, expiresAt: existing.expiresAt },
      actorId,
    );
  }
}

function redact(key: ApiKey): Omit<ApiKey, 'secretHash'> {
  const { secretHash: _secretHash, ...rest } = key;
  void _secretHash;
  return rest;
}
