import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dotOnceGuard } from '../scripts/live-acceptance-dot-once.mjs';
import { promptFor } from '../dist/server/workspace/prompts.js';
import { dotInputDigest } from '../dist/server/workspace/dot-mcp-policy.js';
import { participantIdentity } from '../dist/server/workspace/wiki-policy.js';
import { snapshotMember } from '../dist/server/workspace/settings.js';
import { AppError } from '../dist/server/workspace/util.js';
import { stoppedDotTopicFixture, key } from './dot-mcp-fixture.mjs';
import { until } from './workspace-helpers.mjs';

const helpers = { promptFor, dotInputDigest, participantIdentity, normalizeMember: snapshotMember, ErrorType: AppError, intervalMs: 0 };
async function fixture(t, install = true) {
  const cleanup = [], f = await stoppedDotTopicFixture({ after: fn => cleanup.push(fn) });
  t.after(async () => { await f.guard?.stop(); for (const fn of cleanup) await fn(); f.guard?.close(); });
  // Existing owner recovery is separate from this guard; it never resumes.
  f.app.engine.control(f.discussionId, f.retryBody, key()); f.control({ action: 'off' });
  const s = f.state(), d = s.discussions[0], task = d.tasks.find(t => t.turnId === f.stoppedRequestId);
  const participant = d.members.find(p => p.id === f.participantId), context = d.contexts.find(c => c.participantId === participant.id);
  const policy = { roomId: f.roomId, baselineLeases: s.resident.dispatchLeases.map(l => l.id), maxRequests: 1, maxApiRequests: 1,
    maxMs: 1800000, drainMs: 300000, participants: [participant], dotOnce: { version: 1, discussionId: d.id, revision: d.revision,
      taskId: task.id, phase: 'cross_review', round: task.round, participantId: participant.id, identityDigest: participantIdentity(participant),
      roomEpoch: f.room().epoch + 1, roomContextGeneration: f.room().contexts?.find(c => c.participantId === participant.id)?.generation ?? 1,
      topicContextGeneration: context.generation, inputDigest: dotInputDigest(promptFor(d, task), context.history) } };
  f.policy = policy; f.attach = () => f.guard = dotOnceGuard(f.app, policy, helpers);
  f.onEvent = requestId => f.respond(requestId);
  f.begin = () => { f.control({ action: 'on' }); f.app.engine.control(d.id, { action: 'resume', expectedRevision: d.revision }, key()); };
  f.added = () => f.state().resident.dispatchLeases.filter(l => !policy.baselineLeases.includes(l.id));
  if (install) f.attach();
  return f;
}

test('dot once admits real cross_review, parses/settles before stopping, and never calls the next provider', async t => {
  const f = await fixture(t), before = f.state(), completed = before.discussions[0].turns.filter(t => t.status === 'completed');
  f.app.store.transact(s => { const d = s.discussions[0], task = d.tasks.find(t => t.id === f.policy.dotOnce.taskId);
    d.tasks.push({ ...structuredClone(task), id: 'next-provider-task', participantId: 'fake-a', turnId: null, reason: null }); });
  let calls = 0, mailbox = 0, receipts = 0, finished = 0;
  const original = f.app.providers.complete.bind(f.app.providers);
  f.app.providers.complete = input => { calls++; assert.equal(input.participant.kind, 'dot-mcp'); return original(input); };
  f.app.store.subscribe(e => {
    if (e.type === 'dot.reply_received' || e.type === 'turn.receipt') {
      assert.equal(f.room().desiredOn, true); if (e.type === 'dot.reply_received') mailbox++; else receipts++;
    }
    if (e.type === 'turn.finished') {
      const turn = f.state().discussions[0].turns.at(-1); assert.ok(turn.reply); assert.equal(turn.status, 'completed');
      assert.equal(f.added()[0].state, 'released'); assert.equal(f.room().desiredOn, false); finished++;
    }
  });
  f.app.start(); assert.equal(f.room().desiredOn, false); f.begin();
  await until(() => finished === 1); await f.step();
  assert.deepEqual([calls, mailbox, receipts, finished], [1, 1, 1, 1]);
  assert.deepEqual(f.state().discussions[0].turns.slice(0, completed.length), completed);
  assert.equal(f.state().discussions[0].status, 'paused'); assert.equal(f.added().length, 1);
  assert.ok(f.state().discussions[0].tasks.some(t => t.status === 'pending' && t.participantId !== f.participantId));
  await assert.rejects(f.app.engine.turn(f.discussionId, f.policy.dotOnce.taskId), /acceptance_stopped/);
  assert.equal(f.guard.observe(f.state()).apiRequests, 0);
});

test('dot once rejects malformed policies and execution/timeout opt-ins before installing hooks', async t => {
  const f = await fixture(t, false), start = f.app.start, reserve = f.app.dispatch.reserve, cursor = f.app.store.cursor();
  for (const update of [p => p.maxRequests = 2, p => p.execution = {}, p => p.setup = {}, p => p.participants.push(p.participants[0]),
    p => p.participants[0].kind = 'deepseek', p => p.dotOnce.phase = 'verification', p => p.dotOnce.round = 0,
    p => p.dotOnce.inputDigest = 'bad', p => p.dotOnce.identityDigest = 'a'.repeat(64), p => p.dotOnce.extra = true]) {
    const p = structuredClone(f.policy); update(p); assert.throws(() => dotOnceGuard(f.app, p, helpers), /invalid_acceptance/);
  }
  for (const settings of [{ workspaceRoots: ['/tmp'] }, { turnTimeoutMs: 300001 }]) {
    const previous = { ...f.app.config }; Object.assign(f.app.config, settings);
    assert.throws(() => dotOnceGuard(f.app, f.policy, helpers), /invalid_acceptance/); Object.assign(f.app.config, previous);
  }
  assert.equal(f.app.start, start); assert.equal(f.app.dispatch.reserve, reserve); assert.equal(f.app.store.cursor(), cursor);
});

test('dot once checks startup, task/input generations and Codex before any side effects', async t => {
  const f = await fixture(t), original = f.state();
  const mutations = [s => s.discussions[0].roomId = 'other', s => s.resident.rooms[0].topicLink = 'other',
    s => s.discussions[0].revision++, s => s.discussions[0].round++, s => s.resident.rooms[0].epoch++,
    s => s.discussions[0].contexts.find(c => c.participantId === f.participantId).generation++,
    s => s.resident.rooms[0].contexts = [{ participantId: f.participantId, generation: 2 }],
    s => s.discussions[0].members.find(p => p.id === f.participantId).modelId = 'other',
    s => s.participants.find(p => p.id === f.participantId).kind = 'deepseek', s => s.discussions[0].topic += 'changed',
    s => s.discussions[0].contexts.find(c => c.participantId === f.participantId).history.push({ role: 'user', content: 'changed' }),
    s => s.discussions[0].tasks.find(t => t.id === f.policy.dotOnce.taskId).reason = 'format_retry'];
  for (const mutate of mutations) {
    f.app.store.transact(s => { Object.assign(s, structuredClone(original)); mutate(s); });
    const before = f.state(), cursor = f.app.store.cursor();
    assert.throws(() => f.app.start(), /acceptance_dot_once_/);
    await assert.rejects(f.app.engine.turn(f.discussionId, f.policy.dotOnce.taskId), /acceptance_dot_once_/);
    assert.deepEqual(f.state(), before); assert.equal(f.app.store.cursor(), cursor);
  }
  f.app.store.transact(s => Object.assign(s, original));
  const before = f.state(), cursor = f.app.store.cursor();
  for (const [discussionId, taskId] of [['other', f.policy.dotOnce.taskId], [f.discussionId, 'new-task']])
    await assert.rejects(f.app.engine.turn(discussionId, taskId), /task_not_allowed/);
  for (const kind of ['resident', 'work', 'topic']) assert.match(f.app.dispatch.reserve(f.state(), {
    requestId: key(), kind, roomId: f.roomId, participantId: f.participantId, participant: f.policy.participants[0], generation: 1 }), /reservation_not_allowed/);
  await assert.rejects(f.app.codex.register({ cwd: '/missing-before-realpath', sessionMode: 'new' }), /acceptance_codex_not_authorized/);
  assert.throws(() => f.app.codex.submit({}), /acceptance_codex_not_authorized/);
  assert.throws(() => f.app.codex.beforeDispatch({}, {}), /acceptance_codex_not_authorized/);
  assert.deepEqual(f.state(), before); assert.equal(f.app.store.cursor(), cursor); assert.equal(f.added().length, 0);
});

test('dot once rejects persisted active Codex jobs before the original startup has any effect', async t => {
  const f = await fixture(t, false), start = f.app.start; let effects = 0;
  f.app.start = function (...args) { effects++; return start.apply(this, args); }; f.attach();
  for (const status of ['queued', 'running', 'blocked_approval', 'reconciling']) {
    f.app.store.transact(s => { s.jobs = [{ id: 'preexisting-codex', requestId: 'fixture-request', bindingId: 'fixture-binding', discussionId: null, status, approvals: [] }]; });
    const before = f.state(), cursor = f.app.store.cursor();
    assert.throws(() => f.app.start(), /acceptance_dot_once_existing_codex_work/);
    assert.equal(effects, 0); assert.deepEqual(f.state(), before); assert.equal(f.app.store.cursor(), cursor);
  }
  f.app.store.transact(s => { s.jobs = []; });
});

test('dot once blocks real loop verification before source, evidence, tool reservation or model effects', async t => {
  const f = await fixture(t, false), reserveTool = f.app.dispatch.reserveTool; const effects = { source: 0, tool: 0, model: 0 };
  f.app.config.sourceFetch = true;
  f.app.engine.sourceReader = async () => { effects.source++; return { text: 'fixture only', digest: 'fixture' }; };
  f.app.dispatch.reserveTool = function (...args) { effects.tool++; return reserveTool.apply(this, args); };
  f.app.providers.complete = async () => { effects.model++; throw new Error('unexpected_fixture_model'); };
  f.attach(); f.control({ action: 'on' });
  for (const method of ['source', 'review', 'codex']) {
    f.app.store.transact(s => { const d = s.discussions[0], task = d.tasks.find(t => t.id === f.policy.dotOnce.taskId);
      d.status = 'running'; d.reason = null; d.executionBindingId = 'fixture-binding'; d.limits.maxToolJobs = 1;
      s.resident.rooms[0].toolBudget = { maxToolJobs: 1, deadlineAt: new Date(Date.now() + 60000).toISOString() };
      d.tasks = d.tasks.filter(t => t.id !== 'forbidden-verification');
      d.tasks.unshift({ ...structuredClone(task), id: 'forbidden-verification', participantId: 'fake-a', phase: 'verification',
        method, url: 'https://never-fetched.invalid/', turnId: null, jobId: null, reason: null }); });
    const before = f.state(), cursor = f.app.store.cursor();
    await assert.rejects(f.app.engine.loop(), /acceptance_dot_once_verification_not_allowed/);
    assert.deepEqual(effects, { source: 0, tool: 0, model: 0 }); assert.deepEqual(f.state(), before); assert.equal(f.app.store.cursor(), cursor);
  }
});

for (const outcome of ['completed', 'format', 'error', 'abort', 'input-changed']) test('one durable reservation survives ' + outcome + ' and restart without a refreshed baseline', async t => {
  const f = await fixture(t); let calls = 0;
  const original = f.app.providers.complete.bind(f.app.providers);
  f.app.providers.complete = input => { calls++; if (outcome === 'error') throw new AppError('fixture_error', 409); return original(input); };
  if (outcome === 'format') f.onEvent = requestId => f.respond(requestId, 'not JSON');
  if (outcome === 'abort') f.onEvent = requestId => { f.claim(requestId); f.app.engine.abort.abort(); };
  if (outcome === 'input-changed') f.app.store.subscribe(e => {
    if (e.type === 'turn.prepared') f.app.store.transact(s => { s.dotMcp.requests.items.at(-1).history.push({ role: 'user', content: 'tampered' }); });
  });
  f.begin(); await until(() => f.added().length === 1 && f.state().discussions[0].turns.at(-1).finishedAt);
  assert.equal(calls, outcome === 'input-changed' ? 0 : 1); assert.equal(f.room().desiredOn, false);
  if (outcome === 'format') assert.ok(f.state().discussions[0].tasks.some(t => t.reason === 'format_retry' && t.status === 'pending'));
  if (outcome === 'abort') assert.equal(f.added()[0].state, 'unconfirmed');
  // Restore only fixture corruption so the product's startup validator can read it.
  if (outcome === 'input-changed') f.app.store.transact(s => { s.dotMcp.requests.items.at(-1).history.pop(); });
  const old = f.guard; await old.stop(); await f.reopen(); old.close(); f.attach();
  const before = f.state(); assert.throws(() => f.app.start(), /acceptance_request_limit/);
  await assert.rejects(f.app.engine.turn(f.discussionId, f.policy.dotOnce.taskId), /acceptance_request_limit/);
  assert.deepEqual(f.state(), before); assert.equal(f.guard.observe(before).requests, 1);
  assert.throws(() => dotOnceGuard(f.app, { ...f.policy, baselineLeases: before.resident.dispatchLeases.map(l => l.id) }, helpers), /idempotency_conflict/);
  assert.equal(f.app.store.events(0, 10000).filter(e => e.type === 'acceptance.dot_once_scope').length, 1);
});

test('perform rejects a different request, provider or frozen input after reservation without invoking it', async t => {
  const f = await fixture(t), perform = f.app.dispatch.perform.bind(f.app.dispatch); let rejected = 0;
  f.app.dispatch.perform = async (store, provider, input) => {
    const before = f.state(), cursor = store.cursor();
    for (const [p, i] of [[{}, input], [provider, { ...input, requestId: f.stoppedRequestId }],
      [provider, { ...input, history: [] }], [provider, { ...input, participant: { ...input.participant, kind: 'deepseek' } }]]) {
      const result = await perform(store, p, i); assert.match(result.failure.code, /acceptance_dot_once_dispatch/); rejected++;
      assert.deepEqual(f.state(), before); assert.equal(store.cursor(), cursor);
    }
    return perform(store, provider, input);
  };
  f.begin(); await until(() => !f.room().desiredOn); assert.equal(rejected, 4); assert.equal(f.added().length, 1);
});

test('production entry rejects a changed 300s timeout before creating state; guard stays installed throughout close', async t => {
  const f = await fixture(t), stateDir = join(f.directory, 'must-not-exist'), policyFile = join(f.directory, 'policy.json');
  await writeFile(policyFile, JSON.stringify(f.policy), { mode: 0o600 });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawnSync(process.execPath, [join(root, 'scripts/live-acceptance-server.mjs'), root, policyFile], {
    timeout: 10000, encoding: 'utf8', env: { ...process.env, WJ_STATE_DIR: stateDir, WJ_WORKSPACE_ROOTS: '[]', WJ_TURN_TIMEOUT_MS: '5000' } });
  assert.notEqual(child.status, 0); assert.match(child.stderr, /acceptance_dot_once_requires_300s_and_no_execution/);
  await assert.rejects(access(stateDir), { code: 'ENOENT' });
  const hooks = () => [f.app.start, f.app.engine.turn, f.app.dispatch.perform, f.app.codex.register, f.app.engine.verify, f.app.dispatch.reserveTool];
  const guarded = hooks();
  await f.guard.stop(); await f.app.close();
  assert.deepEqual(hooks(), guarded);
  f.guard.close(); f.guard = undefined;
  assert.equal(f.app.engine.verify, Object.getPrototypeOf(f.app.engine).verify);
  assert.equal(f.app.dispatch.reserveTool, Object.getPrototypeOf(f.app.dispatch).reserveTool);
});
