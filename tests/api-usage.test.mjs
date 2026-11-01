import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { apiDay, nextApiDay, ensureApiUsage, validateApiUsage, apiUsageSummary, configureApiUsage, apiDailyReason, reserveApiUsage, claimApiUsage, settleApiUsage } from '../dist/server/workspace/api-usage.js';
import { budgetReason, toolBudgetReason } from '../dist/server/workspace/dispatch.js';
import { residentFixture, reply, pacing } from './resident-fixture.mjs';
import { workspace, until, response, topic } from './workspace-helpers.mjs';
import { browserPresets } from '../dist/server/connections/browser-discovery.js';
import { bridgeWithObservation } from './browser-discovery-fixture.mjs';
import { workFixture } from './work-fixture.mjs';
import { FakeResidentCompletion } from '../dist/server/workspace/resident-fake.js';
import { setTimeout as delay } from 'node:timers/promises';
import { digest } from '../dist/server/workspace/util.js';

const apiMember = (id = 'api', kind = 'deepseek') => ({ id, kind, connectionId: id + '-connection', modelId: 'fixture', label: id, role: '' });
const gpt = apiMember('gpt', 'codex-oauth');
const epoch = Date.parse('2026-11-01T23:59:59+09:00');
function policy(s, clock = Date.now(), fields = {}) { return configureApiUsage(s, { expectedVersion: s.apiUsage?.version ?? 0, maxRequests: 2, maxTokens: 100, ...fields }, clock); }
function sent(s, m, id, clock, usage = null) {
  assert.equal(reserveApiUsage(s, m, id, undefined, clock), null); assert.equal(claimApiUsage(s, m, id, undefined, clock), null); settleApiUsage(s, id, usage, null, false, clock);
}
async function configured(t, options = {}) {
  const f = await residentFixture(t, { configure: false, ...options });
  f.store.transact(s => { for (const p of [apiMember(), gpt, apiMember('web', 'browser')]) { s.participants.push(p); s.connections.push({ id: p.connectionId, kind: p.kind, label: p.id, models: [{ id: 'fixture', label: 'fixture' }], status: 'connected' }); } });
  f.control({ action: 'configure', budgetMode: 'api-daily', pacing });
  for (const participantId of options.members ?? ['api', 'gpt']) f.control({ action: 'set_member', participantId, enabled: true });
  f.control({ action: 'on' }); f.advance(); return f;
}

test('daily quota uses KST dispatch day; reservations cross midnight, late usage stays with original day', () => {
  const s = { discussions: [], connections: [], participants: [] }, p = apiMember(); policy(s, epoch);
  assert.equal(apiDay(epoch), '2026-11-01'); assert.equal(nextApiDay(epoch), epoch + 1000);
  assert.equal(reserveApiUsage(s, p, 'midnight', undefined, epoch), null);
  assert.equal(apiUsageSummary(s, epoch).used.reserved, 1);
  assert.equal(claimApiUsage(s, p, 'midnight', undefined, epoch + 1000), null);
  settleApiUsage(s, 'midnight', { input: 60, output: 50 }, null, false, epoch + 86_400_000);
  assert.equal(apiUsageSummary(s, epoch).used.requests, 0); assert.equal(apiUsageSummary(s, epoch + 1000).used.inputTokens, 60);
  assert.equal(apiDailyReason(s, p, epoch + 1000), 'api_daily_exhausted'); assert.equal(apiDailyReason(s, p, epoch + 86_401_000), null);
  assert.equal(s.apiUsage.entries[0].day, '2026-11-02'); validateApiUsage(s);
});

test('shared finite API quota counts uncertain dispatch, refunds only unsent slots, excludes GPT/browser and refuses duplicates', () => {
  const s = { discussions: [] }, p = apiMember(); policy(s, epoch);
  assert.equal(reserveApiUsage(s, p, 'not-sent', undefined, epoch), null); settleApiUsage(s, 'not-sent', null, 'auth_required', false, epoch);
  sent(s, p, 'first', epoch); assert.equal(reserveApiUsage(s, apiMember('anthropic', 'anthropic'), 'second', undefined, epoch), null);
  assert.equal(reserveApiUsage(s, p, 'third', undefined, epoch), 'api_daily_exhausted');
  assert.equal(claimApiUsage(s, apiMember('anthropic', 'anthropic'), 'second', undefined, epoch), null); settleApiUsage(s, 'second', null, 'timeout', true, epoch);
  for (const kind of ['openai-oauth', 'codex-oauth', 'browser', 'fake']) { const free = apiMember(kind, kind); assert.equal(reserveApiUsage(s, free, kind, undefined, epoch), null); assert.equal(apiDailyReason(s, free, epoch), null); }
  assert.deepEqual(apiUsageSummary(s, epoch).used, { requests: 2, reserved: 0, inputTokens: 0, outputTokens: 0, unknownUsage: 2 });
  settleApiUsage(s, 'second', { input: 10, output: 20 }, null, false, epoch + 1000); settleApiUsage(s, 'second', null, null, false, epoch + 2000);
  assert.equal(apiUsageSummary(s, epoch).used.outputTokens, 20); assert.equal(apiUsageSummary(s, epoch).used.unknownUsage, 1);
  assert.equal(reserveApiUsage(s, p, 'first', undefined, epoch + 86_400_000), 'api_request_already_reserved');
});

test('migration imports immutable API snapshots without changing originals or inventing unknown usage; future schema fails closed', () => {
  const p = apiMember(), turn = { id: 'historic', participantId: p.id, dispatchStartedAt: new Date(epoch).toISOString(), startedAt: new Date(epoch - 10).toISOString(), status: 'failed', finishedAt: new Date(epoch).toISOString(), receipt: 'observed', usage: null, error: 'length' };
  const s = { discussions: [{ members: [p, gpt], turns: [turn, { ...turn, id: 'gpt', participantId: gpt.id }, { ...turn, id: 'missing', dispatchStartedAt: undefined }] }], resident: { turns: [] } };
  const original = structuredClone(s); ensureApiUsage(s, epoch); ensureApiUsage(s, epoch);
  assert.equal(s.apiUsage.entries.length, 1); assert.equal(s.apiUsage.legacyUntracked, 1); assert.equal(s.apiUsage.entries[0].usage, null);
  delete s.apiUsage; assert.deepEqual(s, original); ensureApiUsage(s, epoch);
  s.apiUsage.schemaVersion = 2; assert.throws(() => validateApiUsage(s), /unsupported_api_usage_schema/); s.apiUsage.schemaVersion = 1;
  s.apiUsage.entries[0].requestId = 7; assert.throws(() => validateApiUsage(s), /api_usage_state_invalid/);
});

test('quota owner edits use CAS, validate integer bounds and retain history; active API is blocked but GPT is allowed', () => {
  const s = { discussions: [{ members: [gpt], turns: [{ status: 'running', participantId: gpt.id }] }] }; policy(s, epoch);
  assert.throws(() => configureApiUsage(s, { expectedVersion: 0, maxRequests: 2, maxTokens: 100 }, epoch), /version_conflict/);
  for (const bad of [0, -1, 1.5, '24', Infinity]) assert.throws(() => policy(s, epoch, { maxRequests: bad }));
  s.discussions[0].members.push(apiMember()); s.discussions[0].turns.push({ status: 'unconfirmed', participantId: 'api' }); assert.throws(() => policy(s, epoch), /requires_idle/);
});

test('daily room skips unconfigured API and paused browser while GPT continues beyond expired legacy limits', async t => {
  const f = await configured(t, { members: ['api', 'web', 'gpt'] });
  f.store.transact(s => { const r = s.resident.rooms[0]; r.budgets = { maxRequests: 1, maxTokens: 1, maxToolJobs: 0, deadlineAt: '2020-01-01T00:00:00.000Z' }; s.browserPaused = true; });
  assert.equal(budgetReason(f.room()), null); assert.equal(toolBudgetReason(f.room()), 'room_tool_budget_exhausted');
  for (let i = 0; i < 4; i++) { await f.runner.tick(); f.advance(); }
  assert.equal(f.calls(), 4); assert.ok(f.store.read().resident.turns.every(t => t.participantId === 'gpt')); assert.equal(f.room().observedStatus, 'on');
  assert.equal(f.store.read().apiUsage.entries.length, 0);
  f.control({ action: 'off' }); f.control({ action: 'configure', budgetMode: 'legacy', pacing, budgets: { maxRequests: 1, maxTokens: 1, maxToolJobs: 0, deadlineAt: new Date(Date.now() + 100000).toISOString() } });
  assert.equal(budgetReason(f.room()), 'budget_exhausted');
});

test('daily API reservation counts actual hooks and returned usage; GPT continues after one-call overshoot', async t => {
  const f = await configured(t, { complete: async input => { input.hooks.dispatched(); return { text: reply(), receipt: 'quota-fixture', usage: { input: 80, output: 30 } }; } });
  f.store.transact(s => policy(s));
  await f.runner.tick(); f.advance(); await f.runner.tick(); f.advance(); await f.runner.tick();
  assert.deepEqual(f.store.read().resident.turns.map(t => t.participantId), ['api', 'gpt', 'gpt']);
  assert.deepEqual(apiUsageSummary(f.store.read()).used, { requests: 1, reserved: 0, inputTokens: 80, outputTokens: 30, unknownUsage: 0 });
});

test('automatic scheduler waits without polling when API is unconfigured, then wakes on owner policy and stops at the daily cap', async t => {
  let calls = 0; const f = await workspace(t, { residentEnabled: true }, { residentProvider: { complete: async input => { calls++; input.hooks.dispatched(); return { text: reply(), receipt: 'automatic-fixture', usage: null }; } } });
  f.app.store.transact(s => { const p = apiMember(); s.participants.push(p); s.connections.push({ id: p.connectionId, kind: p.kind, status: 'connected', label: 'fixture', models: [] }); });
  const id = f.app.store.read().resident.rooms[0].id, control = body => f.app.resident.control(id, { expectedVersion: f.app.store.read().resident.rooms[0].version, ...body }, crypto.randomUUID());
  control({ action: 'configure', budgetMode: 'api-daily', pacing }); control({ action: 'set_member', participantId: 'api', enabled: true }); control({ action: 'on' });
  await until(() => f.app.store.read().resident.rooms[0].reason === 'api_daily_not_configured');
  const originalTransact = f.app.store.transact.bind(f.app.store); let transactions = 0; f.app.store.transact = (...args) => { transactions++; return originalTransact(...args); };
  await delay(75); assert.equal(calls, 0); assert.equal(transactions, 0);
  f.app.configureApiDaily({ expectedVersion: 0, maxRequests: 1, maxTokens: 1000 }, crypto.randomUUID()); await until(() => f.app.store.read().resident.rooms[0].reason === 'api_daily_exhausted');
  transactions = 0; await delay(75); assert.equal(calls, 1); assert.equal(transactions, 0); assert.equal(Date.parse(f.app.store.read().resident.rooms[0].nextEligibleAt), nextApiDay());
});

test('all API exhausted sleeps until KST midnight; next day permits one new dispatch without deleting ledger', async t => {
  const f = await configured(t, { members: ['api'], complete: async input => { input.hooks.dispatched(); return { text: reply(), receipt: 'api-only', usage: null }; } });
  f.store.transact(s => policy(s, f.clock(), { maxRequests: 1 })); await f.runner.tick(); f.advance();
  for (let i = 0; i < 100; i++) await f.runner.tick();
  assert.equal(f.calls(), 1); assert.equal(f.room().reason, 'api_daily_exhausted'); assert.equal(Date.parse(f.room().nextEligibleAt), nextApiDay(f.clock()));
  // The production dispatch hook uses wall time. Move old entries to yesterday
  // while advancing the scheduler clock to the new day, without clearing them.
  f.store.transact(s => { const e = s.apiUsage.entries[0]; e.day = apiDay(Date.now() - 86_400_000); e.startedAt = new Date(Date.parse(e.startedAt) - 86_400_000).toISOString(); s.resident.rooms[0].nextEligibleAt = null; });
  await f.runner.tick(); assert.equal(f.calls(), 2); assert.equal(f.store.read().apiUsage.entries.length, 2);
});

test('uncertain API stops every participant, persists once across recovery, human reconciliation never sends again', async t => {
  const f = await configured(t, { complete: async input => { input.hooks.dispatched(); throw new Error('uncertain fixture'); } }); f.store.transact(s => policy(s));
  await f.runner.tick(); assert.equal(f.calls(), 1); assert.equal(f.room().observedStatus, 'blocked'); assert.equal(f.store.read().apiUsage.entries[0].status, 'unconfirmed');
  f.runner.recover(); for (let i = 0; i < 20; i++) { f.advance(); await f.runner.tick(); } assert.equal(f.calls(), 1);
  const turn = f.store.read().resident.turns[0]; f.runner.reconcile(f.roomId, turn.id, { resolution: 'skip' }, 'reconcile-once');
  assert.equal(f.calls(), 1); assert.equal(f.store.read().apiUsage.entries[0].startedAt !== null, true); assert.equal(apiUsageSummary(f.store.read()).used.unknownUsage, 1);
  assert.match(await readFile(f.directory + '/workspace.sqlite').then(b => String(b.subarray(0, 15))), /SQLite format 3/);
});

test('mixed focus closes partial on API quota, keeps unfinished round private and returns to GPT in same room', async t => {
  let f; f = await configured(t, { complete: async input => { input.hooks.dispatched(); const text = input.prompt.startsWith('웹쫀쿠 상주') ? reply() : response(input.prompt, input.participant); return { text, receipt: 'mixed', usage: { input: 1, output: 1 } }; } });
  f.store.transact(s => policy(s, Date.now(), { maxRequests: 1, maxTokens: 10000 }));
  const did = f.runner.focus(f.roomId, { ...topic, participantIds: ['api', 'gpt'], limits: { maxRequests: 6, maxTokens: 1000, maxActiveMs: 5000, maxRounds: 1, maxVerificationTasks: 0 } }, 'daily-focus');
  await until(() => f.store.read().discussions.find(d => d.id === did)?.status === 'partial');
  const d = f.store.read().discussions[0]; assert.equal(d.budgetMode, 'api-daily'); assert.equal(d.reason, 'api_daily_exhausted'); assert.equal(d.turns.length, 2);
  await f.runner.tick(); assert.equal(f.room().topicLink, null); assert.ok(f.store.read().resident.messages.every(m => m.sourceKind !== 'topic' || d.turns.find(t => t.id === m.sourceId)?.phase === 'independent'));
  f.advance(); await f.runner.tick(); assert.equal(f.store.read().resident.turns.at(-1).participantId, 'gpt'); assert.equal(f.room().id, f.roomId);
});

test('daily owner endpoint requires authentication/origin/CAS/idempotency and snapshot hides ledger identities', async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false });
  const input = { expectedVersion: 0, maxRequests: 24, maxTokens: 200000 };
  f.app.store.transact(s => { s.grants.push({ id: 'quota-scoped-grant', hash: digest('fixture-only-scoped-mcp'), discussionId: 'fixture', participantId: 'fake-a', tools: ['task_get'], revoked: false }); });
  assert.equal((await fetch(f.url + '/api/api-daily', { method: 'POST', body: JSON.stringify(input) })).status, 401);
  assert.equal((await f.api('/api/api-daily', input, { headers: { Authorization: 'Bearer fixture-only-scoped-mcp' } })).status, 401);
  assert.equal((await f.api('/api/api-daily', input, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  const key = crypto.randomUUID(); const options = { headers: { 'Idempotency-Key': key } };
  assert.equal((await f.api('/api/api-daily', input, options)).status, 200); assert.equal((await f.api('/api/api-daily', input, options)).status, 200);
  assert.equal((await f.api('/api/api-daily', input)).status, 409);
  const snapshot = await (await f.api('/api/state')).json(); assert.equal(snapshot.apiDaily.policy.maxRequests, 24); assert.equal('entries' in snapshot.apiDaily, false); assert.equal(snapshot.apiDaily.timeZone, 'Asia/Seoul');
});

test('daily analysis work without a tool deadline releases an unsent API claim, then another actor completes and reviews it', async t => {
  const base = new FakeResidentCompletion({ complete: async () => { throw new Error('No external transport'); } }, 1);
  const f = await workFixture(t, { on: false, provider: base }); f.control({ action: 'configure', budgetMode: 'api-daily', pacing });
  f.app.store.transact(s => { const p = apiMember(); s.participants.push(p); s.connections.push({ id: p.connectionId, kind: p.kind, status: 'connected', label: 'API fixture', models: [] }); policy(s, Date.now(), { maxRequests: 1 }); s.resident.rooms[0].budgets = null; });
  f.control({ action: 'set_member', participantId: 'api', enabled: true });
  f.q.seat(f.roomId, { participantId: 'api', expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, crypto.randomUUID()); f.control({ action: 'on' });
  const id = f.propose({ allowedParticipantIds: ['api', 'fake-a', 'fake-b'] }); f.q.claim(f.roomId, id, { participantId: 'api', expectedVersion: f.task(id).version }, crypto.randomUUID());
  f.app.store.transact(s => sent(s, apiMember(), 'other-room-consumed', Date.now()));
  await f.step(); await f.step(); assert.equal(f.task(id).status, 'done');
  const attempts = f.app.store.read().resident.workAttempts.filter(a => a.taskId === id); assert.equal(attempts[0].error, 'api_daily_exhausted'); assert.equal(attempts[0].providerTurnId, null);
  assert.ok(attempts.slice(1).every(a => a.participantId !== 'api')); assert.equal(f.app.store.read().jobs.length, 0); assert.equal(toolBudgetReason(f.app.store.read().resident.rooms[0]), 'room_tool_budget_exhausted');
});

test('GPT-only daily focus completes beyond legacy topic request/token bounds with both publication barriers intact', async t => {
  let f; f = await configured(t, { members: ['gpt', 'fake-a'], complete: async input => { input.hooks.dispatched(); const text = input.prompt.startsWith('웹쫀쿠 상주') ? reply() : response(input.prompt, input.participant); return { text, receipt: 'gpt-only', usage: { input: 1000, output: 100 } }; } });
  const did = f.runner.focus(f.roomId, { ...topic, participantIds: ['gpt', 'fake-a'], limits: { maxRequests: 6, maxTokens: 1000, maxRounds: 2, maxVerificationTasks: 0 } }, 'free-focus');
  await until(() => f.store.read().discussions.find(d => d.id === did)?.status === 'completed');
  const d = f.store.read().discussions[0]; assert.ok(d.used.requests > 6); assert.ok(d.used.inputTokens + d.used.outputTokens > 1000); assert.equal(d.reason, 'procedure_completed'); assert.equal(f.store.read().apiUsage.entries.length, 0);
});

test('API work response at the daily cap remains valid for reporting and an independent non-API review', async t => {
  const fake = new FakeResidentCompletion({ complete: async () => { throw new Error('No network'); } }, 1);
  const f = await workFixture(t, { on: false, provider: { complete: async input => { const result = await fake.complete({ ...input, participant: { ...input.participant, kind: 'fake' } }); return { ...result, usage: { input: 80, output: 30 } }; } } });
  f.control({ action: 'configure', budgetMode: 'api-daily', pacing }); f.app.store.transact(s => { const p = apiMember(); s.participants.push(p); s.connections.push({ id: p.connectionId, kind: p.kind, status: 'connected', label: 'fixture', models: [] }); policy(s, Date.now(), { maxRequests: 1 }); });
  f.control({ action: 'set_member', participantId: 'api', enabled: true }); f.q.seat(f.roomId, { participantId: 'api', expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, crypto.randomUUID()); f.control({ action: 'on' });
  const id = f.propose({ allowedParticipantIds: ['api'] }); await f.step(); assert.equal(f.task(id).status, 'review'); assert.equal(f.task(id).reports[0].authorId, 'api');
  await f.step(); assert.equal(f.task(id).status, 'done'); assert.notEqual(f.task(id).reviews[0].reviewerId, 'api'); assert.equal(apiUsageSummary(f.app.store.read()).used.requests, 1);
});

test('dot requires owner confirmation of a probed existing ChatGPT thread; Muse/manual metadata cannot become dot', async t => {
  const f = await workspace(t); const install = service => { const preset = browserPresets.find(p => p.service === service), mock = bridgeWithObservation(preset, service); f.app.browser.tool = mock.bridge.tool; f.app.browser.probe = mock.bridge.probe; f.app.browser.inspect = mock.bridge.inspect; return { preset, mock }; };
  let { preset, mock } = install('muse'); let candidate = await f.app.discoverBrowser({ pageId: 7, profile: 'default', presetId: preset.id });
  await assert.rejects(f.app.confirmBrowser({ discoveryId: candidate.id, label: 'dot', confirmed: true, target: 'dot' }, 'muse-not-dot'), /dot_existing_chat_required/); assert.equal(f.app.store.read().connections.length, 0);
  ({ preset, mock } = install('chatgpt')); candidate = await f.app.discoverBrowser({ pageId: 7, profile: 'default', presetId: preset.id });
  const id = await f.app.confirmBrowser({ discoveryId: candidate.id, label: 'chosen dot', confirmed: true, target: 'dot' }, 'dot-confirm');
  const c = f.app.store.read().connections.find(c => c.id === id); assert.equal(c.browser.discovery.target, 'dot'); assert.equal(mock.toolCalls.every(c => ['list_pages', 'evaluate_script'].includes(c.name)), true);
  const ordinary = await f.app.addBrowser({ label: 'ordinary web', binding: { ...c.browser, pageId: 8, url: 'https://chatgpt.com/c/another-thread' } }); assert.equal(f.app.store.read().connections.find(c => c.id === ordinary).browser.discovery, undefined);
  const p = f.app.participant({ connectionId: id, modelId: c.models[0].id, label: 'dot actor' }); f.app.engine.kick = () => {};
  f.app.engine.create({ ...topic, participantIds: [p, 'fake-a'] }, 'historic-dot-topic');
  assert.throws(() => f.app.participant({ connectionId: ordinary, modelId: c.models[0].id, label: 'other' }, p), /requires_new_participant/); assert.equal(f.app.store.read().participants.find(x => x.id === p).connectionId, id);
});
