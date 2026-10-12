import { getPath, matchesFilter, type Filter } from './filter';

/**
 * The in-memory store and the Mongo store must agree on filter semantics, and
 * the memory implementation is driven entirely by `matchesFilter`. These cases
 * pin the operator surface the services rely on, including dotted paths and the
 * `$has` array operator used for webhook event subscriptions.
 */

describe('getPath', () => {
  const doc = { recipient: { name: 'Jane', tags: ['a', 'b'] }, top: 1 } as unknown as Record<
    string,
    unknown
  >;

  it('reads top level and dotted paths', () => {
    expect(getPath(doc, 'top')).toBe(1);
    expect(getPath(doc, 'recipient.name')).toBe('Jane');
  });

  it('projects dotted paths through arrays with Mongo any-element semantics', () => {
    const nested = { items: [{ serial: 'a' }, { serial: 'b' }] } as unknown as Record<
      string,
      unknown
    >;
    expect(getPath(nested, 'items.serial')).toEqual(['a', 'b']);
    expect(getPath(doc, 'recipient.missing.deep')).toBeUndefined();
  });
});

describe('matchesFilter', () => {
  const doc = {
    tenantId: 't1',
    status: 'issued',
    count: 5,
    tags: ['email', 'qr'],
    recipient: { email: 'a@b.c' },
    missing: null,
  } as unknown as Record<string, unknown>;

  it('matches implicit equality and $eq', () => {
    expect(matchesFilter(doc, { tenantId: 't1' })).toBe(true);
    expect(matchesFilter(doc, { tenantId: { $eq: 't1' } })).toBe(true);
    expect(matchesFilter(doc, { tenantId: 't2' })).toBe(false);
  });

  it('supports $ne, $in and $nin', () => {
    expect(matchesFilter(doc, { status: { $ne: 'revoked' } })).toBe(true);
    expect(matchesFilter(doc, { status: { $in: ['issued', 'delivered'] } })).toBe(true);
    expect(matchesFilter(doc, { status: { $nin: ['issued'] } })).toBe(false);
  });

  it('supports ordered comparisons', () => {
    expect(matchesFilter(doc, { count: { $gt: 4 } })).toBe(true);
    expect(matchesFilter(doc, { count: { $gt: 5 } })).toBe(false);
    expect(matchesFilter(doc, { count: { $gte: 5, $lte: 5 } })).toBe(true);
    expect(matchesFilter(doc, { count: { $lt: 5 } })).toBe(false);
  });

  it('supports $exists on present, null and absent fields', () => {
    expect(matchesFilter(doc, { missing: { $exists: true } })).toBe(true);
    expect(matchesFilter(doc, { absent: { $exists: true } })).toBe(false);
    expect(matchesFilter(doc, { absent: { $exists: false } })).toBe(true);
  });

  it('supports $regex with options and escaped input', () => {
    expect(matchesFilter(doc, { 'recipient.email': { $regex: '^A@', $options: 'i' } })).toBe(true);
    expect(matchesFilter(doc, { 'recipient.email': { $regex: 'a.b.c' } })).toBe(true);
    expect(matchesFilter(doc, { status: { $regex: 'iss' } })).toBe(true);
    expect(matchesFilter(doc, { status: { $regex: '^iss$' } })).toBe(false);
  });

  it('supports $has for array membership', () => {
    expect(matchesFilter(doc, { tags: { $has: 'qr' } })).toBe(true);
    expect(matchesFilter(doc, { tags: { $has: 'sms' } })).toBe(false);
  });

  it('combines $or, $and and $nor', () => {
    expect(matchesFilter(doc, { $or: [{ status: 'revoked' }, { count: 5 }] })).toBe(true);
    expect(matchesFilter(doc, { $and: [{ tenantId: 't1' }, { status: 'issued' }] })).toBe(true);
    expect(matchesFilter(doc, { $nor: [{ status: 'issued' }] })).toBe(false);
  });

  it('treats an empty or undefined filter as match-all', () => {
    expect(matchesFilter(doc, {})).toBe(true);
    expect(matchesFilter(doc, undefined)).toBe(true);
  });

  it('applies every operator in a compound field object', () => {
    const filter: Filter = { count: { $gte: 1, $lte: 10, $ne: 7 } };
    expect(matchesFilter(doc, filter)).toBe(true);
    expect(matchesFilter(doc, { count: { $gte: 1, $ne: 5 } })).toBe(false);
  });
});
