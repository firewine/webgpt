import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
import { dotTools, dotEventName } from '../dist/server/workspace/dot-mcp-model.js';
import { readDotState } from '../dist/server/workspace/dot-mcp.js';
import { digest } from '../dist/server/workspace/util.js';
import { McpEndpoint } from '../dist/server/http/mcp.js';
import { createWorkspaceServer } from '../dist/server/http/workspace.js';
import { McpWebhook, CallbackError, webhookHeaders, signingKey, challengeMatches } from '../dist/server/connections/mcp-webhook.js';
import { unusedPort } from './helpers.mjs';

const key = () => crypto.randomUUID();
const secret = () => 'whsec_' + randomBytes(32).toString('base64');
const owner = 'fixture-owner-key-for-dot-events-only';
const config = directory => loadWorkspaceConfig({ WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'), WJ_ACCESS_TOKEN: owner, WJ_RESIDENT_ENABLED: 'true' });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-d2-')); let clock = Date.now(); const calls = [];
  const transport = { async post(input) { input.beforeSend(); calls.push(input); const b = JSON.parse(input.body);
    return { status: 200, body: JSON.stringify(b.type === 'verification' ? { challenge: b.challenge } : {}) }; } };
  let app = new Workspace(config(directory), 1, { residentAutoSchedule: false, webhookTransport: transport, eventClock: () => clock });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const roomId = app.store.read().resident.rooms[0].id;
  const binding = app.dotMcp.register({ roomId, label: 'Native dot fixture' }, key());
  const access = app.dotMcp.confirm({ connectionId: binding.connectionId, expectedVersion: 1, ownerConfirmed: true, tools: [...dotTools], expiresAt: new Date(clock + 7 * 86400000 - 5000).toISOString() }, key());
  app.resident.control(roomId, { action: 'set_member', participantId: binding.participantId, enabled: true, expectedVersion: app.resident.room(roomId).room.version }, key());
  const grant = app.dotMcp.authenticate(access.token);
  const args = { roomId, participantId: binding.participantId, connectionId: binding.connectionId };
  const params = { name: dotEventName, arguments: args, delivery: { mode: 'webhook', url: 'https://receiver.example/events/private-callback', secret: secret() } };
  const rpc = (method, params) => new McpEndpoint(app).handle({ jsonrpc: '2.0', id: 1, method, params }, new McpEndpoint(app).grant('Bearer ' + access.token));
  const state = () => app.store.read().dotMcp.events;
  const subscribe = () => app.mcpEvents.handle('events/subscribe', params, grant);
  const prepare = () => app.store.transact(s => {
    const room = s.resident.rooms[0]; room.desiredOn = true; room.pacing = { minIntervalMs: 1000, idleNudgeMs: 60000, passBackoffMs: 60000, sleepAfterPasses: 3 };
    const requestId = key(); const participant = s.participants.find(p => p.id === binding.participantId);
    s.resident.turns.push({ id: requestId, roomId, participantId: participant.id, participant, generation: 1, epoch: room.epoch, status: 'prepared',
      prompt: 'private frozen input must never go to callback', promptDigest: digest('private frozen input must never go to callback'), history: [], basisSequence: 0,
      text: '', receipt: null, reply: null, usage: null, startedAt: new Date(clock).toISOString(), finishedAt: null, error: null, repairOf: null, messageId: null, proposalsStatus: 'none' });
    s.resident.dispatchLeases.push({ id: requestId, ownerKind: 'resident', ownerAttemptId: requestId, participantId: participant.id, generation: 1, roomId, state: 'reserved' }); return requestId;
  });
  const queue = requestId => app.store.transact((s, emit) => app.mcpEvents.queueTurn(s, emit, grant.id, requestId));
  return { get app() { return app; }, set app(value) { app = value; }, directory, transport, calls, roomId, ...binding, access, grant, params, rpc, state, subscribe, prepare, queue,
    advance: ms => { clock += ms; }, get clock() { return clock; } };
}

test('D2 authenticated catalog/handshake, 20 concurrent refreshes, canonical identity and encrypted credentials', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.rpc('initialize')).result.capabilities, { tools: {}, events: {} });
  assert.equal((await f.rpc('events/list')).result.events[0].name, dotEventName);
  assert.deepEqual((await f.rpc('tools/list')).result.tools, []);
  assert.equal((await f.rpc('tools/call', { name: 'dot_turn_submit' })).error.message, 'dot_transport_not_ready');
  const results = await Promise.all(Array.from({ length: 20 }, () => f.subscribe()));
  assert.equal(new Set(results.map(r => r.id)).size, 1); assert.equal(f.state().subscriptions.length, 1); assert.equal(f.calls.length, 1);
  const reordered = { ...f.params, arguments: { connectionId: f.connectionId, participantId: f.participantId, roomId: f.roomId } };
  assert.equal((await f.rpc('events/subscribe', reordered)).result.id, results[0].id);
  assert.equal(f.state().subscriptions[0].credentialRefs.length, 1);
  const db = new DatabaseSync(join(f.directory, 'workspace.sqlite'), { readOnly: true });
  const serialized = JSON.stringify([f.app.snapshot(), f.app.store.read(), f.app.store.events(0), db.prepare('SELECT * FROM commands').all()]); db.close();
  for (const value of [f.params.delivery.secret, f.params.delivery.url, f.access.token]) assert.ok(!serialized.includes(value));
  for (const file of await readdir(join(f.directory, 'credentials'))) if (file.endsWith('.enc')) assert.ok(!(await readFile(join(f.directory, 'credentials', file))).includes(Buffer.from(f.params.delivery.secret)));
  assert.equal((await f.rpc('events/subscribe', { ...f.params, ttlMs: 1200 })).result.refreshBefore, new Date(f.clock + 1200).toISOString());
  assert.equal(f.calls.length, 1); f.advance(1201); await f.app.mcpEvents.pump(); assert.equal(f.state().subscriptions[0].status, 'expired');
  await f.subscribe(); assert.equal(f.calls.length, 2); f.advance(600001); await f.subscribe(); assert.equal(f.calls.length, 3);
});

test('D2 filter/auth/TTL validation never probes an unauthorized destination', async t => {
  const f = await fixture(t); const endpoint = new McpEndpoint(f.app);
  for (const token of [undefined, 'Bearer ' + owner, 'Bearer invalid']) assert.throws(() => endpoint.grant(token), /authentication_required/);
  for (const args of [{ ...f.params.arguments, roomId: 'foreign' }, { ...f.params.arguments, participantId: 'other' }, { ...f.params.arguments, connectionId: 'other' }]) {
    assert.equal((await f.rpc('events/subscribe', { ...f.params, arguments: args })).error.message, 'dot_event_not_in_scope');
  }
  for (const ttlMs of [0, -1, 1.5, '1000']) assert.equal((await f.rpc('events/subscribe', { ...f.params, ttlMs })).error.message, 'invalid_event_ttl');
  assert.equal((await f.rpc('events/subscribe', { ...f.params, delivery: { ...f.params.delivery, secret: 'invalid' } })).error.code, -32015);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.rpc('events/subscribe', { ...f.params, ttlMs: 999999999 })).result.refreshBefore, new Date(f.clock + 86400000).toISOString());
  assert.equal((await f.rpc('events/subscribe', { ...f.params, ttlMs: null })).result.refreshBefore, new Date(f.clock + 3600000).toISOString());
});

for (const reason of ['wrong_challenge', 'redirect', 'timeout', 'vault_failure']) test('D2 challenge does not activate on ' + reason, async t => {
  const f = await fixture(t); f.transport.post = async input => {
    assert.equal(f.state().subscriptions[0].status, 'prepared'); assert.ok(f.app.vault.get(f.state().subscriptions[0].credentialRef));
    if (reason === 'timeout') throw new CallbackError('timeout', true);
    return { status: reason === 'redirect' ? 302 : 200, body: JSON.stringify({ challenge: 'incorrect' }) };
  };
  if (reason === 'vault_failure') f.app.vault.put = () => { throw new Error('private key/URL must not leak'); };
  const result = await f.rpc('events/subscribe', f.params);
  assert.equal(result.error.code, reason === 'vault_failure' ? -32602 : -32015); assert.ok(!JSON.stringify(result).includes('private key'));
  assert.equal(f.state().subscriptions[0].status, 'failed'); assert.throws(() => f.queue(f.prepare()), /subscription_required/);
});

test('D2 secret rotation signs with both keys for five minutes then only the new key', async t => {
  const f = await fixture(t); await f.subscribe(); const oldSecret = f.params.delivery.secret; f.params.delivery.secret = secret();
  const sub = await f.subscribe(); assert.equal(f.calls.length, 2);
  const first = f.queue(f.prepare())[0]; await f.app.mcpEvents.pump(); const sent = f.calls.at(-1);
  assert.deepEqual(sent.secrets, [f.params.delivery.secret, oldSecret]); assert.equal(f.state().outbox[0].status, 'delivered'); assert.equal(f.state().subscriptions[0].cursor, first);
  f.advance(300001); f.queue(f.prepare()); await f.app.mcpEvents.pump(); assert.deepEqual(f.calls.at(-1).secrets, [f.params.delivery.secret]);
  assert.equal((await f.subscribe()).id, sub.id);
});

test('D2 revocation/unsubscribe fences a pending challenge and queued refreshes; unsubscribe is idempotent', async t => {
  const f = await fixture(t); let release; let started;
  const entered = new Promise(resolve => { started = resolve; });
  f.transport.post = input => new Promise(resolve => { release = () => resolve({ status: 200, body: JSON.stringify({ challenge: JSON.parse(input.body).challenge }) }); started(); });
  const first = f.subscribe(); const queued = f.subscribe(); const settled = Promise.allSettled([first, queued]); await entered;
  const p = { ...f.params, delivery: { mode: 'webhook', url: f.params.delivery.url } };
  await f.app.mcpEvents.handle('events/unsubscribe', p, f.grant); release();
  assert.ok((await settled).every(r => r.status === 'rejected')); assert.equal(f.state().subscriptions[0].status, 'revoked');
  const version = f.state().subscriptions[0].version; await f.app.mcpEvents.handle('events/unsubscribe', p, f.grant); assert.equal(f.state().subscriptions[0].version, version);
});

test('D2 outbox requires original dispatch reservation; repeated queue keeps one small event per subscription', async t => {
  const f = await fixture(t); await f.subscribe(); assert.throws(() => f.queue('invented-turn'), /not_reserved/);
  const requestId = f.prepare(); const [eventId] = f.queue(requestId); for (let n = 0; n < 20; n++) assert.deepEqual(f.queue(requestId), [eventId]);
  assert.equal(f.state().outbox.length, 1); const row = f.state().outbox[0]; assert.equal(row.digest, digest(row.body)); assert.ok(!row.body.includes('private frozen input'));
  assert.deepEqual(JSON.parse(row.body).data, { ...f.params.arguments, requestId, status: 'requested' });
  assert.ok(f.app.store.events(0).some(e => e.type === 'dot.event_queued' && e.data.eventId === eventId));
  let attempts = 0; f.transport.post = async input => { input.beforeSend(); const current = f.state().outbox[0]; assert.equal(current.status, 'sending'); assert.equal(current.attempts.length, ++attempts); f.calls.push(input); return { status: attempts === 1 ? 503 : 202, body: '' }; };
  await f.app.mcpEvents.pump(); await f.app.mcpEvents.pump(); assert.equal(attempts, 1); f.advance(1001); await f.app.mcpEvents.pump();
  assert.equal(attempts, 2); assert.equal(f.calls.at(-1).eventId, eventId); assert.equal(f.calls.at(-1).body, f.calls.at(-2).body);
  assert.equal(f.state().outbox[0].status, 'delivered'); assert.equal(f.app.store.read().resident.turns[0].status, 'prepared');
  assert.equal((await f.subscribe()).cursor, eventId); assert.equal((await f.rpc('events/subscribe', { ...f.params, cursor: 'unknown' })).result.truncated, true);
});

for (const code of [410, 413, 302, 400, 401, 500]) test('D2 bounded delivery policy for HTTP ' + code, async t => {
  const f = await fixture(t); await f.subscribe(); f.queue(f.prepare()); let count = 0;
  f.transport.post = async () => { count++; return { status: code, body: 'private downstream error' }; };
  for (let i = 0; i < 10; i++) { await f.app.mcpEvents.pump(); f.advance(60000); }
  assert.equal(count, code === 500 ? 5 : 1); assert.equal(f.state().outbox[0].status, 'failed');
  assert.ok(!JSON.stringify(f.app.store.read()).includes('private downstream error'));
});

for (const change of ['off', 'epoch', 'generation', 'grant', 'member', 'turn', 'lease', 'secret']) test('D2 stops before POST when ' + change + ' changes', async t => {
  const f = await fixture(t); await f.subscribe(); f.queue(f.prepare()); const count = f.calls.length;
  if (change === 'secret') f.app.vault.remove(f.state().subscriptions[0].credentialRef);
  else f.app.store.transact(s => { const r = s.resident.rooms[0]; if (change === 'off') r.desiredOn = false; if (change === 'epoch') r.epoch++;
    if (change === 'generation') r.contexts = [{ participantId: f.participantId, generation: 2, history: [], checkpointId: null, lastSeenSequence: 0 }];
    if (change === 'grant') f.app.dotMcp.revokeInState(s, f.connectionId); if (change === 'member') r.members.at(-1).enabled = false;
    if (change === 'turn') s.resident.turns[0].status = 'unconfirmed'; if (change === 'lease') s.resident.dispatchLeases[0].state = 'released'; });
  await f.app.mcpEvents.pump(); assert.equal(f.calls.length, count); assert.equal(f.state().outbox[0].status, 'held');
});

test('D2 late 2xx after revocation remains held and does not advance cursor', async t => {
  const f = await fixture(t); await f.subscribe(); f.queue(f.prepare());
  f.transport.post = async () => { f.app.dotMcp.revoke(f.connectionId, f.grant.version, key()); return { status: 200, body: '' }; };
  await f.app.mcpEvents.pump(); const e = f.state().outbox[0]; assert.equal(e.status, 'held'); assert.equal(e.attempts[0].httpStatus, 200); assert.equal(f.state().subscriptions[0].cursor, null);
});

test('D2 restart preserves cursor and ID, holds pending delivery; refresh cannot replay past a held gap', async t => {
  const f = await fixture(t); const sub = await f.subscribe(); const delivered = f.queue(f.prepare())[0]; await f.app.mcpEvents.pump();
  const pending = f.queue(f.prepare())[0]; await f.app.close();
  f.app = new Workspace(config(f.directory), 1, { residentAutoSchedule: false, webhookTransport: f.transport });
  const calls = f.calls.length; assert.equal((await f.subscribe()).id, sub.id); assert.equal((await f.subscribe()).cursor, delivered);
  assert.equal(f.state().outbox[1].id, pending); assert.equal(f.state().outbox[1].status, 'held');
  f.queue(f.prepare()); await f.app.mcpEvents.pump(); assert.equal(f.calls.length, calls); assert.equal((await f.subscribe()).truncated, true);
  f.app.start(); assert.equal(f.app.store.read().resident.turns.at(-1).status, 'unconfirmed');
});

test('D2 actual SIGKILL during POST keeps attempt uncertainty and never sends on restart', async t => {
  const f = await fixture(t); await f.subscribe(); const requestId = f.prepare(); await f.app.close();
  const source = `import { Workspace } from './dist/server/workspace/runtime.js'; import { loadWorkspaceConfig } from './dist/server/workspace/config.js';
    const config = loadWorkspaceConfig(JSON.parse(process.env.FIXTURE_CONFIG));
    const app = new Workspace(config, 1, { residentAutoSchedule: false, webhookTransport: { post: async () => { process.send('sending'); await new Promise(() => {}); } } });
    app.store.transact((s, emit) => app.mcpEvents.queueTurn(s, emit, process.env.GRANT_ID, process.env.REQUEST_ID)); app.mcpEvents.pump(); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: process.cwd(), env: { ...process.env, FIXTURE_CONFIG: JSON.stringify({ WJ_STATE_DIR: f.directory, WJ_CHROME_PROFILE_DIR: join(f.directory, 'chrome'), WJ_ACCESS_TOKEN: owner, WJ_RESIDENT_ENABLED: 'true' }), GRANT_ID: f.grant.id, REQUEST_ID: requestId }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10000) }); assert.equal(message, 'sending');
  const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
  f.app = new Workspace(config(f.directory), 1, { residentAutoSchedule: false, webhookTransport: f.transport });
  const row = f.state().outbox[0]; assert.equal(row.status, 'held'); assert.equal(row.attempts.length, 1); assert.equal(row.attempts[0].finishedAt, null);
  const calls = f.calls.length; await f.subscribe(); await f.app.mcpEvents.pump(); assert.equal(f.calls.length, calls);
});

test('D2 same /mcp route keeps Host/Origin and bearer boundaries', async t => {
  const f = await fixture(t); const port = await unusedPort(); const origin = `http://127.0.0.1:${port}`;
  f.app.config.port = port; f.app.config.origin = origin;
  const http = await createWorkspaceServer(f.app, () => {}); http.server.listen(port, '127.0.0.1'); await once(http.server, 'listening');
  t.after(async () => { http.closeStreams(); await new Promise(resolve => { http.server.close(resolve); http.server.closeAllConnections(); }); });
  const call = headers => fetch(origin + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + f.access.token, ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'events/list' }) });
  assert.equal((await call({})).status, 200); assert.equal((await call({ Authorization: 'Bearer ' + owner })).status, 401);
  assert.equal((await call({ Origin: 'https://foreign.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const req = request(origin + '/mcp', { method: 'POST', headers: { Host: 'foreign.example', Authorization: 'Bearer ' + f.access.token } }, res => { res.resume(); resolve(res.statusCode); }); req.once('error', reject); req.end(); });
  assert.equal(hostStatus, 403);
});

test('D2 connection deletion removes all rotated secrets but retains event history; unsupported event state fails closed', async t => {
  const f = await fixture(t); await f.subscribe(); f.params.delivery.secret = secret(); await f.subscribe(); f.queue(f.prepare()); await f.app.mcpEvents.pump();
  assert.throws(() => f.app.removeConnection(f.connectionId, key()), /reconciliation_required/);
  f.app.store.transact(s => { s.resident.rooms[0].desiredOn = false; s.resident.turns[0].status = 'completed'; s.resident.dispatchLeases[0].state = 'released'; });
  const original = f.app.store.read().resident;
  const refs = f.state().subscriptions[0].credentialRefs; f.app.removeConnection(f.connectionId, key()); for (const ref of refs) assert.equal(f.app.vault.get(ref), null);
  assert.deepEqual(f.app.store.read().resident, original); assert.equal(f.state().subscriptions[0].status, 'revoked');
  assert.equal(f.state().outbox.length, 1); const state = f.app.store.read(); state.dotMcp.events.version = 99; assert.throws(() => readDotState(state), /events_state_invalid/);
});

for (const boundary of ['prepared', 'missing_secret']) test('D2 recovery does not activate ' + boundary + ' subscription', async t => {
  const f = await fixture(t); await f.subscribe(); const sub = f.state().subscriptions[0];
  if (boundary === 'prepared') f.app.store.transact(s => { s.dotMcp.events.subscriptions[0].status = 'prepared'; }); else f.app.vault.remove(sub.credentialRef);
  await f.app.close(); f.app = new Workspace(config(f.directory), 1, { residentAutoSchedule: false, webhookTransport: f.transport });
  assert.equal(f.state().subscriptions[0].id, sub.id); assert.equal(f.state().subscriptions[0].status, 'failed'); assert.equal(f.calls.length, 1);
  await f.app.mcpEvents.pump(); assert.equal(f.calls.length, 1);
});

test('D2 simultaneous pumps share one POST; refreshed identity cannot bypass pending delivery order', async t => {
  const f = await fixture(t); await f.subscribe(); const first = f.queue(f.prepare())[0]; f.queue(f.prepare());
  let release; f.transport.post = input => new Promise(resolve => { f.calls.push(input); release = () => resolve({ status: 200, body: '' }); });
  const pumps = Array.from({ length: 20 }, () => f.app.mcpEvents.pump()); await Promise.resolve(); assert.equal(f.calls.length, 2);
  await f.subscribe(); assert.equal(f.state().subscriptions[0].cursor, null); assert.equal(f.state().outbox[1].attempts.length, 0);
  release(); await Promise.all(pumps); assert.equal(f.state().subscriptions[0].cursor, first); assert.equal(f.state().outbox[1].attempts.length, 0);
});

test('D2 Standard Webhooks signatures cover exact bytes, timestamp and ID, with rotation and strict keys', () => {
  const keys = [secret(), secret()]; const body = '{"text":"검증"}'; const h = webhookHeaders('sub', 'event', body, keys, 1234000);
  assert.equal(h['webhook-timestamp'], '1234'); assert.equal(h['webhook-id'], 'event'); assert.equal(h['X-MCP-Subscription-Id'], 'sub');
  assert.deepEqual(h['webhook-signature'].split(' '), keys.map(s => 'v1,' + createHmac('sha256', Buffer.from(s.slice(6), 'base64')).update('event.1234.' + body).digest('base64')));
  assert.notEqual(webhookHeaders('sub', 'event', body, keys, 1235000)['webhook-signature'], h['webhook-signature']);
  assert.notEqual(webhookHeaders('sub', 'event', body + ' ', keys, 1234000)['webhook-signature'], h['webhook-signature']);
  for (const bytes of [0, 23, 65]) assert.throws(() => signingKey('whsec_' + randomBytes(bytes).toString('base64')), /Callback/);
  assert.equal(challengeMatches('{"challenge":"same"}', 'same'), true); assert.equal(challengeMatches('{"challenge":"other"}', 'same'), false);
});

const outgoing = () => ({ url: 'https://receiver.example/callback', body: '{"private":"application data"}', subscriptionId: 'sub', eventId: 'event', secrets: [secret()], signal: new AbortController().signal, beforeSend() {} });
for (const address of ['127.0.0.1', '10.0.0.2', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.1.1', '198.18.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::']) test('D2 blocks non-public DNS destination ' + address + ' before any POST', async () => {
  let posts = 0; const client = new McpWebhook(async () => [{ address, family: address.includes(':') ? 6 : 4 }], () => { posts++; throw Error('must not connect'); });
  await assert.rejects(client.post(outgoing()), e => e.reason === 'address_not_allowed'); assert.equal(posts, 0);
});

test('D2 HTTPS URL validation, mixed/private DNS, pinning, TLS hostname and redirects', async () => {
  let resolves = 0; let posts = 0; let captured; const valid = { address: '8.8.8.8', family: 4 };
  const client = new McpWebhook(async () => { resolves++; return [valid]; }, (url, options, callback) => {
    posts++; captured = { url, options }; const req = new EventEmitter(); req.destroy = error => { req.emit('error', error); };
    req.end = () => { const response = new EventEmitter(); response.statusCode = 302; response.headers = { location: 'http://127.0.0.1/private' };
      queueMicrotask(() => { callback(response); response.emit('end'); }); }; return req;
  });
  for (const url of ['http://receiver.example/x', 'https://user:pass@receiver.example/x', 'https://receiver.example:444/x', 'https://receiver.example/x#fragment', 'https://127.0.0.1/x', 'https://2130706433/x', 'https://[::ffff:127.0.0.1]/x']) await assert.rejects(client.post({ ...outgoing(), url }));
  assert.equal(posts, 0);
  const result = await client.post(outgoing()); assert.equal(result.status, 302); assert.equal(posts, 1); assert.equal(resolves, 1);
  assert.equal(captured.url.hostname, 'receiver.example'); assert.equal(captured.options.agent, false); assert.notEqual(captured.options.rejectUnauthorized, false);
  captured.options.lookup('receiver.example', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, valid.address); assert.equal(family, 4); });
  captured.options.lookup('receiver.example', { all: true }, (error, addresses) => assert.deepEqual(addresses, [valid])); assert.equal(resolves, 1);
  const mixed = new McpWebhook(async () => [valid, { address: '10.0.0.1', family: 4 }], () => { throw Error('private destination reached'); });
  await assert.rejects(mixed.post(outgoing()), e => e.reason === 'address_not_allowed');
  await assert.rejects(new McpWebhook(async () => []).post(outgoing()), e => e.reason === 'address_not_allowed');
});

test('D2 checks authorization after DNS, limits response/body, aborts lookup and rechecks DNS every retry', async () => {
  let calls = 0; let posts = 0;
  const client = new McpWebhook(async () => [{ address: ++calls === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }], (_url, _options, callback) => {
    posts++; const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
    req.end = () => queueMicrotask(() => { const r = new EventEmitter(); r.statusCode = 200; callback(r); r.emit('data', Buffer.alloc(16385)); }); return req;
  });
  await assert.rejects(client.post(outgoing()), e => e.reason === 'response_too_large');
  await assert.rejects(client.post(outgoing()), e => e.reason === 'address_not_allowed'); assert.equal(posts, 1);
  await assert.rejects(client.post({ ...outgoing(), body: 'x'.repeat(262145) }), e => e.reason === 'payload_too_large');
  const guard = new McpWebhook(async () => [{ address: '8.8.8.8', family: 4 }], () => { throw Error('POST must not run'); });
  await assert.rejects(guard.post({ ...outgoing(), beforeSend() { throw Error('revoked during DNS'); } }), /revoked during DNS/);
  const abort = new AbortController(); const pending = new McpWebhook(() => new Promise(() => {})).post({ ...outgoing(), signal: abort.signal }); abort.abort();
  await assert.rejects(pending, e => e.reason === 'timeout');
});
