import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceFixture } from './codex-oauth-fixture.mjs';
import { until, topic } from './workspace-helpers.mjs';
import { readCodexJson } from '../dist/server/connections/codex-oauth.js';

test('Codex device: twenty identical starts and concurrent reopens retain one grant, one poll, signed account and an encrypted credential', async t => {
  const f = await deviceFixture(t, { poll: [403, 404, 200] }); const body = { label: 'Alice', expectedEmail: 'alice@example.test' };
  const starts = await Promise.all(Array.from({ length: 20 }, () => f.app.codexOAuth.begin(body, 'same-start'))); assert.ok(starts.every(s => JSON.stringify(s) === JSON.stringify(starts[0]))); assert.equal(f.grants.length, 1); assert.equal(f.gates.length, 1);
  const a = starts[0]; const reopened = await f.app.codexOAuth.begin({ ...body, connectionId: a.connectionId }, 'reopen'); assert.deepEqual(reopened, a); assert.equal(f.grants.length, 1);
  assert.deepEqual(await f.app.codexOAuth.begin(body, 'reopen-without-id'), a); assert.equal(f.grants.length, 1); assert.equal(f.app.store.read().connections.length, 1);
  assert.equal(JSON.stringify(f.app.snapshot()).includes('TEST-'), false); assert.equal(JSON.stringify(f.app.store.read()).includes('fixture-verifier'), false);
  for (let n = 0; n < 3; n++) await f.release(); await until(() => f.app.codexOAuth.status(a.connectionId).status === 'completed'); const c = f.app.store.read().connections[0]; assert.equal(c.email, 'alice@example.test'); assert.equal(c.accountId, 'account-alice'); assert.equal(c.subject, 'alice'); assert.equal(c.kind, 'codex-oauth'); assert.equal((await f.app.codexOAuth.access(c.id)).token, 'fixture-access-alice'); assert.ok(!JSON.stringify(f.app.store.read()).includes('fixture-access')); assert.equal(f.app.codexOAuth.status(c.id).userCode, undefined);
});

test('Codex device: two separate accounts discover their own models and complete a structured discussion via the original engine', async t => {
  const f = await deviceFixture(t); const members = [];
  for (const name of ['alice', 'bob']) { const a = await f.signin(name); await f.app.refreshModels(a.connectionId); const c = f.app.store.read().connections.find(c => c.id === a.connectionId); assert.equal(c.models.length, 1); assert.equal(c.models[0].id, 'gpt-fixture-' + name); members.push(f.app.participant({ connectionId: c.id, modelId: c.models[0].id, label: name, reasoningEffort: 'xhigh' })); }
  assert.notEqual(f.app.vault.get(f.app.store.read().connections[0].id).accessToken, f.app.vault.get(f.app.store.read().connections[1].id).accessToken);
  const did = f.app.engine.create({ ...topic, participantIds: members, limits: { maxRequests: 20, maxRounds: 1, maxVerificationTasks: 0 } }, 'device-topic'); await until(() => ['completed', 'partial', 'blocked'].includes(f.app.store.read().discussions[0].status), 15000);
  const d = f.app.store.read().discussions[0]; assert.equal(d.id, did); assert.equal(d.status, 'completed'); assert.ok(d.turns.every(t => t.status === 'completed' && t.receipt && t.usage.input === 12 && t.usage.output === 34 && t.reasoningEffort === 'xhigh')); assert.equal(f.app.store.read().jobs.length, 0); assert.ok(f.resource.every(r => r.url.startsWith('https://chatgpt.com/backend-api/codex/'))); assert.ok(f.resource.filter(r => r.url.endsWith('/responses')).some(r => JSON.parse(r.options.body).input.some(m => m.role === 'assistant')));
});

for (const mismatch of ['email', 'subject', 'badAudience', 'badSignature', 'accountId']) test('Codex device identity: ' + mismatch + ' cannot replace a saved account or store an unverified credential', async t => {
  const f = await deviceFixture(t); const a = await f.signin('alice'); const before = f.app.vault.get(a.connectionId); const c = f.app.store.read().connections[0];
  Object.assign(f.controls, { [mismatch]: mismatch === 'email' ? 'other@example.test' : mismatch === 'accountId' || mismatch === 'subject' ? 'other-account' : true });
  const retry = await f.app.codexOAuth.begin({ label: 'Alice', expectedEmail: c.expectedEmail, connectionId: c.id }, 'reauth'); await f.release(); await until(() => f.app.codexOAuth.status(c.id).status === 'failed'); assert.notEqual(retry.attemptId, a.attemptId); assert.deepEqual(f.app.vault.get(c.id), before); assert.equal(f.app.store.read().connections[0].subject, 'alice');
});

test('Codex device: expiry/cancel/stale query and unknown prior request never start a replacement grant or save a late result', async t => {
  const f = await deviceFixture(t); const a = await f.app.codexOAuth.begin({ label: 'Alice', expectedEmail: 'alice@example.test' }, 'expires'); f.advance(900_001); await f.release(); await until(() => f.app.codexOAuth.status(a.connectionId).status === 'expired'); assert.equal(f.app.vault.get(a.connectionId), null);
  const b = await f.app.codexOAuth.begin({ label: 'Alice', expectedEmail: 'alice@example.test', connectionId: a.connectionId }, 'cancel'); f.app.codexOAuth.cancel(b.connectionId, b.attemptId); await until(() => f.app.codexOAuth.status(b.connectionId).status === 'cancelled'); assert.equal(f.app.vault.get(b.connectionId), null); assert.equal(f.app.codexOAuth.status(b.connectionId, a.attemptId).status, 'interrupted'); assert.throws(() => f.app.codexOAuth.cancel(b.connectionId, a.attemptId), /device_login_not_pending/);
  f.app.codexOAuth.attempts.clear(); await assert.rejects(f.app.codexOAuth.begin({ label: 'Alice', expectedEmail: 'alice@example.test', connectionId: a.connectionId }, 'cancel'), /device_login_interrupted/); assert.equal(f.grants.length, 2);
});

test('Codex device refresh: account-specific serialization rotates once; transient failures preserve credentials and explicit logout affects one account', async t => {
  const f = await deviceFixture(t, { expiresIn: 5 }); const a = await f.signin('alice'), b = await f.signin('bob');
  f.controls.expiresIn = 3600; const tokens = await Promise.all([f.app.codexOAuth.access(a.connectionId), f.app.codexOAuth.access(a.connectionId)]); assert.equal(tokens[0].token, tokens[1].token); assert.equal(f.refreshes(), 1);
  const old = f.app.vault.get(b.connectionId); f.controls.refreshStatus = 503; await assert.rejects(f.app.codexOAuth.access(b.connectionId), /codex_refresh_failed/); assert.deepEqual(f.app.vault.get(b.connectionId), old); assert.equal(f.app.store.read().connections.find(c => c.id === b.connectionId).status, 'connected');
  await f.app.codexOAuth.signOut(a.connectionId); assert.equal(f.app.vault.get(a.connectionId), null); assert.deepEqual(f.app.vault.get(b.connectionId), old);
});

for (const stop of ['cancel', 'close']) test('Codex device ' + stop + ' after the grant/token arrived fences the late verified identity before credential publication', async t => {
  const f = await deviceFixture(t); const identity = f.app.oauth.identity.bind(f.app.oauth); let release;
  f.app.oauth.identity = async (...args) => { const value = await identity(...args); await new Promise(r => { release = r; }); return value; };
  const a = await f.app.codexOAuth.begin({ label: 'Alice', expectedEmail: 'alice@example.test' }, 'late-identity'); await f.release(); await until(() => release); const closing = stop === 'close' ? f.app.codexOAuth.close() : Promise.resolve(f.app.codexOAuth.cancel(a.connectionId, a.attemptId)); release(); await closing; await f.app.codexOAuth.attempts.get(a.connectionId).run;
  assert.equal(f.app.vault.get(a.connectionId), null); if (stop === 'cancel') assert.equal(f.app.codexOAuth.status(a.connectionId).status, 'cancelled'); assert.equal(f.app.store.read().connections[0].subject, undefined);
});

test('Codex device provider: unsupported effort, missing observed version and incomplete stream fail without fallback or a second send', async t => {
  const f = await deviceFixture(t); const a = await f.signin('alice'); await f.app.refreshModels(a.connectionId); const c = f.app.store.read().connections[0];
  assert.throws(() => f.app.participant({ connectionId: c.id, modelId: c.models[0].id, label: 'No medium', reasoningEffort: 'medium' }), /reasoning_effort_not_supported/);
  const id = f.app.participant({ connectionId: c.id, modelId: c.models[0].id, label: 'Alice', reasoningEffort: 'xhigh' }); const p = f.app.store.read().participants.find(p => p.id === id); const hooks = { dispatched() {}, receipt() {}, delta() {} }; f.controls.streamComplete = false;
  await assert.rejects(f.app.providers.complete({ requestId: 'incomplete', participant: p, prompt: 'Fixture', history: [], signal: AbortSignal.timeout(1000), hooks }), /stream_unconfirmed/); assert.equal(f.resource.filter(r => r.url.endsWith('/responses')).length, 1);
  f.app.providers.codexVersion = async () => ''; const count = f.resource.length; await assert.rejects(f.app.providers.models(c.id), /codex_version_required/); assert.equal(f.resource.length, count);
});

test('Codex device owner endpoints require owner/Origin and email; regular GPT and private device details are not interchangeable', async t => {
  const f = await deviceFixture(t);
  assert.equal((await fetch(f.url + '/api/connections/codex-oauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await f.api('/api/connections/codex-oauth', { label: 'No email' })).status, 400);
  assert.equal((await f.api('/api/connections/codex-oauth', { label: 'Alice', expectedEmail: 'alice@example.test' }, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  const result = await (await f.api('/api/connections/codex-oauth', { label: 'Alice', expectedEmail: 'alice@example.test' })).json(); assert.equal(result.status, 'pending'); assert.equal((await fetch(f.url + '/api/connections/' + result.connectionId + '/device-signin')).status, 401);
  assert.equal((await f.api('/api/connections/oauth', { label: 'Wrong kind', expectedEmail: 'alice@example.test', connectionId: result.connectionId })).status, 404); assert.ok(!(await (await f.api('/api/state')).text()).includes('TEST-')); assert.equal(f.resource.length, 0);
});

test('Codex device poll: 401, 429 and 5xx terminate their original attempts without another grant or model fallback', async t => {
  for (const status of [401, 429, 503]) {
    const f = await deviceFixture(t, { poll: [status] }); const a = await f.app.codexOAuth.begin({ label: 'Alice', expectedEmail: 'alice@example.test' }, 'poll-failure'); await f.release(); await until(() => f.app.codexOAuth.status(a.connectionId).status === 'failed');
    assert.equal(f.grants.length, 1); assert.equal(f.resource.length, 0); assert.equal(f.gates.length, 0); assert.equal(f.app.vault.get(a.connectionId), null); assert.equal(f.auth.filter(r => r.url.endsWith('/deviceauth/token')).length, 1);
  }
});

test('Codex device JSON boundary rejects oversized, malformed and non-object responses without retaining provider prose', async () => {
  await assert.rejects(readCodexJson(new Response('x'.repeat(65537))), /oauth_response_too_large/);
  for (const body of ['[]', 'null', '{']) await assert.rejects(readCodexJson(new Response(body)));
});
