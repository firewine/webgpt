import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace, until, topic } from './workspace-helpers.mjs';
import { coralModel } from './anthropic-fixture.mjs';
import { budget, pacing } from './resident-fixture.mjs';

function failedStream(reason = 'length', { done = true, usage = true, malformed = false } = {}) {
  const events = [{ id: 'failure-receipt', choices: [{ index: 0, delta: { reasoning_content: 'PRIVATE_REASONING_NOT_A_REPLY' }, finish_reason: null }] },
    { id: 'failure-receipt', choices: [{ index: 0, delta: {}, finish_reason: reason }] },
    ...(usage ? [{ choices: [], usage: { prompt_tokens: 31, completion_tokens: 4096 } }] : [])];
  return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + (malformed ? 'data: not-json\n\n' : done ? 'data: [DONE]\n\n' : ''), { headers: { 'Content-Type': 'text/event-stream' } });
}
async function setup(t, extra = {}, options = {}) {
  const f = await workspace(t, extra, { residentAutoSchedule: false }); let calls = 0, handler = () => failedStream();
  f.app.providers.request = async url => url.endsWith('/models') ? Response.json({ data: [coralModel] }) : (calls++, handler());
  const cid = await f.app.addDeepSeek({ label: 'Failure fixture', apiService: 'coralbricks', key: 'fixture-key' });
  const pid = f.app.participant({ connectionId: cid, modelId: coralModel.id, label: 'DS failure fixture', reasoningEffort: 'max' });
  const input = { requestId: 'failure-fixture', participant: f.app.store.read().participants.find(p => p.id === pid), prompt: 'fixture', history: [], signal: AbortSignal.timeout(5000), hooks: { dispatched() {}, receipt() {}, delta() { throw Error('reasoning_must_not_escape'); } } };
  return { ...f, pid, input, calls: () => calls, handler: value => { handler = value; } };
}
test('DeepSeek non-stop terminal evidence drains the same SSE to collect late usage without returning thinking or retrying', async t => {
  const f = await setup(t); let receipt;
  await assert.rejects(f.app.providers.complete({ ...f.input, hooks: { ...f.input.hooks, receipt(id) { receipt = id; } } }), e => e.code === 'response_not_completed' && e.uncertain === false && e.finishReason === 'length' && e.usage.input === 31 && e.usage.output === 4096 && !JSON.stringify(e).includes('PRIVATE_'));
  assert.equal(receipt, 'failure-receipt'); assert.equal(f.calls(), 1);
});
for (const reason of ['content_filter', 'tool_calls', 'function_call', 'PRIVATE_PROVIDER_PROSE']) test('DeepSeek failure reason ' + reason + ' stays a bounded protocol label, never a completed reply', async t => {
  const f = await setup(t); f.handler(() => failedStream(reason));
  await assert.rejects(f.app.providers.complete(f.input), e => e.code === 'response_not_completed' && e.finishReason === (reason.startsWith('PRIVATE_') ? 'other' : reason) && !JSON.stringify(e).includes('PRIVATE_')); assert.equal(f.calls(), 1);
});
test('non-stop EOF/malformed streams remain uncertain while retaining only observed reason and reported counts', async t => {
  const f = await setup(t);
  for (const options of [{ done: false }, { malformed: true }, { done: false, usage: false }]) {
    f.handler(() => failedStream('length', options)); await assert.rejects(f.app.providers.complete(f.input), e => e.code === 'stream_unconfirmed' && e.uncertain && e.finishReason === 'length' && (options.usage === false ? e.usage === null : e.usage.output === 4096));
  }
  assert.equal(f.calls(), 3);
  f.handler(() => failedStream('stop', { done: false })); await assert.rejects(f.app.providers.complete(f.input), e => e.code === 'stream_unconfirmed' && e.uncertain && e.finishReason === 'stop' && e.usage.output === 4096); assert.equal(f.calls(), 4);
});
test('topic failure persists reason and late usage atomically; its reported consumption blocks a resumed over-budget dispatch', async t => {
  const f = await setup(t); const id = f.app.engine.create({ ...topic, participantIds: [f.pid, 'fake-a'], limits: { maxRequests: 12, maxTokens: 2000 } }, 'length-topic');
  await until(() => f.app.discussion(id).discussion.status === 'blocked'); let d = f.app.discussion(id).discussion;
  assert.equal(d.turns.length, 1); assert.equal(d.turns[0].status, 'failed'); assert.equal(d.turns[0].providerFinishReason, 'length'); assert.equal(d.turns[0].reply, null); assert.equal(d.turns[0].text, ''); assert.equal(d.turns[0].receipt, 'failure-receipt'); assert.deepEqual(d.turns[0].usage, { input: 31, output: 4096 }); assert.equal(d.used.outputTokens, 4096); assert.equal(d.used.unknownUsage, 0);
  const response = await f.api('/api/discussions/' + id); assert.equal((await response.json()).discussion.turns[0].providerFinishReason, 'length');
  f.app.engine.control(id, { action: 'resume', expectedRevision: d.revision }, 'resume-recorded-failure'); await until(() => f.app.discussion(id).discussion.status === 'partial'); d = f.app.discussion(id).discussion; assert.equal(d.used.requests, 1); assert.equal(f.calls(), 1);
  f.handler(() => failedStream('length', { usage: false })); const missing = f.app.engine.create({ ...topic, participantIds: [f.pid, 'fake-a'] }, 'missing-usage-topic'); await until(() => f.app.discussion(missing).discussion.status === 'blocked'); const unreported = f.app.discussion(missing).discussion;
  assert.equal(unreported.used.unknownUsage, 1); assert.equal(unreported.used.inputTokens, 0); assert.equal(unreported.used.outputTokens, 0); assert.equal(unreported.turns[0].usage, null); assert.equal(f.calls(), 2); assert.equal(f.app.discussion(id).discussion.turns[0].usage.output, 4096);
});
test('resident failure keeps reported consumption in the existing ledger and blocks the room without a message, proposal or replay', async t => {
  const f = await setup(t, { residentEnabled: true }); const room = f.app.resident.snapshot().rooms[0].id;
  const control = body => f.app.resident.control(room, { ...body, expectedVersion: f.app.resident.room(room).room.version }, crypto.randomUUID());
  f.app.configureApiDaily({ expectedVersion: 0, maxRequests: 100, maxTokens: 1000000 }, 'fixture-api-policy');
  control({ action: 'configure', budgets: budget(Date.now()), pacing }); control({ action: 'set_member', participantId: f.pid, enabled: true }); control({ action: 'on' });
  await f.app.residentRunner.tick(); const r = f.app.store.read().resident, turn = r.turns[0];
  assert.equal(turn.status, 'failed'); assert.equal(turn.providerFinishReason, 'length'); assert.equal(turn.text, ''); assert.equal(turn.reply, null); assert.deepEqual(turn.usage, { input: 31, output: 4096 }); assert.deepEqual(r.rooms[0].ledger[0].usage, turn.usage); assert.equal(r.rooms[0].observedStatus, 'blocked'); assert.equal(r.messages.filter(m => m.sourceKind === 'room').length, 0); assert.equal(r.workItems.length, 0);
  await f.app.residentRunner.tick(); assert.equal(f.calls(), 1); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_REASONING/);
});
