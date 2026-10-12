import { Logger } from '@nestjs/common';
import { MongoClient, type Collection, type Db } from 'mongodb';
import type { BaseEntity } from '@kdc/shared';
import {
  COLLECTION_SPECS,
  DuplicateKeyError,
  type CollectionName,
  type DataStore,
  type NewDoc,
  type Repository,
} from './repository';
import { applyProjection, type Filter, type QueryOptions } from './filter';

/**
 * MongoDB persistence adapter.
 *
 * Mongoose is used for connection management (pooling, topology events, graceful
 * close) while documents are read and written through the raw driver collection
 * API. That keeps the query semantics byte-for-byte identical to the in-memory
 * adapter: the same filter DSL is passed straight to MongoDB instead of being
 * re-interpreted, so there is no second place for query bugs to hide.
 */

function isDuplicateKey(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  return code === 11000 || code === 11001;
}

function translateError(err: unknown, name: string, fields: string[], value: unknown): Error {
  if (isDuplicateKey(err)) return new DuplicateKeyError(name, fields, value);
  return err instanceof Error ? err : new Error(String(err));
}

class MongoRepository<T extends BaseEntity> implements Repository<T> {
  private readonly logger: Logger;

  constructor(
    readonly name: CollectionName,
    private readonly db: Db,
    private readonly spec = COLLECTION_SPECS[name],
  ) {
    this.logger = new Logger(`MongoRepo:${name}`);
  }

  private get col(): Collection {
    return this.db.collection(this.name);
  }

  private fromDoc(doc: (Record<string, unknown> & { _id?: unknown }) | null): T | null {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { ...(rest as object), id: (rest.id as string) ?? String(_id) } as T;
  }

  private toDoc(data: Record<string, unknown>): Record<string, unknown> {
    const { id, ...rest } = data;
    return { ...rest, id };
  }

  async find(filter: Filter = {}, options?: QueryOptions): Promise<T[]> {
    let cursor = this.col.find(filter as Record<string, unknown>);
    if (options?.sort) cursor = cursor.sort(options.sort as Record<string, 1 | -1>);
    if (options?.skip) cursor = cursor.skip(options.skip);
    if (options?.limit !== undefined && options.limit >= 0) cursor = cursor.limit(options.limit);
    const docs = await cursor.toArray();
    return docs.map(
      (d) =>
        applyProjection(
          this.fromDoc(d as Record<string, unknown>) as unknown as Record<string, unknown>,
          options?.projection,
        ) as unknown as T,
    );
  }

  async findOne(filter: Filter, options?: QueryOptions): Promise<T | null> {
    const docs = await this.find(filter, { ...options, limit: 1 });
    return docs[0] ?? null;
  }

  async findById(id: string): Promise<T | null> {
    const doc = await this.col.findOne({ id });
    return this.fromDoc(doc as Record<string, unknown> | null);
  }

  async count(filter: Filter = {}): Promise<number> {
    return this.col.countDocuments(filter as Record<string, unknown>);
  }

  async exists(filter: Filter): Promise<boolean> {
    const doc = await this.col.findOne(filter as Record<string, unknown>, {
      projection: { _id: 1 },
    });
    return doc !== null;
  }

  async insert(data: NewDoc<T>): Promise<T> {
    const now = new Date();
    const doc = { createdAt: now, updatedAt: now, ...data } as unknown as Record<string, unknown>;
    try {
      await this.col.insertOne(this.toDoc(doc));
    } catch (err) {
      throw translateError(err, this.name, ['(declared unique index)'], doc.id);
    }
    return doc as T;
  }

  async insertMany(data: NewDoc<T>[]): Promise<T[]> {
    const now = new Date();
    const docs = data.map((d) =>
      this.toDoc({ createdAt: now, updatedAt: now, ...d } as unknown as Record<string, unknown>),
    );
    if (docs.length === 0) return [];
    try {
      await this.col.insertMany(docs, { ordered: true });
    } catch (err) {
      throw translateError(err, this.name, ['(declared unique index)'], 'batch');
    }
    return docs as unknown as T[];
  }

  async updateById(id: string, patch: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await this.col.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return this.fromDoc(res as Record<string, unknown> | null);
    } catch (err) {
      throw translateError(err, this.name, ['(declared unique index)'], id);
    }
  }

  async updateMany(filter: Filter, patch: Record<string, unknown>): Promise<number> {
    const res = await this.col.updateMany(filter as Record<string, unknown>, {
      $set: { ...patch, updatedAt: new Date() },
    });
    return res.modifiedCount ?? 0;
  }

  async deleteById(id: string): Promise<boolean> {
    const res = await this.col.deleteOne({ id });
    return (res.deletedCount ?? 0) > 0;
  }

  async deleteMany(filter: Filter): Promise<number> {
    const res = await this.col.deleteMany(filter as Record<string, unknown>);
    return res.deletedCount ?? 0;
  }

  async distinct(field: string, filter: Filter = {}): Promise<string[]> {
    const values = await this.col.distinct(field, filter as Record<string, unknown>);
    return (values as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  }

  async sum(field: string, filter: Filter = {}): Promise<number> {
    const [res] = await this.col
      .aggregate<{ total: number }>([
        { $match: filter as Record<string, unknown> },
        { $group: { _id: null, total: { $sum: `$${field}` } } },
      ])
      .toArray();
    return res?.total ?? 0;
  }
}

export class MongoDataStore implements DataStore {
  readonly driver = 'mongo' as const;
  private readonly logger = new Logger('MongoDataStore');
  private readonly repos = new Map<CollectionName, MongoRepository<BaseEntity>>();
  private client: MongoClient | null = null;
  private db: Db | null = null;

  /**
   * Talks to MongoDB through the official driver.
   *
   * `dbName` is passed explicitly rather than parsed out of the URI so that a
   * connection string without a path component (common with Atlas SRV records)
   * still lands in the intended database.
   */
  constructor(
    private readonly uri: string,
    private readonly dbName: string,
  ) {}

  async connect(): Promise<void> {
    const client = new MongoClient(this.uri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 50,
      minPoolSize: 2,
      retryWrites: true,
      retryReads: true,
    });
    // The driver never creates indexes implicitly; ensureIndexes() below is the
    // only place they are declared.
    await client.connect();
    this.client = client;
    const db = client.db(this.dbName);
    this.db = db;
    for (const name of Object.keys(COLLECTION_SPECS) as CollectionName[]) {
      this.repos.set(name, new MongoRepository<BaseEntity>(name, db));
    }
    await this.ensureIndexes(db);
    this.logger.log(`Connected to MongoDB and ensured indexes on ${this.repos.size} collections`);
  }

  private async ensureIndexes(db: Db): Promise<void> {
    for (const [name, spec] of Object.entries(COLLECTION_SPECS) as [
      CollectionName,
      (typeof COLLECTION_SPECS)[CollectionName],
    ][]) {
      const col = db.collection(name);
      for (const index of spec.unique) {
        const keys: Record<string, 1> = {};
        for (const f of index.fields) keys[f] = 1;
        const options: Record<string, unknown> = { unique: true, background: true };
        if (index.partial) {
          // Enforce uniqueness only for documents where every field is present.
          const expr: Record<string, unknown> = {};
          for (const f of index.fields) expr[f] = { $type: 'string' };
          options.partialFilterExpression = expr;
        }
        try {
          await col.createIndex(keys, options);
        } catch (err) {
          this.logger.warn(
            `Could not create unique index on ${name}.${index.fields.join('+')}: ${(err as Error).message}`,
          );
        }
      }
      for (const fields of spec.indexes) {
        const keys: Record<string, 1> = {};
        for (const f of fields) keys[f] = 1;
        try {
          await col.createIndex(keys, { background: true });
        } catch (err) {
          this.logger.warn(
            `Could not create index on ${name}(${fields.join(',')}): ${(err as Error).message}`,
          );
        }
      }
    }
  }

  repository<T extends BaseEntity>(name: CollectionName): Repository<T> {
    const repo = this.repos.get(name);
    if (!repo) throw new Error(`MongoDataStore not connected or unknown collection "${name}"`);
    return repo as unknown as Repository<T>;
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      if (!this.db) return { ok: false, detail: 'not connected' };
      await this.db.admin().ping();
      return { ok: true, detail: `mongodb ${this.dbName} ping ok` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}
