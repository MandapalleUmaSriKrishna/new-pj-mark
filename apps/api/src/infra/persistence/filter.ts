/**
 * A deliberately small query DSL shared by both persistence adapters.
 *
 * The subset mirrors MongoDB query operators 1:1, so the Mongo adapter can pass
 * a filter straight through to the driver while the in-memory adapter
 * interprets the same object in JavaScript. Restricting the surface area is what
 * keeps the two drivers behaviourally identical (and testable) instead of
 * letting subtle operator differences leak between environments.
 */

export type Primitive = string | number | boolean | Date | null;

export interface FieldOperators {
  $eq?: Primitive;
  $ne?: Primitive;
  $in?: Primitive[];
  $nin?: Primitive[];
  $gt?: Primitive;
  $gte?: Primitive;
  $lt?: Primitive;
  $lte?: Primitive;
  $exists?: boolean;
  $regex?: string;
  $options?: string;
  /** Array-contains. */
  $has?: Primitive;
}

export type FieldFilter = Primitive | Primitive[] | FieldOperators;

export interface Filter {
  $or?: Filter[];
  $and?: Filter[];
  $nor?: Filter[];
  [field: string]: FieldFilter | Filter[] | undefined;
}

export type SortDirection = 1 | -1;
export type Sort = Record<string, SortDirection>;

export interface QueryOptions {
  sort?: Sort;
  limit?: number;
  skip?: number;
  /** Field whitelist. Absent means "all fields". */
  projection?: string[];
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function compare(a: unknown, b: unknown): number {
  const an = a instanceof Date ? a.getTime() : a;
  const bn = b instanceof Date ? b.getTime() : b;
  if (an === bn) return 0;
  if (an === null || an === undefined) return -1;
  if (bn === null || bn === undefined) return 1;
  return (an as number) < (bn as number) ? -1 : 1;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ad = a instanceof Date ? a.getTime() : Date.parse(String(a));
    const bd = b instanceof Date ? b.getTime() : Date.parse(String(b));
    return !Number.isNaN(ad) && ad === bd;
  }
  return a === b;
}

function matchesFieldValue(actual: unknown, expected: FieldFilter): boolean {
  if (Array.isArray(expected)) {
    // Array literal means "$in" for scalar fields, element match for array fields.
    if (Array.isArray(actual)) return expected.some((e) => actual.some((a) => looseEqual(a, e)));
    return expected.some((e) => looseEqual(actual, e));
  }
  if (isPlainObject(expected) && Object.keys(expected).some((k) => k.startsWith('$'))) {
    const ops = expected as FieldOperators;
    for (const [op, operand] of Object.entries(ops)) {
      switch (op) {
        case '$eq':
          if (!looseEqual(actual, operand)) return false;
          break;
        case '$ne':
          if (looseEqual(actual, operand)) return false;
          break;
        case '$in':
          if (
            !(operand as Primitive[]).some(
              (o) =>
                looseEqual(actual, o) ||
                (Array.isArray(actual) && actual.some((a) => looseEqual(a, o))),
            )
          )
            return false;
          break;
        case '$nin':
          if ((operand as Primitive[]).some((o) => looseEqual(actual, o))) return false;
          break;
        case '$gt':
          if (!(actual !== undefined && actual !== null && compare(actual, operand) > 0))
            return false;
          break;
        case '$gte':
          if (!(actual !== undefined && actual !== null && compare(actual, operand) >= 0))
            return false;
          break;
        case '$lt':
          if (!(actual !== undefined && actual !== null && compare(actual, operand) < 0))
            return false;
          break;
        case '$lte':
          if (!(actual !== undefined && actual !== null && compare(actual, operand) <= 0))
            return false;
          break;
        case '$exists':
          if ((operand === true) !== (actual !== undefined)) return false;
          break;
        case '$regex': {
          if (typeof actual !== 'string') return false;
          const re = new RegExp(operand as string, ops.$options ?? '');
          if (!re.test(actual)) return false;
          break;
        }
        case '$options':
          break; // handled with $regex
        case '$has':
          if (!Array.isArray(actual) || !actual.some((a) => looseEqual(a, operand))) return false;
          break;
        default:
          throw new Error(`Unsupported filter operator: ${op}`);
      }
    }
    return true;
  }
  if (expected instanceof RegExp) {
    return typeof actual === 'string' && expected.test(actual);
  }
  if (Array.isArray(actual)) return actual.some((a) => looseEqual(a, expected));
  return looseEqual(actual, expected);
}

export function getPath(doc: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return doc[path];
  const parts = path.split('.');
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      // Mongo semantics: an array field matches if ANY element satisfies the rest.
      const rest = parts.slice(parts.indexOf(p)).join('.');
      return cur.map((el) =>
        isPlainObject(el) ? getPath(el as Record<string, unknown>, rest) : undefined,
      );
    }
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function matchesFilter(doc: Record<string, unknown>, filter: Filter | undefined): boolean {
  if (!filter) return true;
  for (const [key, condition] of Object.entries(filter)) {
    if (condition === undefined) continue;
    if (key === '$or') {
      const list = condition as Filter[];
      if (list.length > 0 && !list.some((f) => matchesFilter(doc, f))) return false;
      continue;
    }
    if (key === '$and') {
      const list = condition as Filter[];
      if (!list.every((f) => matchesFilter(doc, f))) return false;
      continue;
    }
    if (key === '$nor') {
      const list = condition as Filter[];
      if (list.some((f) => matchesFilter(doc, f))) return false;
      continue;
    }
    const actual = getPath(doc, key);
    if (Array.isArray(actual) && Array.isArray(condition)) {
      if (!matchesFieldValue(actual, condition as FieldFilter)) return false;
      continue;
    }
    if (!matchesFieldValue(actual, condition as FieldFilter)) return false;
  }
  return true;
}

export function applySort<T extends Record<string, unknown>>(rows: T[], sort?: Sort): T[] {
  if (!sort || Object.keys(sort).length === 0) return rows;
  const keys = Object.entries(sort);
  return [...rows].sort((a, b) => {
    for (const [field, dir] of keys) {
      const c = compare(getPath(a, field), getPath(b, field));
      if (c !== 0) return dir === -1 ? -c : c;
    }
    return 0;
  });
}

export function applyProjection<T extends Record<string, unknown>>(
  row: T,
  projection?: string[],
): T {
  if (!projection || projection.length === 0) return row;
  const out: Record<string, unknown> = {};
  for (const field of projection) {
    const v = getPath(row, field);
    if (v !== undefined) out[field] = v;
  }
  if (!('id' in out) && 'id' in row) out.id = row.id;
  return out as T;
}

/** Applies a `$set`-style patch, supporting dotted paths. */
export function applyPatch<T extends Record<string, unknown>>(
  doc: T,
  patch: Record<string, unknown>,
): T {
  const next: Record<string, unknown> = { ...doc };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!key.includes('.')) {
      if (value === null) delete next[key];
      else next[key] = value;
      continue;
    }
    const parts = key.split('.');
    let cursor: Record<string, unknown> = next;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i] as string;
      if (!isPlainObject(cursor[part])) cursor[part] = {};
      cursor[part] = { ...(cursor[part] as Record<string, unknown>) };
      cursor = cursor[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1] as string;
    if (value === null) delete cursor[leaf];
    else cursor[leaf] = value;
  }
  return next as T;
}

/** Stable canonical JSON used for hashing audit entries and integrity signatures. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * Builds a filter from a dynamically assembled plain object.
 *
 * Services frequently construct filters conditionally (only add `status` when
 * the caller passed one), which TypeScript cannot express against the strict
 * `Filter` index signature. The adapters remain strict at runtime: the memory
 * driver throws on any operator outside the documented set, and MongoDB rejects
 * unknown operators itself, so an unsupported value fails loudly rather than
 * silently matching everything.
 */
export function buildFilter(fields: Record<string, unknown>): Filter {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete fields[key];
  }
  return fields as unknown as Filter;
}
