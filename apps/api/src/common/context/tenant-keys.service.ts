import { Inject, Injectable } from '@nestjs/common';
import type { Tenant } from '@kdc/shared';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { CACHE_PORT, type CachePort } from '../../infra/cache/cache.port';
import { DATA_STORE, type DataStore, type Repository } from '../../infra/persistence/repository';
import { AppException } from '../errors/app.exception';

/**
 * Per-tenant key material.
 *
 * Each tenant gets its own 256-bit data encryption key (DEK). The DEK is stored
 * wrapped by the master key (KEK) that only the process holds, so a database
 * dump on its own cannot be decrypted, and rotating the KEK only means
 * re-wrapping one small value per tenant instead of re-encrypting every row.
 *
 * Unwrapped DEKs are cached in memory (never in Redis) for the lifetime of the
 * process, keyed by tenant id.
 */
@Injectable()
export class TenantKeysService {
  private readonly tenants: Repository<Tenant>;
  private readonly deks = new Map<string, Buffer>();

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly crypto: CryptoService,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {
    this.tenants = store.repository<Tenant>('tenants');
  }

  /** Returns the tenant, or 404s. Callers must already have proved membership. */
  async requireTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.deletedAt) throw AppException.tenantNotFound();
    return tenant;
  }

  async dekFor(tenantId: string): Promise<Buffer> {
    const cached = this.deks.get(tenantId);
    if (cached) return cached;
    const tenant = await this.requireTenant(tenantId);
    let dek: Buffer;
    if (tenant.wrappedDek) {
      try {
        dek = this.crypto.unwrapDek(tenant.wrappedDek);
      } catch {
        // The master key changed without re-wrapping; fail closed rather than
        // silently writing new rows under a different key.
        throw AppException.serviceUnavailable(
          'Tenant encryption key could not be unwrapped - the master key may have been rotated. Run the rewrap task.',
        );
      }
    } else {
      const wrapped = this.crypto.wrapNewDek();
      dek = wrapped.dek;
      await this.tenants.updateById(tenantId, { wrappedDek: wrapped.wrapped });
    }
    this.deks.set(tenantId, dek);
    return dek;
  }

  /** Encrypts a value with the tenant DEK. */
  async encrypt(tenantId: string, plaintext: string | null | undefined): Promise<string | null> {
    if (!plaintext) return null;
    return this.crypto.encrypt(plaintext, await this.dekFor(tenantId));
  }

  /** Decrypts a value with the tenant DEK; returns null when it cannot be read. */
  async decrypt(tenantId: string, ciphertext: string | null | undefined): Promise<string | null> {
    if (!ciphertext) return null;
    return this.crypto.decrypt(ciphertext, await this.dekFor(tenantId));
  }

  /** Blind index so an encrypted email can still be looked up. */
  async blindIndex(tenantId: string, value: string): Promise<string> {
    return this.crypto.blindIndex(value, await this.dekFor(tenantId));
  }

  /** Drops cached key material (used after re-wrapping or in tests). */
  forget(tenantId?: string): void {
    if (tenantId) this.deks.delete(tenantId);
    else this.deks.clear();
    void this.cache;
  }
}
