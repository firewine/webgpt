import test from 'node:test';
import assert from 'node:assert/strict';
import { stoppedDotTopicFixture, key } from './dot-mcp-fixture.mjs';
import { response, until } from './workspace-helpers.mjs';

const bodyFor = f => ({ action: 'reconcile', resolution: 'retry_after_authority_revoked', expectedRevision: 1,
  turnId: f.stoppedRequestId, acceptUnverifiedExecution: true, monitorDisabled: true, note: 'Monitor disabled; external final status and later submission history unavailable.' });
const revoke = f => { f.control({ action: 'off' }); f.app.dotMcp.revoke(f.connectionId, f.state().dotMcp.bindings[0].version, key()); };

test('unknown termination recovery preserves five answers and uncertainty, with no send until explicit resume', async t => {
  const f = await stoppedDotTopicFixture(t); revoke(f);
  const before = f.state(), d = before.discussions[0], old = d.turns.find(t => t.id === f.stoppedRequestId);
  const request = before.dotMcp.requests.items.find(r => r.id === old.id), answers = d.turns.filter(t => t.status === 'completed');
  assert.equal(answers.length, 5);
  const body = bodyFor(f), command = key();
  for (let i = 0; i < 20; i++) f.app.engine.control(d.id, body, command);
  let s = f.state(); const prepared = s.discussions[0];
  assert.deepEqual(prepared.turns.filter(t => t.status === 'completed'), answers);
  assert.deepEqual(prepared.turns.find(t => t.id === old.id), { ...old, status: 'failed', error: 'owner_confirmed_retry_after_authority_revoked' });
  assert.deepEqual(s.dotMcp.requests.items.find(r => r.id === old.id), { ...request, status: 'consumed' });
  assert.deepEqual(prepared.used, d.used); assert.deepEqual(s.apiUsage, before.apiUsage);
  assert.equal(prepared.status, 'blocked'); assert.equal(f.room().desiredOn, false);
  assert.equal(prepared.tasks.find(t => t.id === old.taskId).status, 'pending');
  assert.equal(s.resident.dispatchLeases.find(l => l.id === old.id).state, 'released');
  const audits = f.app.store.events(0, 10000).filter(e => e.type === 'discussion.retry_prepared');
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].data, { turnId: old.id, taskId: old.taskId, revision: d.revision, previousError: old.error,
    resolution: body.resolution, externalExecution: 'unverified', submissionHistory: 'unverified', priorGrantRevoked: true,
    monitorDisabled: true, acceptUnverifiedExecution: true, serverReceiptAbsent: true, note: body.note });
  assert.equal(Object.hasOwn(audits[0].data, 'stoppedWithoutSubmit'), false);
  assert.equal(Object.hasOwn(audits[0].data, 'submitAttempted'), false);
  for (let i = 0; i < 20; i++) { await f.step(); await f.app.mcpEvents.pump(); }
  assert.equal(f.state().discussions[0].turns.length, d.turns.length);
  assert.throws(() => f.app.engine.control(d.id, { ...body, monitorDisabled: false }, command), /idempotency_conflict/);

  f.control({ action: 'on' });
  const access = f.app.dotMcp.confirm({ connectionId: f.connectionId, expectedVersion: f.state().dotMcp.bindings[0].version,
    ownerConfirmed: true, tools: f.grant.tools, expiresAt: new Date(Date.now() + 60000).toISOString() }, key());
  const grant = f.app.dotMcp.authenticate(access.token), call = (name, args) => f.app.dotAdapter.call(name, args, grant);
  const late = { requestId: old.id, ...f.stoppedAttempt, commandId: key(), text: response(old.prompt, d.members.at(-1)) };
  assert.throws(() => f.call('dot_turn_submit', late), /authentication_required/);
  assert.throws(() => call('dot_turn_submit', late), /request_not_in_scope/);
  let replacement, receipt; const errors = [];
  const unsubscribe = f.app.store.subscribe(e => {
    if (e.type === 'turn.finished' && e.data.turnId === replacement)
      f.app.engine.control(d.id, { action: 'pause', expectedRevision: d.revision }, key());
  }); t.after(unsubscribe);
  f.onEvent = async requestId => {
    try {
      const current = f.state().discussions[0], turn = current.turns.find(t => t.id === requestId);
      assert.equal(turn.taskId, old.taskId); replacement = requestId; assert.notEqual(requestId, old.id);
      const attempt = call('dot_turn_claim', { requestId, commandId: key() });
      assert.notEqual(attempt.attemptId, f.stoppedAttempt.attemptId);
      assert.throws(() => call('dot_turn_get', { ...f.stoppedAttempt, requestId, inputPage: 0 }), /attempt_not_in_scope/);
      const beforeSubmit = f.state(), eventCount = f.app.store.events(0, 10000).length;
      assert.throws(() => call('dot_turn_submit', { ...late, requestId }), /attempt_not_in_scope/);
      assert.deepEqual(f.state(), beforeSubmit); assert.equal(f.app.store.events(0, 10000).length, eventCount);
      const input = call('dot_turn_get', { requestId, ...attempt }).request;
      assert.equal(input.inputDigest, request.inputDigest); assert.equal(input.prompt, request.prompt); assert.deepEqual(input.history, request.history);
      const answer = JSON.parse(response(input.prompt, current.members.at(-1))); answer.verifications = [];
      const result = call('dot_turn_submit', { requestId, ...attempt, commandId: key(), text: JSON.stringify(answer) });
      assert.equal(result.accepted, true); receipt = result.receipt;
    } catch (e) { errors.push(e); throw e; }
  };
  await f.app.mcpEvents.handle('events/subscribe', f.params, grant);
  f.app.engine.control(d.id, { action: 'resume', expectedRevision: d.revision }, key());
  await until(() => { if (errors.length) throw errors[0]; return f.state().discussions[0].status === 'paused'; });
  s = f.state(); const completed = s.discussions[0].turns.find(t => t.id === replacement);
  assert.equal(completed.status, 'completed'); assert.equal(completed.receipt, receipt);
  assert.deepEqual(s.discussions[0].turns.filter(t => answers.some(a => a.id === t.id)), answers);
  assert.equal(s.dotMcp.requests.items.find(r => r.id === old.id).reply, null);
});

test('unverified recovery requires separate consent, disabled monitor, revoked grant and no active subscription atomically', async t => {
  const f = await stoppedDotTopicFixture(t), body = bodyFor(f);
  assert.throws(() => f.app.engine.control(f.discussionId, body, key()), /prior_grant_not_revoked/);
  revoke(f); const base = f.state();
  const cases = [
    ['missing uncertainty acceptance', () => {}, { acceptUnverifiedExecution: undefined }],
    ['truthy uncertainty acceptance', () => {}, { acceptUnverifiedExecution: 'true' }],
    ['old stop declaration is not acceptance', () => {}, { acceptUnverifiedExecution: undefined, stoppedWithoutSubmit: true }],
    ['missing monitor confirmation', () => {}, { monitorDisabled: undefined }],
    ['truthy monitor confirmation', () => {}, { monitorDisabled: 'true' }],
    ['monitor still enabled', () => {}, { monitorDisabled: false }],
    ['empty note', () => {}, { note: ' ' }], ['oversized note', () => {}, { note: 'x'.repeat(1001) }],
    ['expired is not revoked', s => { s.dotMcp.grants.find(g => g.id === f.grant.id).status = 'expired'; }],
    ['active old subscription', s => { s.dotMcp.events.subscriptions.find(x => x.grantId === f.grant.id).status = 'active'; }],
    ['changed input', s => { s.discussions[0].contexts.at(-1).history.push({ role: 'user', content: 'different' }); }],
    ['changed generation', s => { s.discussions[0].contexts.at(-1).generation++; }],
    ['receipt present', s => { s.discussions[0].turns.find(t => t.id === f.stoppedRequestId).receipt = 'receipt-observed'; }],
    ['competing lease', s => { s.resident.dispatchLeases.push({ ...s.resident.dispatchLeases.at(-1), id: 'competing', state: 'running' }); }],
  ];
  for (const [name, change, patch = {}] of cases) await t.test(name, () => {
    const snapshot = structuredClone(base); change(snapshot); f.app.store.transact(s => Object.assign(s, snapshot));
    const count = f.app.store.events(0, 10000).length;
    assert.throws(() => f.app.engine.control(f.discussionId, { ...body, ...patch }, key()));
    assert.deepEqual(f.state(), snapshot); assert.equal(f.app.store.events(0, 10000).length, count);
  });
  f.app.store.transact(s => Object.assign(s, base));
});

test('an already stored reply cannot be discarded by accepting unverified termination', async t => {
  const f = await stoppedDotTopicFixture(t), d = f.state().discussions[0], old = d.turns.find(t => t.id === f.stoppedRequestId);
  const result = f.call('dot_turn_submit', { requestId: old.id, ...f.stoppedAttempt, commandId: key(), text: response(old.prompt, d.members.at(-1)) });
  assert.equal(result.accepted, true); revoke(f);
  const before = f.state(), events = f.app.store.events(0, 10000).length;
  assert.throws(() => f.app.engine.control(d.id, bodyFor(f), key()), /reply_exists/);
  assert.deepEqual(f.state(), before); assert.equal(f.app.store.events(0, 10000).length, events);
  assert.equal(before.dotMcp.requests.items.find(r => r.id === old.id).reply.receipt, result.receipt);
});
