import type { BaseEntity } from '@kdc/shared';
import {
  COLLECTION_SPECS,
  DuplicateKeyError,
  type CollectionName,
  type DataStore,
  type NewDoc,
  type Repository,
} from './repository';
import {
  applyPatch,
  applyProjection,
  applySort,
  getPath,
  matchesFilter,
  type Filter,
  type QueryOptions,
} from './filter';

/**
 * In-process persistence adapter.
 *
 * This is NOT a toy: it enforces the same declared unique indexes as MongoDB,
 * supports the same query DSL, and clones documents on the way in and out so
 * callers cannot mutate stored state by accident. It exists for two purposes:
 *   1. `npm run dev` works with zero external services.
 *   2. the test suite exercises real HTTP flows deterministically.
 * It is refused in production unless explicitly acknowledged, because data does
 * not survive a restart.
 */

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(deepClone) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepClone(v);
  return out as T;
}

class MemoryRepository<T extends BaseEntity> implements Repository<T> {
  private readonly rows = new Map<string, T>();

  constructor(
    readonly name: CollectionName,
    private readonly spec = COLLECTION_SPECS[name],
  ) {}

  private assertUnique(candidate: T, ignoreId?: string): void {
    for (const index of this.spec.unique) {
      const values = index.fields.map((f) =>
        getPath(candidate as unknown as Record<string, unknown>, f),
      );
      if (index.partial && values.some((v) => v === undefined || v === null || v === '')) continue;
      for (const existing of this.rows.values()) {
        if (ignoreId && existing.id === ignoreId) continue;
        const ev = index.fields.map((f) =>
          getPath(existing as unknown as Record<string, unknown>, f),
        );
        if (
          ev.length === values.length &&
          ev.every((v, i) => v === values[i] && v !== undefined && v !== null)
        ) {
          throw new DuplicateKeyError(this.name, index.fields, values);
        }
      }
    }
  }

  private stamp(doc: NewDoc<T>): T {
    const now = new Date();
    // Callers may back-date `createdAt` (e.g. imports that preserve an original
    // issue date); anything else is stamped with "now".
    return {
      ...doc,
      createdAt: doc.createdAt ?? now,
      updatedAt: doc.updatedAt ?? now,
    } as T;
  }

  async find(filter?: Filter, options?: QueryOptions): Promise<T[]> {
    let rows = [...this.rows.values()].filter((r) =>
      matchesFilter(r as unknown as Record<string, unknown>, filter),
    );
    rows = applySort(rows as unknown as Record<string, unknown>[], options?.sort) as unknown as T[];
    if (options?.skip) rows = rows.slice(options.skip);
    if (options?.limit !== undefined && options.limit >= 0) rows = rows.slice(0, options.limit);
    return rows.map(
      (r) =>
        applyProjection(
          deepClone(r) as unknown as Record<string, unknown>,
          options?.projection,
        ) as unknown as T,
    );
  }

  async findOne(filter: Filter, options?: QueryOptions): Promise<T | null> {
    const found = await this.find(filter, { ...options, limit: 1 });
    return found[0] ?? null;
  }

  async findById(id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return row ? deepClone(row) : null;
  }

  async count(filter?: Filter): Promise<number> {
    if (!filter || Object.keys(filter).length === 0) return this.rows.size;
    return [...this.rows.values()].filter((r) =>
      matchesFilter(r as unknown as Record<string, unknown>, filter),
    ).length;
  }

  async exists(filter: Filter): Promise<boolean> {
    for (const r of this.rows.values()) {
      if (matchesFilter(r as unknown as Record<string, unknown>, filter)) return true;
    }
    return false;
  }

  async insert(data: NewDoc<T>): Promise<T> {
    const doc = this.stamp(data);
    if (this.rows.has(doc.id)) throw new DuplicateKeyError(this.name, ['id'], doc.id);
    this.assertUnique(doc);
    this.rows.set(doc.id, deepClone(doc));
    return deepClone(doc);
  }

  async insertMany(data: NewDoc<T>[]): Promise<T[]> {
    const out: T[] = [];
    for (const d of data) out.push(await this.insert(d));
    return out;
  }

  async updateById(id: string, patch: Record<string, unknown>): Promise<T | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const patched = applyPatch(
      existing as unknown as Record<string, unknown>,
      patch,
    ) as unknown as T;
    const next = { ...patched, updatedAt: new Date() } as T;
    this.assertUnique(next, id);
    this.rows.set(id, deepClone(next));
    return deepClone(next);
  }

  async updateMany(filter: Filter, patch: Record<string, unknown>): Promise<number> {
    const targets = [...this.rows.values()].filter((r) =>
      matchesFilter(r as unknown as Record<string, unknown>, filter),
    );
    for (const t of targets) await this.updateById(t.id, patch);
    return targets.length;
  }

  async deleteById(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async deleteMany(filter: Filter): Promise<number> {
    const targets = [...this.rows.values()].filter((r) =>
      matchesFilter(r as unknown as Record<string, unknown>, filter),
    );
    for (const t of targets) this.rows.delete(t.id);
    return targets.length;
  }

  async distinct(field: string, filter?: Filter): Promise<string[]> {
    const set = new Set<string>();
    for (const r of this.rows.values()) {
      if (!matchesFilter(r as unknown as Record<string, unknown>, filter)) continue;
      const v = getPath(r as unknown as Record<string, unknown>, field);
      if (typeof v === 'string' && v) set.add(v);
    }
    return [...set];
  }

  async sum(field: string, filter?: Filter): Promise<number> {
    let total = 0;
    for (const r of this.rows.values()) {
      if (!matchesFilter(r as unknown as Record<string, unknown>, filter)) continue;
      const v = getPath(r as unknown as Record<string, unknown>, field);
      if (typeof v === 'number' && Number.isFinite(v)) total += v;
    }
    return total;
  }

  /** Test/dev helper. */
  _clear(): void {
    this.rows.clear();
  }
}

export class MemoryDataStore implements DataStore {
  readonly driver = 'memory' as const;
  private readonly repos = new Map<CollectionName, MemoryRepository<BaseEntity>>();

  constructor() {
    for (const name of Object.keys(COLLECTION_SPECS) as CollectionName[]) {
      this.repos.set(name, new MemoryRepository<BaseEntity>(name));
    }
  }

  repository<T extends BaseEntity>(name: CollectionName): Repository<T> {
    const repo = this.repos.get(name);
    if (!repo) throw new Error(`Unknown collection "${name}"`);
    return repo as unknown as Repository<T>;
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'in-process memory store' };
  }

  async close(): Promise<void> {
    this.clearAll();
  }

  clearAll(): void {
    for (const repo of this.repos.values()) repo._clear();
  }
}
