import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore, migrateResident } from '../dist/server/workspace/resident-store.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
import { digest } from '../dist/server/workspace/util.js';
import { storage, topic } from './workspace-helpers.mjs';

const commandRows = db => db.prepare('SELECT * FROM commands ORDER BY id').all();
function fixture(store, variant) {
  let calls = 0;
  const engine = new DiscussionEngine(store, { complete: async () => { calls++; throw new Error('unexpected dispatch'); } }, { sourceFetch: false, turnTimeoutMs: 1000 });
  engine.kick = () => {};
  const discussionId = engine.create({ ...topic, materials: 'Legacy original\n  with spacing' }, 'legacy-create');
  store.transact(s => {
    const d = s.discussions[0]; d.status = 'paused';
    if (variant === 'materials') {
      s.materialPackages = [{ id: 'legacy-pack', label: 'fixture', createdAt: d.createdAt, files: [{ path: '/fixture/notes.md', text: 'Private fixture material', digest: digest('Private fixture material'), size: 24, observedAt: d.createdAt, excerpt: false, identity: 'fixture-file' }] }];
      d.materialPackageIds = ['legacy-pack'];
      s.connections.push({ id: 'legacy-account', kind: 'deepseek', label: 'Fixture account', status: 'unverified', models: [] });
      s.sessions.push({ hash: digest('fixture-session'), expiresAt: 1 });
    }
    if (variant === 'unconfirmed') {
      const task = d.tasks[0]; task.status = 'unconfirmed'; task.turnId = 'legacy-turn'; d.status = 'blocked';
      d.turns.push({ id: task.turnId, taskId: task.id, participantId: task.participantId, revision: 1, generation: 1, phase: 'independent', round: 1,
        status: 'unconfirmed', prompt: 'Original request', promptDigest: digest('Original request'), text: '', reply: null, startedAt: d.createdAt, finishedAt: null, receipt: null, error: 'restart_requires_reconciliation', usage: null, evidenceIds: [] });
      s.jobs.push({ id: 'legacy-job', bindingId: 'legacy-binding', discussionId: d.id, taskId: task.id, revision: 1, requestId: 'legacy-job-request', prompt: 'Original job', promptDigest: digest('Original job'), status: 'reconciling', threadId: 'legacy-thread', turnId: 'legacy-codex-turn', createdAt: d.createdAt, finishedAt: null, maxDurationMs: 1000, deadlineAt: null, text: '', error: 'requires_reconciliation', activities: [], approvals: [] });
    }
  });
  return { discussionId, calls: () => calls, replay: () => engine.create({ ...topic, materials: 'Legacy original\n  with spacing' }, 'legacy-create') };
}

for (const variant of ['base', 'materials', 'unconfirmed']) {
  test('R1-A/B: ' + variant + ' legacy fixture survives 100 migrations and restart without dispatch/replay', async t => {
    const { store, directory, vault } = await storage(t); const legacy = fixture(store, variant);
    vault.put('legacy-account', { key: 'fixture-credential-only' });
    const before = store.read(); const cursor = store.cursor(); const events = store.events(0);
    const db = new DatabaseSync(join(directory, 'workspace.sqlite')); t.after(() => db.close()); const receipts = commandRows(db);
    const disabled = new ResidentStore(store, false); assert.equal(disabled.snapshot().schemaVersion, null);
    assert.deepEqual(store.read(), before); assert.deepEqual(commandRows(db), receipts);
    const resident = new ResidentStore(store, true); const roomId = resident.snapshot().rooms[0].id;
    for (let i = 0; i < 100; i++) migrateResident(store);
    const { resident: added, ...preserved } = store.read();
    assert.equal(digest(JSON.stringify(preserved)), digest(JSON.stringify(before)));
    assert.equal(added.rooms.length, 1); assert.equal(added.rooms[0].id, roomId);
    assert.equal(added.rooms[0].desiredOn, false); assert.equal(added.rooms[0].observedStatus, 'off');
    assert.ok(added.rooms[0].members.every(m => m.enabled === false));
    assert.deepEqual(added.rooms[0].legacyDiscussionIds, [legacy.discussionId]); assert.deepEqual(added.messages, []);
    assert.equal(added.rooms[0].budgets, null); assert.equal(added.rooms[0].nextEligibleAt, null);
    assert.equal(added.migration.basisCursor, cursor); assert.equal(store.cursor(), cursor); assert.deepEqual(store.events(0), events);
    assert.deepEqual(commandRows(db).filter(r => r.id !== 'resident:migration:v1'), receipts);
    assert.equal(commandRows(db).filter(r => r.id === 'resident:migration:v1').length, 1);
    assert.equal(legacy.replay(), legacy.discussionId); assert.equal(legacy.calls(), 0);
    assert.equal(store.read().version, 1); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.deepEqual(vault.get('legacy-account'), { key: 'fixture-credential-only' });
    const message = resident.postMessage(roomId, { text: 'New room original' }, 'new-message');
    store.close(); const reopened = new Store(directory); t.after(() => reopened.close());
    const reader = new ResidentStore(reopened, false); assert.equal(reader.snapshot().rooms[0].id, roomId);
    assert.equal(reader.message(roomId, message.messageId).message.text, 'New room original');
    const enabled = new ResidentStore(reopened, true);
    assert.deepEqual(enabled.postMessage(roomId, { text: 'New room original' }, 'new-message'), message);
    assert.equal(reopened.read().resident.messages.length, 1);
    assert.equal(reopened.transact(() => assert.fail('legacy receipt lost'), { id: 'legacy-create', input: { action: 'create', body: { ...topic, materials: 'Legacy original\n  with spacing' } } }), legacy.discussionId);
    reopened.close();
  });
}

test('flag off preserves resident and unknown fields through legacy writes; reads remain available, fresh writes fail', async t => {
  const { store } = await storage(t); const resident = new ResidentStore(store, true); const roomId = resident.snapshot().rooms[0].id;
  const receipt = resident.postMessage(roomId, { text: 'Persist me' }, 'persist');
  store.transact(s => { s.resident.futureField = { preserved: true }; s.resident.wikiVersions.push({ original: 'future-private-record' }); });
  const before = store.read().resident; store.transact(s => { s.browserPaused = true; });
  const disabled = new ResidentStore(store, false); assert.deepEqual(store.read().resident, before);
  assert.equal(disabled.message(roomId, receipt.messageId).message.text, 'Persist me');
  assert.throws(() => disabled.postMessage(roomId, { text: 'No write' }, 'off-message'), /resident_disabled/);
  assert.throws(() => disabled.control(roomId, { action: 'rename', title: 'No write', expectedVersion: 1 }, 'off-control'), /resident_disabled/);
  assert.deepEqual(disabled.postMessage(roomId, { text: 'Persist me' }, 'persist'), receipt);
  assert.doesNotMatch(JSON.stringify(disabled.snapshot()), /future-private-record|futureField/);
});

test('migration and message event/state/receipt roll back together after SQLite failure', async t => {
  const { store, directory } = await storage(t); const db = new DatabaseSync(join(directory, 'workspace.sqlite')); t.after(() => db.close());
  const before = store.read();
  db.exec("CREATE TRIGGER fail_migration BEFORE INSERT ON commands WHEN NEW.id='resident:migration:v1' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;");
  assert.throws(() => new ResidentStore(store, true), /fixture rollback/);
  assert.deepEqual(store.read(), before); assert.equal(store.cursor(), 0); assert.deepEqual(commandRows(db), []);
  db.exec('DROP TRIGGER fail_migration');
  const resident = new ResidentStore(store, true); const roomId = resident.snapshot().rooms[0].id; const migrated = store.read();
  db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON commands WHEN NEW.id='resident:command:retry' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;");
  assert.throws(() => resident.postMessage(roomId, { text: 'Original' }, 'retry'), /fixture rollback/);
  assert.deepEqual(store.read(), migrated); assert.equal(store.cursor(), 0);
  assert.equal(commandRows(db).filter(r => r.id === 'resident:command:retry').length, 0);
  db.exec('DROP TRIGGER fail_message'); resident.postMessage(roomId, { text: 'Original' }, 'retry');
  assert.equal(store.read().resident.messages.length, 1); assert.equal(store.events(0).length, 1);
});

test('a lost resident state with an existing migration receipt is refused without reseeding', async t => {
  const { store } = await storage(t); new ResidentStore(store, true); store.transact(s => { delete s.resident; });
  const before = store.read(); assert.throws(() => new ResidentStore(store, true), /resident_migration_state_missing/);
  assert.deepEqual(store.read(), before); assert.equal(store.cursor(), 0);
});

test('future and corrupt schemas fail closed before credential/profile setup and release runtime lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-resident-schema-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory); new ResidentStore(store, true); const valid = store.read().resident; store.close();
  const config = loadWorkspaceConfig({ WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome') });
  for (const [resident, error] of [[{ ...valid, schemaVersion: 2 }, /unsupported_resident_schema/], [{ ...valid, rooms: [null] }, /resident_state_invalid/], [{ ...valid, messages: [{}] }, /resident_state_invalid/]]) {
    const writer = new Store(directory); writer.transact(s => { s.resident = resident; }); const before = writer.read(); writer.close();
    for (const residentEnabled of [false, true]) {
      assert.throws(() => new Workspace({ ...config, residentEnabled }), error);
      for (const path of ['runtime.lock', 'access-token', 'credentials', 'chrome']) await assert.rejects(access(join(directory, path)), { code: 'ENOENT' });
      const reader = new Store(directory); assert.deepEqual(reader.read(), before); reader.close();
    }
  }
});
