import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceGuard } from '../scripts/live-acceptance-guard.mjs';

function fixture(options = {}) {
  let time = Date.parse('2026-11-02T00:00:00Z'), calls = 0, deny = null;
  const gpt = { id: 'gpt', connectionId: 'gpt-c', modelId: 'fixture-gpt', kind: 'openai-oauth', reasoningEffort: 'xhigh' };
  const api = { id: 'api', connectionId: 'api-c', modelId: 'fixture-api', kind: 'deepseek', reasoningEffort: 'high' };
  const room = { id: 'room', version: 1, desiredOn: true, ledger: [] };
  const state = { participants: [gpt, api], resident: { rooms: [room], dispatchLeases: [] }, discussions: [] };
  const app = { config: { turnTimeoutMs: 300000 }, store: { read: () => structuredClone(state) }, codex: { beforeDispatch: () => null },
    dispatch: { reserve(s, input) {
      if (deny) return deny;
      calls++;
      s.resident.dispatchLeases.push({ id: input.requestId, roomId: input.roomId, participantId: input.participantId, state: 'running' });
      s.resident.rooms[0].ledger.push({ requestId: input.requestId, reservedAt: new Date(time).toISOString() });
      return null;
    } }, resident: { control(id, body) { assert.equal(id, room.id); assert.equal(body.expectedVersion, room.version); room.version++; room.desiredOn = false; } },
    engine: { control(id, body) { const d = state.discussions.find(d => d.id === id); assert.equal(body.expectedRevision, d.revision); d.status = 'paused'; } } };
  const policy = { roomId: 'room', baselineLeases: [], maxRequests: 40, maxApiRequests: 8, maxMs: 1800000, drainMs: 300000, participants: [gpt, api], ...options };
  const guard = acceptanceGuard(app, policy, { clock: () => time, intervalMs: 0 });
  const reserve = (p = gpt, extra = {}) => app.dispatch.reserve(state, { requestId: 'request-' + state.resident.dispatchLeases.length, roomId: 'room', participantId: p.id, participant: p, ...extra }, time);
  const settle = () => { for (const l of state.resident.dispatchLeases) l.state = 'released'; };
  return { app, state, policy, guard, reserve, settle, gpt, api, calls: () => calls, advance: ms => { time += ms; }, deny: v => { deny = v; }, clock: () => time };
}

test('live guard counts reservations durably, denies the 41st before dispatch, and survives restart', () => {
  const f = fixture();
  for (let i = 0; i < 40; i++) { assert.equal(f.reserve(), null); f.settle(); }
  const before = structuredClone(f.state);
  for (let i = 0; i < 10; i++) assert.equal(f.reserve(), 'acceptance_request_limit');
  assert.deepEqual(f.state, before); assert.equal(f.calls(), 40);
  f.guard.close();
  const resumed = acceptanceGuard(f.app, f.policy, { clock: f.clock, intervalMs: 0 });
  assert.equal(f.reserve(), 'acceptance_request_limit');
  resumed.tick(); assert.equal(f.state.resident.rooms[0].desiredOn, false); resumed.close();
});

test('live guard enforces eight API reservations independently while preserving provider identity and High', () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) { assert.equal(f.reserve(f.api), null); f.settle(); }
  const before = structuredClone(f.state);
  assert.equal(f.reserve(f.api), 'acceptance_api_limit'); assert.deepEqual(f.state, before);
  assert.equal(f.reserve(f.gpt), null); f.settle();
  assert.equal(f.reserve({ ...f.api, reasoningEffort: 'max' }), 'acceptance_participant_not_allowed');
  assert.equal(f.reserve({ ...f.gpt, connectionId: 'another-account' }), 'acceptance_participant_not_allowed');
  assert.equal(f.reserve(f.gpt, { roomId: 'another-room' }), 'acceptance_participant_not_allowed');
  assert.throws(() => f.app.codex.beforeDispatch({}, {}), /acceptance_codex_not_authorized/); f.guard.close();
});

test('live guard denies new reservations five minutes before deadline and keeps an in-flight response until deadline', () => {
  const f = fixture(); assert.equal(f.reserve(), null);
  f.state.discussions.push({ id: 'topic', roomId: 'room', status: 'running', revision: 1 });
  f.advance(1500000);
  assert.equal(f.reserve(), 'acceptance_time_limit'); f.guard.tick();
  assert.equal(f.state.resident.rooms[0].desiredOn, true);
  f.advance(300000); f.guard.tick();
  assert.equal(f.state.resident.rooms[0].desiredOn, false); assert.equal(f.state.discussions[0].status, 'paused');
  assert.equal(f.state.resident.dispatchLeases[0].state, 'running'); // Never fabricate completion or resend.
  f.guard.close();
});

test('live guard delegates existing denial and stops safely when the baseline or reservation scope changes', () => {
  const f = fixture(); f.deny('existing_policy_denied');
  assert.equal(f.reserve(), 'existing_policy_denied'); assert.equal(f.calls(), 0);
  assert.equal(f.guard.observe(f.state).requests, 0); f.deny(null);
  assert.equal(f.reserve(), null); f.settle();
  const policy = { ...f.policy, baselineLeases: ['request-0'] };
  f.guard.close(); const restored = acceptanceGuard(f.app, policy, { clock: f.clock, intervalMs: 0 });
  f.state.resident.dispatchLeases.length = 0;
  assert.equal(f.reserve(), 'acceptance_baseline_changed'); restored.tick();
  assert.equal(f.state.resident.rooms[0].desiredOn, false); restored.close();
});

test('live guard rejects higher caps, invalid drains, duplicate participants and non-High API settings', () => {
  for (const p of [{ maxRequests: 41 }, { maxApiRequests: 9 }, { maxMs: 1800001 }, { drainMs: 1 }, { participants: [] }])
    assert.throws(() => fixture(p), /invalid_acceptance_policy/);
  const f = fixture(); f.guard.close();
  assert.throws(() => acceptanceGuard(f.app, { ...f.policy, participants: [f.api, f.api] }), /invalid_acceptance_policy/);
  assert.throws(() => acceptanceGuard(f.app, { ...f.policy, participants: [{ ...f.api, reasoningEffort: 'max' }] }), /invalid_acceptance_policy/);
});

test('live guard composes with the real resident reservation transaction without changing receipts or replaying calls', async t => {
  const { residentFixture } = await import('./resident-fixture.mjs');
  const f = await residentFixture(t, { configure: false });
  f.store.transact(s => {
    const p = s.participants.find(p => p.id === 'fake-a');
    Object.assign(p, { kind: 'openai-oauth', connectionId: 'fixture-gpt-connection', modelId: 'fixture-gpt', reasoningEffort: 'xhigh' });
    s.connections.push({ id: p.connectionId, kind: p.kind, status: 'connected', label: 'Fixture only', models: [{ id: p.modelId, label: 'Fixture only', reasoningEfforts: ['xhigh'] }] });
  });
  const app = { ...f, config: { turnTimeoutMs: 5000 }, codex: {} };
  const guard = acceptanceGuard(app, { roomId: f.roomId, baselineLeases: [], maxRequests: 2, maxApiRequests: 1, maxMs: 1800000, drainMs: 300000,
    participants: [f.store.read().participants.find(p => p.id === 'fake-a')] }, { clock: f.clock, intervalMs: 0 });
  t.after(() => guard.close()); f.configure();
  await f.runner.tick(); f.advance(); await f.runner.tick();
  const before = f.store.read(); assert.equal(f.calls(), 2); assert.equal(before.resident.turns.filter(t => t.status === 'completed').length, 2);
  for (let i = 0; i < 10; i++) { f.advance(); await f.runner.tick(); }
  assert.equal(f.calls(), 2); assert.deepEqual(f.store.read().resident.turns, before.resident.turns);
  assert.deepEqual(f.store.read().resident.messages, before.resident.messages);
  guard.tick(); assert.equal(f.room().desiredOn, false);
});

test('live guard uses the deployed participant snapshot defaults for API output limits', async () => {
  const { snapshotMember } = await import('../dist/server/workspace/settings.js');
  const f = fixture(); f.guard.close();
  const guard = acceptanceGuard(f.app, f.policy, { clock: f.clock, intervalMs: 0, normalizeMember: snapshotMember });
  assert.equal(f.reserve(snapshotMember(f.api)), null); f.settle();
  assert.equal(f.reserve({ ...snapshotMember(f.api), maxOutputTokens: 8192 }), 'acceptance_participant_not_allowed');
  guard.close();
});
