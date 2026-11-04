import test from 'node:test';
import assert from 'node:assert/strict';
import { stoppedDotTopicFixture, key } from './dot-mcp-fixture.mjs';
import { response, until } from './workspace-helpers.mjs';

const failedBody = f => ({ action: 'reconcile', resolution: 'retry_after_failed_submit', expectedRevision: 1,
  turnId: f.stoppedRequestId, stoppedAfterFailedSubmit: true, note: 'Fixture actor stopped after submit error; no receipt or further submission.' });
function revoke(f) {
  f.control({ action: 'off' });
  f.app.dotMcp.revoke(f.connectionId, f.state().dotMcp.bindings[0].version, key());
}

test('D3 failed submit recovery records the attempted submission, preserves answers and resumes only a fresh scoped request', async t => {
  const f = await stoppedDotTopicFixture(t), original = f.state().discussions[0];
  const old = original.turns.find(v => v.id === f.stoppedRequestId), answers = original.turns.filter(v => v.status === 'completed');
  revoke(f);
  const late = { requestId: old.id, ...f.stoppedAttempt, commandId: key(), text: response(old.prompt, original.members.at(-1)) };
  assert.throws(() => f.call('dot_turn_submit', late), /authentication_required/);
  const before = f.state(), command = key(), body = failedBody(f);
  for (let i = 0; i < 20; i++) f.app.engine.control(f.discussionId, body, command);
  let s = f.state(), d = s.discussions[0];
  assert.equal(d.status, 'blocked'); assert.equal(f.room().desiredOn, false);
  assert.deepEqual(d.used, before.discussions[0].used); assert.deepEqual(s.apiUsage, before.apiUsage);
  assert.deepEqual(d.turns.filter(v => answers.some(a => a.id === v.id)), answers);
  assert.equal(d.turns.find(v => v.id === old.id).error, 'owner_confirmed_retry_after_failed_submit');
  assert.equal(d.tasks.find(v => v.id === old.taskId).status, 'pending');
  assert.equal(s.dotMcp.requests.items.find(r => r.id === old.id).status, 'consumed');
  assert.equal(s.resident.dispatchLeases.find(l => l.id === old.id).state, 'released');
  const events = f.app.store.events(0, 10000).filter(e => e.type === 'discussion.retry_prepared');
  assert.equal(events.length, 1); assert.equal(events[0].data.previousError, old.error);
  assert.equal(events[0].data.submitAttempted, true); assert.equal(events[0].data.stoppedWithoutSubmit, false);
  assert.equal(events[0].data.serverReceiptAbsent, true); assert.equal(events[0].data.note, body.note);
  for (let i = 0; i < 20; i++) { await f.step(); await f.app.mcpEvents.pump(); }
  assert.equal(f.state().discussions[0].turns.length, original.turns.length);
  assert.throws(() => f.app.engine.control(f.discussionId, { ...body, note: 'changed' }, command), /idempotency_conflict/);

  f.control({ action: 'on' });
  const next = f.app.dotMcp.confirm({ connectionId: f.connectionId, expectedVersion: f.state().dotMcp.bindings[0].version,
    ownerConfirmed: true, tools: f.grant.tools, expiresAt: new Date(Date.now() + 60000).toISOString() }, key());
  const grant = f.app.dotMcp.authenticate(next.token);
  const call = (name, args) => f.app.dotAdapter.call(name, args, f.app.dotMcp.authenticate(next.token));
  let replacement; const errors = [];
  f.onEvent = async requestId => {
    try {
      const turn = f.state().discussions[0].turns.find(t => t.id === requestId);
      if (turn.taskId === old.taskId) replacement = requestId;
      assert.notEqual(requestId, old.id);
      assert.throws(() => f.call('dot_turn_submit', late), /authentication_required/);
      const attempt = call('dot_turn_claim', { requestId, commandId: key() });
      assert.notEqual(attempt.attemptId, f.stoppedAttempt.attemptId);
      const input = call('dot_turn_get', { requestId, ...attempt }).request;
      const text = JSON.parse(response(input.prompt, f.state().participants.find(p => p.id === f.participantId)));
      text.verifications = [];
      return call('dot_turn_submit', { requestId, ...attempt, commandId: key(), text: JSON.stringify(text) });
    } catch (e) { errors.push(e); throw e; }
  };
  await f.app.mcpEvents.handle('events/subscribe', f.params, grant);
  f.app.engine.control(f.discussionId, { action: 'resume', expectedRevision: 1 }, key());
  await until(() => { if (errors.length) throw errors[0]; return f.state().discussions[0].status === 'completed'; });
  s = f.state(); d = s.discussions[0];
  assert.ok(replacement); assert.equal(d.turns.filter(v => v.taskId === old.taskId && v.status === 'completed').length, 1);
  assert.deepEqual(d.turns.filter(v => answers.some(a => a.id === v.id)), answers);
  assert.equal(s.dotMcp.requests.items.find(r => r.id === old.id).reply, null);
});

test('D3 failed submit recovery requires its own confirmation, revoked old authority and unchanged scope atomically', async t => {
  const f = await stoppedDotTopicFixture(t), body = failedBody(f);
  assert.throws(() => f.app.engine.control(f.discussionId, body, key()), /prior_grant_not_revoked/);
  revoke(f); const base = f.state();
  const cases = [
    ['no failed-submit confirmation', () => {}, { stoppedAfterFailedSubmit: undefined }],
    ['old confirmation is not a substitute', () => {}, { stoppedAfterFailedSubmit: undefined, stoppedWithoutSubmit: true }],
    ['truthy string is not confirmation', () => {}, { stoppedAfterFailedSubmit: 'true' }],
    ['empty evidence', () => {}, { note: ' ' }], ['oversized evidence', () => {}, { note: 'x'.repeat(1001) }],
    ['new generation', s => { s.discussions[0].contexts.at(-1).generation++; }],
    ['receipt present', s => { s.discussions[0].turns.find(t => t.id === f.stoppedRequestId).receipt = 'observed-receipt'; }],
    ['competing lease', s => { s.resident.dispatchLeases.push({ ...s.resident.dispatchLeases.at(-1), id: 'other-lease', state: 'running' }); }],
  ];
  for (const [name, change, patch = {}] of cases) await t.test(name, () => {
    const snapshot = structuredClone(base); change(snapshot);
    f.app.store.transact(s => Object.assign(s, snapshot)); const events = f.app.store.events(0, 10000).length;
    assert.throws(() => f.app.engine.control(f.discussionId, { ...body, ...patch }, key()));
    assert.deepEqual(f.state(), snapshot); assert.equal(f.app.store.events(0, 10000).length, events);
  });
  f.app.store.transact(s => Object.assign(s, base));
});

test('D3 an error after a stored submit cannot authorize another result or erase the existing receipt', async t => {
  const f = await stoppedDotTopicFixture(t), d = f.state().discussions[0], old = d.turns.find(v => v.id === f.stoppedRequestId);
  const submitted = f.call('dot_turn_submit', { requestId: old.id, ...f.stoppedAttempt, commandId: key(), text: response(old.prompt, d.members.at(-1)) });
  assert.equal(submitted.accepted, true); assert.ok(submitted.receipt);
  revoke(f); const before = f.state();
  assert.throws(() => f.app.engine.control(f.discussionId, failedBody(f), key()), /dot_retry_reply_exists/);
  assert.deepEqual(f.state(), before);
  assert.equal(before.dotMcp.requests.items.find(r => r.id === old.id).reply.receipt, submitted.receipt);
});
