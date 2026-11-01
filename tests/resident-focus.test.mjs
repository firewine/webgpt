import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { workFixture } from './work-fixture.mjs';
import { reply } from './resident-fixture.mjs';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { ResidentFocus, validateTopicIntents } from '../dist/server/workspace/resident-focus.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';

export async function topicFixture(t, autoTopic = true, transform = b => b) {
  const f = await workFixture(t, { on: false, provider: { complete: async input => {
    const b = JSON.parse(input.prompt.split('\n\n').find(p => p.startsWith('{"roomId":'))); input.hooks.dispatched();
    return { text: reply({ proposals: [{ kind: 'topic_propose', payload: transform({ topic: '공개 근거 비교', criteria: '반론과 미확인', maxRounds: 2, sourceMessageIds: [b.messages[0].id] }) }] }), receipt: 'topic-original-receipt', usage: { input: 10, output: 20 } };
  } } });
  f.app.engine.kick = () => {}; const r = f.app.store.read().resident.rooms[0]; if (autoTopic) f.control({ action: 'configure', budgets: r.budgets, pacing: r.pacing, autoTopic: true }); f.control({ action: 'on' }); await f.step();
  return { ...f, focus: f.app.residentRunner.autoFocus, room: () => f.app.store.read().resident.rooms[0], intent: () => f.app.store.read().resident.topicIntents?.[0], pump: () => f.app.residentRunner.autoFocus.pump(Date.now() + 2000) };
}

test('R8 auto topic: one allowed proposal, twenty captures/pumps, original engine/command and one same-room return', async t => {
  const f = await topicFixture(t); const turn = f.app.store.read().resident.turns[0]; assert.equal(f.intent().status, 'queued');
  for (let n = 0; n < 20; n++) f.app.store.transact((s, emit) => f.focus.capture(s, s.resident.rooms[0], s.resident.turns[0], emit, Date.now()));
  assert.equal(f.app.store.read().resident.topicIntents.length, 1); assert.equal(f.pump(), true); for (let n = 0; n < 20; n++) f.pump();
  const s = f.app.store.read(), d = s.discussions[0]; assert.equal(s.discussions.length, 1); assert.equal(f.intent().discussionId, d.id); assert.deepEqual(d.members.map(p => p.id), ['fake-a', 'fake-b']); assert.equal(d.executionBindingId, null); assert.equal(d.limits.maxToolJobs, 0); assert.equal(d.limits.maxVerificationTasks, 0); assert.equal(d.budgetMode, 'api-daily'); assert.equal(s.resident.turns[0].receipt, turn.receipt);
  f.app.engine.control(d.id, { action: 'cancel', expectedRevision: 1 }, 'finish-test-topic'); f.control({ action: 'off' }); for (let n = 0; n < 100; n++) await f.app.residentRunner.tick();
  assert.equal(f.room().topicLink, null); assert.equal(f.app.store.events(0).filter(e => e.type === 'resident.focus_returned').length, 1); assert.equal(f.app.store.read().resident.turns.length, 1);
});

for (const [name, mutate, reason] of [
  ['off', (s, r) => { r.desiredOn = false; r.epoch++; }, 'auto_topic_not_allowed'],
  ['permission revoked', (s, r) => { r.autoTopic = false; }, 'auto_topic_not_allowed'],
  ['generation', (s, r) => { r.contexts[0].generation++; }, 'auto_topic_scope_changed'],
  ['identity', s => { s.participants[0].connectionId = 'other-account'; }, 'auto_topic_scope_changed'],
  ['seat policy', (s, r) => { r.seats[0].version++; }, 'auto_topic_scope_changed'],
  ['member off', (s, r) => { r.members[1].enabled = false; }, 'auto_topic_scope_changed'],
  ['public context changed', s => { s.resident.messages[0].text = '바뀐 공개 원문'; }, 'auto_topic_context_changed'],
]) test('R8 auto topic negative: ' + name + ' rejects old intent across one hundred pumps without starting a discussion', async t => {
  const f = await topicFixture(t); const original = f.app.store.read().resident.turns[0]; f.app.store.transact(s => mutate(s, s.resident.rooms[0])); for (let n = 0; n < 100; n++) f.pump();
  assert.equal(f.app.store.read().discussions.length, 0); assert.equal(f.intent().status, 'rejected'); assert.equal(f.intent().reason, reason); assert.equal(f.app.store.read().resident.turns[0].text, original.text);
});

for (const field of ['budget', 'deadline']) test('R8 auto topic ignores archived room ' + field + ' while preserving the original proposal and single start', async t => {
  const f = await topicFixture(t); const original = f.app.store.read().resident.turns[0]; f.app.store.transact(s => { const r = s.resident.rooms[0]; if (field === 'budget') { r.budgets.maxRequests = 1; r.budgets.maxTokens = 1; } else r.budgets.deadlineAt = new Date(0).toISOString(); });
  assert.equal(f.pump(), true); for (let n = 0; n < 100; n++) f.pump(); assert.equal(f.app.store.read().discussions.length, 1); assert.equal(f.intent().status, 'linked'); assert.equal(f.app.store.read().resident.turns[0].text, original.text);
});

test('R8 auto topic: old/default-off rooms and injected execution/private material fields never grant permission', async t => {
  for (const [allowed, transform, reason] of [[false, b => b, 'auto_topic_not_allowed'], [true, b => ({ ...b, executionBindingId: 'foreign' }), 'invalid_topic_proposal'], [true, b => ({ ...b, sourceMessageIds: ['private-round'] }), 'topic_source_not_public']]) {
    const f = await topicFixture(t, allowed, transform); for (let n = 0; n < 20; n++) f.pump(); assert.equal(f.app.store.read().discussions.length, 0); assert.equal(f.intent(), undefined); assert.equal(f.app.store.read().resident.turns[0].proposalResults[0].reason, reason);
  }
});

test('R8 auto topic: active work, approval/job, root and uncertain leases defer intent; flag-off never starts it', async t => {
  const f = await topicFixture(t); const work = f.propose(); for (let n = 0; n < 20; n++) f.pump(); assert.equal(f.intent().status, 'queued'); assert.equal(f.app.store.read().discussions.length, 0);
  f.app.store.transact(s => { s.resident.workItems.find(t => t.id === work).status = 'cancelled'; });
  for (const status of ['queued', 'running', 'blocked_approval', 'reconciling']) { f.app.store.transact(s => { s.jobs = [{ id: 'recorded-original-job', status }]; }); for (let n = 0; n < 20; n++) f.pump(); assert.equal(f.intent().status, 'queued'); }
  f.app.store.transact(s => { s.jobs = []; s.resident.dispatchLeases.push({ id: 'original-unconfirmed', ownerKind: 'resident', ownerAttemptId: 'original-unconfirmed', participantId: 'fake-b', generation: 1, state: 'unconfirmed', roomId: f.roomId }); });
  for (let n = 0; n < 20; n++) f.pump(); assert.equal(f.intent().status, 'queued'); const disabled = new ResidentFocus(f.app.store, f.app.engine, false); assert.equal(disabled.pump(Date.now() + 2000), false); assert.equal(f.app.store.read().discussions.length, 0);
  f.app.store.transact(s => { s.resident.dispatchLeases.pop(); }); assert.equal(f.pump(), true); assert.equal(f.app.store.read().discussions.length, 1);
});

test('R8 auto topic: malformed durable intent or opt-in field fails closed with the original reply retained', async t => {
  const f = await topicFixture(t); f.app.store.transact(s => { s.resident.topicIntents[0].input.topic = '변조'; }); assert.throws(() => validateTopicIntents(f.app.store.read()), /invalid_topic_intent_state/); assert.throws(() => f.pump(), /invalid_topic_intent_state/);
  f.app.store.transact(s => { s.resident.rooms[0].autoTopic = 'true'; }); assert.throws(() => new ResidentStore(f.app.store, true), /resident_state_invalid/); assert.equal(f.app.store.read().discussions.length, 0);
});

for (const stage of ['intent_committed', 'creation_before_commit', 'creation_committed']) test('R8 auto topic SIGKILL: ' + stage + ' recovers one existing command/topic without a duplicate start', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-topic-crash-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['tests/fixtures/resident-focus-crash.mjs', directory, stage], { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr = ''; child.stderr.on('data', d => { stderr += d; }); const [code, signal] = await once(child, 'exit'); assert.equal(code, null, stderr); assert.equal(signal, 'SIGKILL', stderr);
  const { roomId } = JSON.parse(await readFile(join(directory, 'topic-fixture.json'), 'utf8')); const store = new Store(directory);
  try { const engine = new DiscussionEngine(store, { complete: () => assert.fail('no recovery inference') }, { sourceFetch: false, turnTimeoutMs: 1000 }); engine.kick = () => {}; const focus = new ResidentFocus(store, engine, true);
    for (let n = 0; n < 20; n++) focus.pump(Date.now() + 2000); const s = store.read(); assert.equal(s.discussions.length, 1); assert.equal(s.resident.topicIntents.length, 1); assert.equal(s.resident.topicIntents[0].discussionId, s.discussions[0].id); assert.equal(s.discussions[0].roomId, roomId); assert.equal(s.discussions[0].turns.length, 0); assert.equal(store.events(0).filter(e => e.type === 'discussion.created').length, 1); assert.equal(s.jobs.length, 0);
  } finally { store.close(); }
});
