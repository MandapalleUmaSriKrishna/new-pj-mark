/** In-memory store: TTLs, sweeping, rolling send windows and the send lock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySessionStore, createKeyedLock } from '../src/services/session-store.js';

function buildStore({ ttlMs = 60_000 } = {}) {
  const clock = { current: 1_000_000 };
  const store = new MemorySessionStore({ ttlMs, now: () => clock.current });
  return { store, clock };
}

test('creates, reads, updates and deletes sessions', () => {
  const { store } = buildStore();
  const session = store.createSession({ phone: '+919876543210', phoneMasked: '+91••••••3210' });

  assert.equal(session.id.length >= 32, true);
  assert.equal(store.getSession(session.id).phone, '+919876543210');

  store.updateSession(session.id, { verified: true, verifiedAt: 1_000_001 });
  assert.equal(store.getSession(session.id).verified, true);

  assert.equal(store.deleteSession(session.id), true);
  assert.equal(store.getSession(session.id), undefined);
});

test('rejects malformed session ids', () => {
  const { store } = buildStore();
  for (const id of [undefined, null, '', 'short', 42, {}]) {
    assert.equal(store.getSession(id), undefined);
  }
});

test('session ids are unpredictable and unique', () => {
  const { store } = buildStore();
  const ids = new Set(Array.from({ length: 200 }, () => store.createSession().id));
  assert.equal(ids.size, 200);
  assert.ok([...ids].every((id) => id.length >= 40));
});

test('unverified sessions expire quickly; verified sessions live for the full TTL', () => {
  const { store, clock } = buildStore({ ttlMs: 24 * 60 * 60 * 1000 });

  const pending = store.createSession();
  clock.current += 16 * 60 * 1000;
  assert.equal(store.getSession(pending.id), undefined, 'pending sessions expire after 15 minutes');

  const verified = store.createSession({ verified: true });
  clock.current += 20 * 60 * 1000;
  assert.ok(store.getSession(verified.id), 'verified sessions survive 20 minutes');
  clock.current += 24 * 60 * 60 * 1000;
  assert.equal(store.getSession(verified.id), undefined);
});

test('sweep evicts expired sessions and stale abuse records', () => {
  const { store, clock } = buildStore({ ttlMs: 60_000 });
  store.createSession();
  store.createSession();
  store.recordSend('+919876543210');

  clock.current += 61_000;
  const removed = store.sweep();
  assert.ok(removed >= 2);
  assert.equal(store.stats().sessions, 0);
});

test('prunes send timestamps outside the rolling window', () => {
  const { store, clock } = buildStore();
  const number = '+919876543210';

  store.recordSend(number);
  clock.current += 10_000;
  store.recordSend(number);
  clock.current += 50_000;

  const record = store.pruneSendTimestamps(store.getAbuseRecord(number), 60_000);
  assert.equal(record.sendTimestamps.length, 1, 'only the send inside 60s is retained');
  assert.equal(record.lastSendAt, 1_010_000);
});

test('keyed lock serialises work for the same key and keeps results', async () => {
  const withLock = createKeyedLock();
  const order = [];

  const first = withLock('phone', async () => {
    order.push('first:start');
    await new Promise((resolve) => setTimeout(resolve, 40));
    order.push('first:end');
    return 1;
  });
  const second = withLock('phone', async () => {
    order.push('second:start');
    return 2;
  });
  const other = withLock('other', async () => {
    order.push('other:start');
    return 3;
  });

  const [a, b, c] = await Promise.all([first, second, other]);

  assert.deepEqual([a, b, c], [1, 2, 3]);
  assert.deepEqual(order.slice(0, 2), ['first:start', 'other:start'], 'different keys run concurrently');
  assert.deepEqual(order.slice(-2), ['first:end', 'second:start'], 'same key is serialised');
});

test('keyed lock releases after a rejection', async () => {
  const withLock = createKeyedLock();
  await assert.rejects(
    withLock('k', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  const value = await withLock('k', async () => 'recovered');
  assert.equal(value, 'recovered');
});
