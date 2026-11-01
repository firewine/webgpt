import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { AppError } from '../dist/server/workspace/util.js';
import { workspace, until, topic, response } from './workspace-helpers.mjs';
import { deviceFixture } from './codex-oauth-fixture.mjs';
import { budget, pacing } from './resident-fixture.mjs';
import { unusedPort } from './helpers.mjs';

const connection = { id: 'remove-me', kind: 'deepseek', apiService: 'coralbricks', label: 'Disposable fixture', status: 'connected', models: [{ id: 'deepseek-fixture', label: 'Fixture' }] };
function seed(f) { f.app.store.transact(s => { s.connections.push(connection, { ...connection, id: 'keep-me', label: 'Other account' }); s.participants.push({ id: 'real-participant', kind: 'deepseek', connectionId: connection.id, modelId: 'deepseek-fixture', label: 'Historical talker', role: '' }); }); f.app.vault.put(connection.id, { key: 'removed-fixture-key' }); f.app.vault.put('keep-me', { key: 'other-fixture-key' }); }
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('owner-only idempotent removal deletes just the selected local credential and keeps participant/history snapshots', async t => {
  const f = await workspace(t); seed(f); const before = f.app.store.read();
  const anonymous = await fetch(f.url + '/api/connections/remove-me/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.url }, body: '{}' }); assert.equal(anonymous.status, 401);
  const login = await fetch(f.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.url }, body: JSON.stringify({ token: 'fixture-only-private-owner-access-key-123456' }) }); const cookie = login.headers.get('set-cookie').split(';')[0];
  const denied = await fetch(f.url + '/api/connections/remove-me/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://untrusted.example' }, body: '{}' }); assert.equal(denied.status, 403); assert.equal(f.app.store.read().connections.length, 2);
  const malformed = await f.api('/api/connections/remove-me/remove', { force: true }); assert.equal(malformed.status, 400);
  const removed = await Promise.all(Array.from({ length: 20 }, () => f.api('/api/connections/remove-me/remove', {}, { headers: { 'Idempotency-Key': 'same-removal' } }))); assert.ok(removed.every(r => r.status === 200));
  assert.deepEqual(f.app.store.read().connections, [before.connections[1]]); assert.deepEqual(f.app.store.read().participants, before.participants); assert.deepEqual(f.app.store.read().discussions, before.discussions);
  assert.equal(f.app.vault.get(connection.id), null); assert.equal(f.app.vault.get('keep-me').key, 'other-fixture-key'); assert.deepEqual(f.app.store.read().connectionCleanup, []);
  assert.equal(f.app.store.events(0).filter(e => e.type === 'connection.removed').length, 1); assert.equal(f.app.store.events(0).filter(e => e.type === 'connection.credentials_removed').length, 1);
  assert.equal((await f.api('/api/connections/remove-me/models', {})).status, 404); assert.equal((await f.api('/api/connections/remove-me/credential', { key: 'replacement' })).status, 404);
});

test('active topic refuses removal, while a completed real engine flow retains every original turn/context after removal', async t => {
  const f = await workspace(t); seed(f); let hold = true;
  f.app.providers.complete = async input => { input.hooks.dispatched(); if (hold) await until(() => !hold); return { text: response(input.prompt, input.participant), receipt: 'fixture-result', usage: null }; };
  const id = f.app.engine.create({ ...topic, participantIds: ['fake-a', 'real-participant'] }, 'historical-topic');
  assert.throws(() => f.app.removeConnection(connection.id, 'active-delete'), /connection_in_use|reconciliation_required/); assert.ok(f.app.vault.get(connection.id)); hold = false;
  await until(() => f.app.discussion(id).discussion.status === 'completed', 10000); const before = f.app.discussion(id).discussion; assert.ok(before.turns.some(t => t.text.length && t.participantId === 'real-participant'));
  f.app.removeConnection(connection.id, 'finished-delete'); assert.deepEqual(f.app.discussion(id).discussion, before); assert.equal(f.app.store.read().participants.find(p => p.id === 'real-participant').connectionId, connection.id);
});

test('room-on and an unresolved dispatched turn both block removal; off never silently discards the uncertain response', async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); seed(f); const room = f.app.resident.snapshot().rooms[0].id;
  const control = input => f.app.resident.control(room, { ...input, expectedVersion: f.app.resident.room(room).room.version }, crypto.randomUUID());
  f.app.configureApiDaily({ expectedVersion: 0, maxRequests: 100, maxTokens: 1000000 }, 'fixture-api-policy');
  control({ action: 'configure', budgets: budget(Date.now()), pacing }); control({ action: 'set_member', participantId: 'real-participant', enabled: true }); control({ action: 'on' });
  assert.throws(() => f.app.removeConnection(connection.id, 'room-on'), /connection_in_use/);
  f.app.providers.complete = async input => { input.hooks.dispatched(); throw new AppError('send_unconfirmed', 502, true); }; await f.app.residentRunner.tick();
  assert.equal(f.app.store.read().resident.turns[0].status, 'unconfirmed'); control({ action: 'off' });
  assert.throws(() => f.app.removeConnection(connection.id, 'room-off-uncertain'), /reconciliation_required/); assert.ok(f.app.vault.get(connection.id)); assert.equal(f.app.store.read().resident.turns[0].status, 'unconfirmed');
});

test('a model result arriving after deletion cannot recreate a connection or its credential', async t => {
  const f = await workspace(t); seed(f); const done = gate(); let started = false;
  f.app.providers.request = async () => { started = true; await done.promise; return Response.json({ data: [{ id: 'deepseek-fixture' }] }); };
  const pending = assert.rejects(f.app.refreshModels(connection.id), /connection_not_found/); await until(() => started); f.app.removeConnection(connection.id, 'during-catalog'); done.resolve(); await pending;
  assert.equal(f.app.store.read().connections.some(c => c.id === connection.id), false); assert.equal(f.app.vault.get(connection.id), null);
});

test('ordinary OAuth callback, pending authorization and refresh cannot restore deleted credentials', async t => {
  const f = await workspace(t, { oauthPort: await unusedPort() }); const done = gate(); let verifying = false;
  f.app.oauth.request = async () => Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', id_token: 'fixture-id', token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' });
  f.app.oauth.identity = async () => { verifying = true; await done.promise; return { sub: 'fixture-subject', email: 'alice@example.test' }; };
  const a = await f.app.oauth.begin('Alice', undefined, 'alice@example.test'); const params = new URLSearchParams({ state: new URL(a.authorizationUrl).searchParams.get('state'), code: 'fixture-code', client_id: 'fixture-client' });
  const finishing = assert.rejects(f.app.oauth.finish(params), /connection_not_found/); await until(() => verifying); f.app.removeConnection(a.connectionId, 'during-identity'); done.resolve(); await finishing;
  assert.equal(f.app.vault.get(a.connectionId), null); assert.equal(f.app.store.read().connections.length, 0); await assert.rejects(f.app.oauth.finish(params), /invalid_oauth_state/);
  const b = await f.app.oauth.begin('Pending', undefined, 'pending@example.test'); f.app.removeConnection(b.connectionId, 'pending-auth'); await assert.rejects(f.app.oauth.finish(new URLSearchParams({ state: new URL(b.authorizationUrl).searchParams.get('state') })), /invalid_oauth_state/);
  const refresh = gate(); let refreshing = false; f.app.store.transact(s => s.connections.push({ id: 'refreshing', kind: 'openai-oauth', label: 'Refreshing', models: [], status: 'connected', clientId: 'fixture-client', subject: 'fixture-subject' })); f.app.vault.put('refreshing', { clientId: 'fixture-client', subject: 'fixture-subject', accessToken: 'fixture-old', refreshToken: 'fixture-refresh', idToken: 'fixture-id', expiresAt: 0, scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'] });
  f.app.oauth.request = async () => { refreshing = true; await refresh.promise; return Response.json({ access_token: 'fixture-new', token_type: 'Bearer', expires_in: 3600 }); };
  const access = assert.rejects(f.app.oauth.access('refreshing'), /auth_required/); await until(() => refreshing); f.app.removeConnection('refreshing', 'during-refresh'); refresh.resolve(); await access; assert.equal(f.app.vault.get('refreshing'), null);
});

test('Codex device approval arriving after removal is fenced even after signature verification started', async t => {
  const f = await deviceFixture(t); const done = gate(); let verifying = false; const original = f.app.oauth.identity.bind(f.app.oauth);
  f.app.oauth.identity = async (...args) => { const value = await original(...args); verifying = true; await done.promise; return value; };
  const a = await f.app.codexOAuth.begin({ label: 'Alice', expectedEmail: 'alice@example.test' }, 'begin'); await f.release(); await until(() => verifying);
  const run = f.app.codexOAuth.attempts.get(a.connectionId).run; f.app.removeConnection(a.connectionId, 'during-device-identity'); done.resolve(); await run;
  assert.equal(f.app.vault.get(a.connectionId), null); assert.equal(f.app.store.read().connections.length, 0); assert.equal(f.grants.length, 1); assert.equal(f.resource.length, 0);
});

test('Codex refresh arriving after removal cannot recreate the per-account vault file', async t => {
  const f = await deviceFixture(t, { expiresIn: 5 }); const a = await f.signin('alice'); const done = gate(); let refreshing = false; const original = f.app.codexOAuth.request;
  f.app.codexOAuth.request = async (url, options) => { if (options.body?.get?.('grant_type') === 'refresh_token') { refreshing = true; await done.promise; } return original(url, options); };
  const access = assert.rejects(f.app.codexOAuth.access(a.connectionId), /connection_not_found/); await until(() => refreshing); f.app.removeConnection(a.connectionId, 'during-device-refresh'); done.resolve(); await access; assert.equal(f.app.vault.get(a.connectionId), null); assert.equal(f.app.store.read().connections.length, 0);
});

for (const stage of ['before_commit', 'after_commit']) test('SIGKILL ' + stage + ': deletion recovery preserves committed history and cleans only the selected credential before dispatch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-remove-crash-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['tests/fixtures/connection-removal-crash.mjs', directory, stage], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; }); const [code, signal] = await once(child, 'exit'); assert.equal(signal, 'SIGKILL', output); assert.equal(code, null);
  const config = { stateDir: directory, origin: 'http://127.0.0.1:3999', accessToken: 'fixture-only-private-owner-access-key-123456', turnTimeoutMs: 5000, chromeCommand: null, codexCommand: ['codex', 'app-server'], workspaceRoots: [], noVncPort: null, sourceFetch: false, oauthPort: 1455, chromeProfileDir: join(directory, 'chrome'), materialRoots: [], residentEnabled: false };
  const app = new Workspace(config, 1, { residentAutoSchedule: false }); try { const exists = stage === 'before_commit'; assert.equal(app.store.read().connections.some(c => c.id === 'remove-me'), exists); assert.equal(app.vault.get('remove-me') !== null, exists); assert.equal(app.vault.get('keep-me').key, 'other-fixture-key'); assert.equal(app.store.read().participants.find(p => p.id === 'historical').label, 'Original talker'); assert.deepEqual(app.store.read().connectionCleanup ?? [], []); assert.equal(app.store.read().jobs.length, 0); } finally { await app.close(); }
});
