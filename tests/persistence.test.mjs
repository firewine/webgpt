import test from 'node:test';
import assert from 'node:assert/strict';
import { stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from '../dist/server/workspace/store.js';
import { storage } from './workspace-helpers.mjs';
test('state, journal and idempotency commit atomically and survive restart', async t => {
  const { store, directory } = await storage(t); const original = store.read().hostId;
  assert.throws(() => new Store(directory), /state_locked/);
  const event = { type: 'fixture.changed', discussionId: null, data: { safe: true } };
  assert.throws(() => store.transact((s, emit) => { s.hostId = 'rollback'; emit(event); throw new Error('rollback'); }));
  assert.equal(store.read().hostId, original); assert.equal(store.cursor(), 0);
  let calls = 0; const fn = (s, emit) => { calls++; s.browserPaused = true; emit(event); return 'receipt'; };
  assert.equal(store.transact(fn, { id: 'same', input: { action: 'pause' } }), 'receipt');
  assert.equal(store.transact(fn, { id: 'same', input: { action: 'pause' } }), 'receipt'); assert.equal(calls, 1);
  assert.throws(() => store.transact(fn, { id: 'same', input: { action: 'different' } }), /idempotency_conflict/);
  store.close(); const reopened = new Store(directory);
  assert.equal(reopened.read().hostId, original); assert.equal(reopened.read().browserPaused, true); assert.equal(reopened.events(0).length, 1);
  assert.equal((await stat(directory)).mode & 0o777, 0o700); assert.equal((await stat(join(directory, 'workspace.sqlite'))).mode & 0o777, 0o600);
  reopened.close();
});
test('vault authenticates encrypted records and isolates deletion', async t => {
  const { vault, directory, store } = await storage(t); vault.put('a', { token: 'SECRET-A-DO-NOT-LOG' }); vault.put('b', { token: 'SECRET-B-DO-NOT-LOG' });
  assert.deepEqual(vault.get('a'), { token: 'SECRET-A-DO-NOT-LOG' });
  for (const file of await readdir(join(directory, 'credentials'))) { const path = join(directory, 'credentials', file); assert.equal((await stat(path)).mode & 0o777, 0o600); assert.ok(!(await readFile(path)).includes(Buffer.from('SECRET-'))); }
  assert.doesNotMatch(JSON.stringify(store.read()), /SECRET-/); vault.remove('a'); assert.equal(vault.get('a'), null); assert.equal(vault.get('b').token, 'SECRET-B-DO-NOT-LOG');
});
