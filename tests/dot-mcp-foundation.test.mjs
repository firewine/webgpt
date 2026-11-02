import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../dist/server/workspace/store.js';
import { Vault } from '../dist/server/workspace/vault.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { DotMcp, readDotState } from '../dist/server/workspace/dot-mcp.js';
import { dotTools } from '../dist/server/workspace/dot-mcp-model.js';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
import { McpEndpoint } from '../dist/server/http/mcp.js';

const key = () => crypto.randomUUID();
const config = directory => loadWorkspaceConfig({ WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'), WJ_ACCESS_TOKEN: 'fixture-owner-key-for-dot-foundation-only', WJ_RESIDENT_ENABLED: 'true' });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-d1-')); const app = new Workspace(config(directory), 1, { residentAutoSchedule: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const roomId = app.store.read().resident.rooms[0].id; const dot = app.dotMcp;
  const binding = dot.register({ roomId, label: 'Native dot fixture', role: '분석' }, 'register');
  const confirmInput = () => ({ connectionId: binding.connectionId, expectedVersion: app.store.read().dotMcp.bindings[0].version, ownerConfirmed: true, tools: [...dotTools], expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const enable = () => app.resident.control(roomId, { action: 'set_member', participantId: binding.participantId, enabled: true, expectedVersion: app.resident.room(roomId).room.version }, key());
  return { app, directory, dot, roomId, ...binding, confirmInput, enable };
}

for (const withRoom of [false, true]) test(`D1 migration preserves legacy ${withRoom ? 'resident' : 'pre-resident'} data, cursor and commands across two opens`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-migration-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let store = new Store(directory); if (withRoom) new ResidentStore(store, true);
  store.transact((s, emit) => { s.connections.push({ id: 'muse', kind: 'browser', label: 'Existing Muse', status: 'connected', models: [], browser: { pageId: 7, url: 'https://example.com/original', discovery: { target: 'dot' } } }); emit({ type: 'existing', discussionId: null, data: { original: true } }); return { receipt: 'original' }; }, { id: 'old-command', input: {} });
  const before = store.read(); const cursor = store.cursor(); const vault = new Vault(join(directory, 'credentials')); vault.put('muse', { private: 'unchanged' });
  for (let i = 0; i < 2; i++) { new DotMcp(store, vault, true); const { dotMcp, ...rest } = store.read(); assert.deepEqual(rest, before); assert.deepEqual(dotMcp.bindings, []); assert.deepEqual(dotMcp.grants, []); assert.equal(store.cursor(), cursor); store.close(); store = new Store(directory); }
  assert.equal(store.readCommand('old-command', {}).result.receipt, 'original'); assert.deepEqual(vault.get('muse'), { private: 'unchanged' }); store.close();
});

test('D1 registration is idempotent, disabled by default; confirmation does not invent native identity/model readiness or leak credentials', async t => {
  const f = await fixture(t); const input = { roomId: f.roomId, label: 'Native dot fixture', role: '분석' };
  for (let i = 0; i < 20; i++) assert.deepEqual(f.dot.register(input, 'register'), { connectionId: f.connectionId, participantId: f.participantId });
  assert.equal(f.app.store.read().dotMcp.bindings.length, 1); assert.equal(f.app.store.read().resident.rooms[0].desiredOn, false);
  assert.throws(() => f.dot.confirm({ ...f.confirmInput(), ownerConfirmed: false }, key()), /confirmation_required/);
  assert.throws(() => f.dot.confirm({ ...f.confirmInput(), nativeActorId: 'claimed-by-caller' }, key()), /invalid_work_fields/);
  const body = f.confirmInput(); const access = f.dot.confirm(body, 'confirm');
  for (let i = 0; i < 20; i++) assert.deepEqual(f.dot.confirm(body, 'confirm'), access);
  assert.throws(() => f.dot.check(f.dot.authenticate(access.token), 'dot_turn_get', f.dot.authenticate(access.token)), /dot_scope_changed/); f.enable();
  const grant = f.dot.authenticate(access.token); f.dot.check(grant, 'dot_turn_get', { roomId: f.roomId, participantId: f.participantId });
  assert.equal(f.dot.snapshot().bindings[0].identity, 'owner_confirmed'); assert.equal(f.dot.snapshot().bindings[0].nativeActorVerified, false); assert.equal(f.dot.snapshot().transportReady, false);
  assert.equal(f.app.store.read().connections[0].status, 'unverified'); assert.deepEqual(f.app.store.read().connections[0].models, []);
  for (const value of [f.app.store.read(), f.app.snapshot(), f.app.store.events(0)]) assert.ok(!JSON.stringify(value).includes(access.token));
  assert.ok(!JSON.stringify(f.app.snapshot()).includes(grant.hash)); const db = new DatabaseSync(join(f.directory, 'workspace.sqlite'), { readOnly: true });
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM commands').all()).includes(access.token)); db.close();
  const encrypted = await readFile(join(f.directory, 'credentials', (await import('node:crypto')).createHash('sha256').update(access.id).digest('hex') + '.enc')); assert.ok(!encrypted.includes(Buffer.from(access.token)));
  assert.equal(new McpEndpoint(f.app).grant('Bearer ' + access.token).kind, 'dot');
  let dispatched = 0; f.app.providers.request = async () => { throw new Error('must not contact another provider'); };
  await assert.rejects(f.app.providers.models(f.connectionId), /dot_transport_not_ready/);
  await assert.rejects(f.app.providers.complete({ participant: f.app.store.read().participants.at(-1), hooks: { dispatched: () => dispatched++ } }), /dot_transport_not_ready/); assert.equal(dispatched, 0);
});

for (const mutation of ['token', 'room', 'actor', 'tool', 'version', 'epoch', 'generation', 'identity', 'disabled', 'deleted', 'expired', 'revoked']) test('D1 denies stale/foreign authority before reads or changes: ' + mutation, async t => {
  const f = await fixture(t); const access = f.dot.confirm(f.confirmInput(), key()); f.enable(); const held = f.dot.authenticate(access.token);
  let scope = { roomId: f.roomId, participantId: f.participantId }; let tool = 'dot_turn_get';
  if (mutation === 'room') scope.roomId = 'foreign-room'; else if (mutation === 'actor') scope.participantId = 'fake-a'; else if (mutation === 'tool') tool = 'resident_message_post';
  else if (mutation !== 'token') f.app.store.transact(s => { const r = s.resident.rooms[0]; const b = s.dotMcp.bindings[0]; const g = s.dotMcp.grants[0];
    if (mutation === 'version') b.version++; if (mutation === 'epoch') r.epoch++; if (mutation === 'generation') r.contexts = [{ participantId: f.participantId, generation: 2, history: [], checkpointId: null, lastSeenSequence: 0 }];
    if (mutation === 'identity') s.participants.at(-1).connectionId = 'foreign-connection'; if (mutation === 'disabled') r.members.at(-1).enabled = false;
    if (mutation === 'deleted') s.connections = []; if (mutation === 'expired') g.expiresAt = new Date(0).toISOString(); if (mutation === 'revoked') g.status = 'revoked'; });
  const state = f.app.store.read(); const cursor = f.app.store.cursor();
  assert.throws(() => mutation === 'token' ? f.dot.authenticate(access.token + 'tampered') : f.dot.check(held, tool, scope), /authentication_required|dot_scope_changed/);
  assert.deepEqual(f.app.store.read(), state); assert.equal(f.app.store.cursor(), cursor);
});

test('D1 re-pairing rotates and fences grants; deletion preserves snapshots and retries encrypted cleanup after interruption', async t => {
  const f = await fixture(t); const first = f.dot.confirm(f.confirmInput(), key()); f.enable(); const old = f.dot.authenticate(first.token);
  const second = f.dot.confirm(f.confirmInput(), key()); assert.notEqual(first.token, second.token); assert.throws(() => f.dot.authenticate(first.token), /authentication_required/); assert.throws(() => f.dot.check(old, 'dot_turn_get', old), /authentication_required/);
  f.dot.authenticate(second.token); const before = f.app.store.read(); const remove = f.app.vault.remove.bind(f.app.vault); f.app.vault.remove = () => { throw new Error('fixture unavailable'); };
  assert.throws(() => f.app.removeConnection(f.connectionId, 'delete'), /connection_cleanup_failed/); assert.throws(() => f.dot.authenticate(second.token), /authentication_required/);
  f.app.vault.remove = remove; f.app.removeConnection(f.connectionId, 'delete'); assert.equal(f.app.vault.get(first.id), null); assert.equal(f.app.vault.get(second.id), null);
  assert.deepEqual(f.app.store.read().participants, before.participants); assert.deepEqual(f.app.store.read().resident, before.resident); assert.deepEqual(f.app.store.read().connectionCleanup, []);
});

for (const phase of ['before_file', 'after_file', 'after_activation']) test('D1 actual SIGKILL at DB/vault boundary: ' + phase, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-crash-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const script = `import {Workspace} from './dist/server/workspace/runtime.js';
    const app=new Workspace(${JSON.stringify(config(directory))},1,{residentAutoSchedule:false}); const roomId=app.store.read().resident.rooms[0].id;
    const binding=app.dotMcp.register({roomId,label:'Crash fixture'},'register'); const put=app.vault.put.bind(app.vault); const transact=app.store.transact.bind(app.store);
    app.vault.put=(...args)=>{if(process.env.WJ_D1_CRASH==='before_file')process.kill(process.pid,'SIGKILL');put(...args);if(process.env.WJ_D1_CRASH==='after_file')process.kill(process.pid,'SIGKILL');};
    app.store.transact=(...args)=>{const result=transact(...args);if(process.env.WJ_D1_CRASH==='after_activation'&&app.store.read().dotMcp.grants.some(g=>g.status==='active'))process.kill(process.pid,'SIGKILL');return result;};
    app.dotMcp.confirm({connectionId:binding.connectionId,expectedVersion:1,ownerConfirmed:true,tools:['dot_turn_get'],expiresAt:new Date(Date.now()+3600000).toISOString()},'confirm');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, WJ_D1_CRASH: phase }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c); const [code, signal] = await once(child, 'close'); assert.equal(code, null, output); assert.equal(signal, 'SIGKILL'); assert.doesNotMatch(output, /"token"|Bearer|dot_grant_/);
  const app = new Workspace(config(directory), 1, { residentAutoSchedule: false });
  try { const state = app.store.read(); assert.equal(state.dotMcp.grants[0].status, phase === 'after_activation' ? 'active' : 'revoked'); assert.equal(app.dotMcp.snapshot().grants[0].active, phase === 'after_activation'); assert.equal(state.connections[0].status, 'unverified'); assert.equal(state.resident.rooms[0].desiredOn, false); }
  finally { await app.close(); }
});

test('D1 missing credential is revoked on recovery, malformed/future state fails before use, flag off grants no access', async t => {
  const f = await fixture(t); const access = f.dot.confirm(f.confirmInput(), key()); f.enable(); f.app.vault.remove(access.id);
  new DotMcp(f.app.store, f.app.vault, true); assert.equal(f.app.store.read().dotMcp.grants[0].status, 'revoked'); assert.throws(() => f.dot.authenticate(access.token), /authentication_required/);
  assert.throws(() => new DotMcp(f.app.store, f.app.vault, false).register({ roomId: f.roomId, label: 'must not register' }, key()), /dot_disabled/);
  const state = f.app.store.read();
  for (const change of [s => s.dotMcp.schemaVersion = 2, s => s.dotMcp.bindings[0].nativeActorVerified = true, s => s.dotMcp.grants[0].tools = ['codex_send'], s => s.dotMcp.grants.push(s.dotMcp.grants[0]), s => delete s.dotMcp]) {
    const bad = structuredClone(state); change(bad); assert.throws(() => readDotState(bad), /dot_schema|dot_state/);
  }
});

test('D1 owner revoke is idempotent and an old confirm command cannot reactivate it', async t => {
  const f = await fixture(t); const body = f.confirmInput(); const access = f.dot.confirm(body, 'confirm'); f.enable();
  const version = f.app.store.read().dotMcp.bindings[0].version;
  assert.throws(() => f.dot.revoke(f.connectionId, version - 1, 'wrong-version'), /version_conflict/);
  for (let i = 0; i < 20; i++) f.dot.revoke(f.connectionId, version, 'revoke');
  assert.equal(f.app.store.events(0).filter(e => e.type === 'dot.revoked').length, 1); assert.throws(() => f.dot.confirm(body, 'confirm'), /grant_not_ready/);
  assert.throws(() => f.dot.authenticate(access.token), /authentication_required/); assert.equal(f.app.store.read().dotMcp.bindings[0].version, version + 1);
});

test('D1 startup rejects a future namespace without changing legacy state or leaving the runtime locked', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-future-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory); store.transact(s => { s.dotMcp = { schemaVersion: 99 }; }); const before = store.read(); store.close();
  assert.throws(() => new Workspace(config(directory)), /unsupported_dot_schema/);
  const reopened = new Store(directory); assert.deepEqual(reopened.read(), before); assert.equal(reopened.cursor(), 0); reopened.close();
});
