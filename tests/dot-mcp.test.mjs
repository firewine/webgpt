import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { dotFixture, stoppedDotTopicFixture, key } from './dot-mcp-fixture.mjs';
import { until, topic, response } from './workspace-helpers.mjs';
import { reply } from './resident-fixture.mjs';
import { participantWait } from '../dist/server/workspace/api-usage.js';
import { readDotState } from '../dist/server/workspace/dot-mcp.js';
import { dotInputPage, dotToolResult, DOT_INPUT_PAGE_BYTES } from '../dist/server/connections/dot-input-pages.js';
import { dotInputDigest } from '../dist/server/workspace/dot-mcp-policy.js';
import { topicPublishedTurns } from '../dist/client/web/topic-chat-view.js';
import { AppError } from '../dist/server/workspace/util.js';

test('D3 owner stopped retry preserves accepted answers, requires resume and fences late replies and old credentials', async t => {
  const f = await stoppedDotTopicFixture(t), before = f.state(), d = before.discussions[0];
  const old = d.turns.find(v => v.id === f.stoppedRequestId), original = before.dotMcp.requests.items.find(r => r.id === old.id);
  const answers = d.turns.filter(v => v.status === 'completed'); assert.equal(answers.length, 5);
  assert.throws(() => f.app.engine.control(d.id, { action: 'resume', expectedRevision: 1 }, key()), /reconciliation_required/);
  const command = key();
  for (let i = 0; i < 20; i++) f.app.engine.control(d.id, f.retryBody, command);
  let s = f.state(); const retry = s.discussions[0];
  assert.equal(retry.status, 'blocked'); assert.equal(retry.tasks.find(v => v.id === old.taskId).status, 'pending');
  assert.equal(retry.turns.find(v => v.id === old.id).error, 'owner_confirmed_retry_after_stop');
  assert.deepEqual(retry.used, d.used); assert.deepEqual(s.apiUsage, before.apiUsage);
  assert.deepEqual(s.dotMcp.requests.items.find(r => r.id === old.id), { ...original, status: 'consumed' });
  assert.equal(s.resident.dispatchLeases.find(l => l.id === old.id).state, 'released');
  const audit = f.app.store.events(0, 10000).filter(e => e.type === 'discussion.retry_prepared');
  assert.equal(audit.length, 1); assert.equal(audit[0].data.previousError, old.error); assert.equal(audit[0].data.note, f.retryBody.note);
  assert.throws(() => f.app.engine.control(d.id, { ...f.retryBody, note: 'changed' }, command), /idempotency_conflict/);
  assert.throws(() => f.app.engine.control(d.id, f.retryBody, key()), /unconfirmed_turn_not_found/);
  for (let i = 0; i < 20; i++) { await f.step(); await f.app.mcpEvents.pump(); }
  assert.equal(f.state().discussions[0].turns.length, d.turns.length); assert.equal(f.deliveries.length, 2);
  const late = { requestId: old.id, ...f.stoppedAttempt, commandId: key(), text: response(old.prompt, d.members.at(-1)) };
  assert.equal(f.call('dot_turn_submit', late).accepted, false);
  assert.equal(f.state().dotMcp.requests.items.find(r => r.id === old.id).reply.disposition, 'quarantined');
  let replacement; const actorErrors = [];
  f.onEvent = async requestId => {
    try {
    const turn = f.state().discussions[0].turns.find(v => v.id === requestId);
    if (turn.taskId === old.taskId) {
      replacement = requestId; assert.notEqual(requestId, old.id);
      assert.equal(f.call('dot_turn_submit', late).accepted, false);
      assert.throws(() => f.call('dot_turn_get', { ...f.stoppedAttempt, requestId, inputPage: 0 }), /attempt_not_in_scope/);
      const attempt = f.claim(requestId); assert.notEqual(attempt.attemptId, f.stoppedAttempt.attemptId);
      let inputPage = 0, text = '', count;
      do { const r = f.call('dot_turn_get', { requestId, ...attempt, inputPage }).request; count = r.input.pageCount; text += r.input.text; inputPage = r.input.nextPage; } while (inputPage !== null);
      assert.ok(count > 1); assert.deepEqual(JSON.parse(text), { prompt: original.prompt, history: original.history });
    }
    return await f.respond(requestId);
    } catch (error) { actorErrors.push(error); throw error; }
  };
  f.app.engine.control(d.id, { action: 'resume', expectedRevision: 1 }, key());
  await until(() => { if (actorErrors.length) throw actorErrors[0]; const current = f.state().discussions[0];
    assert.ok(!['blocked', 'partial'].includes(current.status), JSON.stringify({ status: current.status, phase: current.phase, reason: current.reason })); return current.status === 'completed'; });
  s = f.state(); const after = s.discussions[0];
  assert.ok(replacement); assert.equal(after.turns.filter(v => v.taskId === old.taskId && v.status === 'completed').length, 1);
  assert.deepEqual(after.turns.filter(v => answers.some(a => a.id === v.id)), answers);
  assert.equal(after.turns.find(v => v.id === old.id).text, old.text);
  for (const round of [1, 2]) assert.equal(topicPublishedTurns(after).filter(v => v.phase === 'cross_review' && v.round === round).length, 3);
  assert.equal(s.dotMcp.requests.items.find(r => r.id === old.id).reply.text, late.text);
});

test('D3 stopped retry rejects missing confirmation, changed scope/input, existing results and competing execution atomically', async t => {
  const f = await stoppedDotTopicFixture(t), base = f.state(), did = f.discussionId;
  const context = s => { const d = s.discussions[0], turn = d.turns.find(v => v.id === f.stoppedRequestId); return { d, turn, task: d.tasks.find(v => v.id === turn.taskId), r: s.dotMcp.requests.items.find(v => v.id === turn.id) }; };
  const cases = [
    ['confirmation missing', () => {}, { stoppedWithoutSubmit: undefined }],
    ['confirmation is not boolean', () => {}, { stoppedWithoutSubmit: 'true' }],
    ['empty evidence', () => {}, { note: '  ' }], ['oversized evidence', () => {}, { note: 'x'.repeat(1001) }],
    ['wrong turn', () => {}, { turnId: 'foreign-turn' }], ['stale revision command', () => {}, { expectedRevision: 2 }],
    ...['cancelled', 'completed', 'partial', 'running'].map(status => ['discussion ' + status, (s, c) => { c.d.status = status; }]),
    ['non-native', (s, c) => { c.d.members.at(-1).kind = 'browser'; }],
    ['mailbox reply', (s, c) => { c.r.reply = { text: 'received' }; }],
    ['partial raw result', (s, c) => { c.turn.text = 'already received'; }],
    ['receipt', (s, c) => { c.turn.receipt = 'observed'; }],
    ['missing request', s => { s.dotMcp.requests.items = s.dotMcp.requests.items.filter(r => r.id !== f.stoppedRequestId); }],
    ['request not held', (s, c) => { c.r.status = 'waiting'; }],
    ['wrong participant', (s, c) => { c.r.participantId = 'fake-a'; }],
    ['old task', (s, c) => { c.task.turnId = 'other'; }],
    ['newer turn', (s, c) => { c.d.turns.push({ ...c.turn, id: 'newer', status: 'failed' }); }],
    ['old revision', (s, c) => { c.task.revision++; }],
    ['different phase', (s, c) => { c.d.phase = 'revision'; }],
    ['different round', (s, c) => { c.d.round++; }],
    ['new generation', (s, c) => { c.d.contexts.at(-1).generation++; }],
    ['identity changed', s => { s.participants.find(p => p.id === f.participantId).modelId = 'changed'; }],
    ['removed participant', (s, c) => { c.d.excludedIds.push(f.participantId); }],
    ['changed focus', s => { s.resident.rooms[0].topicLink = null; }],
    ['task has job', (s, c) => { c.task.jobId = 'existing-job'; }],
    ['task requests Codex', (s, c) => { c.task.method = 'codex'; }],
    ['changed prompt', (s, c) => { c.turn.prompt += 'changed'; }],
    ['changed criteria', (s, c) => { c.d.criteria += 'changed'; }],
    ['changed history', (s, c) => { c.d.contexts.at(-1).history.push({ role: 'user', content: 'changed' }); }],
    ['Wiki visibility changed', (s, c) => { c.turn.wikiCitations = [{ pageId: 'no-access', versionId: 'private' }]; }],
    ['competing lease', s => { s.resident.dispatchLeases.push({ ...s.resident.dispatchLeases.at(-1), id: 'competing', state: 'running' }); }],
    ['competing turn', (s, c) => { c.d.turns.push({ ...c.turn, id: 'competing', taskId: 'other', status: 'running' }); }],
  ];
  for (const [name, change, body = {}] of cases) await t.test(name, () => {
    const snapshot = structuredClone(base); change(snapshot, context(snapshot));
    f.app.store.transact(s => Object.assign(s, snapshot)); const events = f.app.store.events(0, 10000).length;
    assert.throws(() => f.app.engine.control(did, { ...f.retryBody, ...body }, key()), AppError);
    assert.deepEqual(f.state(), snapshot); assert.equal(f.app.store.events(0, 10000).length, events);
  });
  f.app.store.transact(s => Object.assign(s, base));
});

test('D3 stopped retry with revoked grant and room off closes only the old request; resume still needs current authority', async t => {
  const f = await stoppedDotTopicFixture(t);
  f.control({ action: 'off' }); f.app.dotMcp.revoke(f.connectionId, f.state().dotMcp.bindings[0].version, key());
  const before = f.state(); f.app.engine.control(f.discussionId, f.retryBody, key());
  assert.equal(f.room().desiredOn, false); assert.deepEqual(f.state().dotMcp.grants, before.dotMcp.grants);
  assert.deepEqual(f.state().dotMcp.events.subscriptions, before.dotMcp.events.subscriptions);
  const requests = f.state().dotMcp.requests.items.length;
  f.app.engine.control(f.discussionId, { action: 'resume', expectedRevision: 1 }, key());
  await until(() => f.state().discussions[0].reason === 'dot_grant_required');
  assert.equal(f.state().dotMcp.requests.items.length, requests); assert.equal(f.deliveries.length, 2);
  assert.throws(() => f.call('dot_turn_get', { requestId: f.stoppedRequestId }), /revoked|authentication|grant/);
});

for (const size of [35_812, 179_000]) test('D3 paged input preserves every original character and review reference at ' + size + ' chars', () => {
  const unit = '한글🙂e\u0301"\\\n\t\u0000';
  const claims = Array.from({ length: 12 }, (_, i) => `CLAIM_${i}_ORIGINAL_반론`).join('\n');
  const long = unit.repeat(Math.ceil(size / unit.length)).slice(0, size - claims.length - 30);
  const input = { prompt: 'FIRST 원문\n' + long.slice(0, Math.floor(long.length / 2)) + claims,
    history: [{ role: 'user', content: long.slice(Math.floor(long.length / 2)) }, { role: 'assistant', content: 'LAST 근거 \ud800' }] };
  const inputDigest = dotInputDigest(input.prompt, input.history);
  const project = page => ({ event: { name: 'webjjoku.turn_requested', arguments: { roomId: 'r'.repeat(200), participantId: 'p'.repeat(200), connectionId: 'c'.repeat(200) } },
    request: { requestId: 't'.repeat(200), status: 'waiting', receipt: null, inputDigest, usage: null, input: page } });
  let index = 0, text = '', count;
  do {
    const page = dotInputPage(input, index, project); count ??= page.pageCount;
    assert.equal(page.pageCount, count); assert.equal(page.pageIndex, index); assert.equal(page.encoding, 'json');
    const envelope = { jsonrpc: '2.0', id: 'i'.repeat(200), result: dotToolResult(project(page)) };
    assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= DOT_INPUT_PAGE_BYTES);
    assert.ok(page.text.isWellFormed(), 'JSON pages never split surrogate pairs');
    text += page.text; index = page.nextPage;
  } while (index !== null);
  assert.ok(count > 10); assert.deepEqual(JSON.parse(text), input);
  assert.equal(dotInputDigest(JSON.parse(text).prompt, JSON.parse(text).history), inputDigest);
  for (let i = 0; i < 12; i++) assert.ok(text.includes(`CLAIM_${i}_ORIGINAL_반론`));
  assert.throws(() => dotInputPage(input, count, project), /invalid_dot_input_page/);
});

test('D3 page reads retain legacy get and one winning claim; twenty reads create no dispatch or publication', async t => {
  const f = await dotFixture(t); let requestId; f.onEvent = async id => { requestId = id; };
  for (let i = 0; i < 8; i++) f.app.resident.postMessage(f.roomId, { text: `SOURCE_${i}_START ` + '긴 원문·반론🙂 '.repeat(200) + ` SOURCE_${i}_END` }, key());
  const pending = f.step(); await until(() => requestId); const attempt = f.claim(requestId);
  const original = f.call('dot_turn_get', { requestId, ...attempt }).request;
  assert.equal(original.input, undefined); assert.ok(original.prompt.length > 12_000);
  const before = f.state(); let text = '', pageIndex = 0, count;
  do {
    const rpc = await f.rpc('tools/call', { name: 'dot_turn_get', arguments: { requestId, ...attempt, inputPage: pageIndex } });
    assert.ok(Buffer.byteLength(JSON.stringify(rpc)) <= DOT_INPUT_PAGE_BYTES);
    assert.equal(rpc.result.structuredContent, undefined, 'new pages carry the original JSON once');
    const r = JSON.parse(rpc.result.content[0].text).request, page = r.input;
    assert.equal(page.transportVersion, 2);
    assert.equal(r.requestId, requestId); assert.equal(r.inputDigest, original.inputDigest);
    assert.equal(r.prompt, undefined); assert.equal(r.history, undefined);
    count ??= page.pageCount; assert.equal(page.pageCount, count); assert.equal(page.pageIndex, pageIndex);
    text += page.text; pageIndex = page.nextPage;
  } while (pageIndex !== null);
  assert.deepEqual(JSON.parse(text), { prompt: original.prompt, history: original.history });
  for (let i = 0; i < 8; i++) assert.ok(text.includes(`SOURCE_${i}_END`));
  const first = f.call('dot_turn_get', { requestId, ...attempt, inputPage: 0 });
  for (let i = 0; i < 20; i++) assert.deepEqual(f.call('dot_turn_get', { requestId, ...attempt, inputPage: 0 }), first);
  assert.deepEqual(f.state(), before, 'page reads do not write state, leases, claims, messages or usage');
  for (const inputPage of [-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1, count])
    assert.throws(() => f.call('dot_turn_get', { requestId, ...attempt, inputPage }), /invalid_dot_input_page/);
  assert.throws(() => f.call('dot_turn_get', { requestId, inputPage: 0 }), /attempt_not_in_scope/);
  assert.throws(() => f.call('dot_turn_get', { inputPage: 0 }), /invalid_/);
  assert.throws(() => f.call('dot_turn_get', { requestId, ...attempt, attemptToken: 'wrong', inputPage: 0 }), /attempt_not_in_scope/);
  assert.throws(() => f.call('dot_turn_get', { ...attempt, requestId: 'foreign', inputPage: 0 }), /not_in_scope/);
  assert.throws(() => f.call('dot_turn_claim', { requestId, commandId: 'another' }), /already_claimed/);
  f.call('dot_turn_submit', { requestId, ...attempt, commandId: key(), text: reply() });
  assert.deepEqual(f.call('dot_turn_get', { requestId, ...attempt, inputPage: 0 }).request.input, first.request.input, 'receipt arrival cannot change page boundaries');
  await pending;
  assert.equal(f.deliveries.length, 1); assert.equal(f.state().resident.messages.filter(m => m.sourceId === requestId).length, 1);
});

test('D3 native tools retain connection authority across on/off, expose frozen input only to one claimant and apply twenty submits once', async t => {
  const f = await dotFixture(t); let requestId; f.onEvent = async id => { requestId = id; };
  assert.deepEqual((await f.app.providers.models(f.connectionId)).map(m => m.id), ['native-dot']);
  f.control({ action: 'off' }); f.control({ action: 'on' }); assert.equal(f.app.dotMcp.authenticate(f.access.token).id, f.grant.id);
  const pending = f.step(); await until(() => requestId);
  const meta = (await f.rpc('tools/call', { name: 'dot_turn_get', arguments: { requestId } })).result.structuredContent;
  assert.equal(meta.request.requestId, requestId); assert.equal(meta.request.prompt, undefined);
  const attempts = Array.from({ length: 20 }, () => f.claim(requestId)); assert.ok(attempts.every(a => a.attemptToken === attempts[0].attemptToken));
  assert.throws(() => f.call('dot_turn_claim', { requestId, commandId: 'another-claimant' }), /already_claimed/);
  assert.throws(() => f.call('dot_turn_get', { requestId, attemptId: attempts[0].attemptId, attemptToken: 'wrong' }), /not_in_scope/);
  assert.throws(() => f.call('dot_turn_get', { requestId: 'foreign-request' }), /not_in_scope/);
  for (const name of ['resident_message_post', 'work_claim', 'wiki_edit', 'codex_send', 'result_submit']) assert.throws(() => f.call(name), /not_granted/);
  const outcomes = await Promise.all(Array.from({ length: 100 }, (_, i) => Promise.resolve().then(() => f.app.store.transact(s => f.app.dispatch.reserve(s,
    { requestId: 'competing-' + i, kind: ['resident', 'topic', 'work'][i % 3], participantId: 'fake-a', generation: 1, roomId: f.roomId })))));
  assert.ok(outcomes.every(x => x === 'dispatch_busy'));
  const originalReply = '\n  ' + reply() + '\n'; await f.respond(requestId, originalReply, 20); await pending;
  const s = f.state(), turn = s.resident.turns[0]; assert.equal(turn.status, 'completed'); assert.equal(turn.usage, null);
  assert.equal(turn.text, originalReply);
  assert.equal(s.dotMcp.requests.items.length, 1); assert.equal(s.dotMcp.requests.items[0].status, 'consumed');
  assert.equal(s.resident.messages.filter(m => m.sourceId === requestId).length, 1); assert.equal(f.deliveries.length, 1);
  assert.equal(new Set(f.answers[0].results.map(r => r.receipt)).size, 1); assert.equal(turn.receipt, f.answers[0].results[0].receipt);
  assert.equal(s.resident.dispatchLeases.filter(l => l.state !== 'released').length, 0);
  assert.throws(() => f.call('dot_turn_submit', { ...f.answers[0].body, commandId: key(), text: reply({ text: 'conflict' }) }), /reply_conflict/);
  assert.equal(f.call('dot_turn_submit', f.answers[0].body).receipt, turn.receipt);
  const db = new DatabaseSync(join(f.directory, 'workspace.sqlite'), { readOnly: true });
  const serialized = JSON.stringify([s, f.app.snapshot(), db.prepare('SELECT * FROM commands').all(), f.app.store.events(0)]); db.close();
  for (const secret of [attempts[0].attemptToken, f.access.token, f.params.delivery.secret, f.params.delivery.url]) assert.ok(!serialized.includes(secret));
  assert.doesNotThrow(() => readDotState(s));
  f.control({ action: 'off' }); f.app.removeConnection(f.connectionId, key());
  assert.equal(f.app.vault.get(attempts[0].attemptId), null);
  assert.deepEqual(f.state().resident.turns[0], turn); assert.equal(f.state().dotMcp.requests.items[0].reply.text, originalReply);
});

test('D3 absent subscription across 100 ticks never dispatches dot or prevents a ready participant', async t => {
  const f = await dotFixture(t, { subscribe: false });
  f.control({ action: 'set_member', participantId: 'fake-a', enabled: true });
  for (let i = 0; i < 100; i++) await f.step();
  assert.ok(f.state().resident.turns.length > 0); assert.ok(f.state().resident.turns.every(t => t.participantId === 'fake-a'));
  assert.equal(f.deliveries.length, 0); assert.equal(f.state().dotMcp.requests.items.length, 0);
  await f.subscribe(); f.control({ action: 'set_member', participantId: 'fake-a', enabled: false }); f.control({ action: 'on' }); await f.step();
  assert.equal(f.state().resident.turns.at(-1).participantId, f.participantId);
});

for (const change of ['off', 'generation', 'revoked']) test('D3 late reply after ' + change + ' is retained without a message or action', async t => {
  const f = await dotFixture(t); let requestId, attempt; f.onEvent = async id => { requestId = id; attempt = f.claim(id); };
  const pending = f.step(); await until(() => requestId);
  f.call('dot_turn_get', { requestId, ...attempt, inputPage: 0 });
  if (change === 'off') f.control({ action: 'off' });
  else if (change === 'revoked') f.app.dotMcp.revoke(f.connectionId, f.grant.version, key());
  else f.app.store.transact((s, emit) => { s.resident.rooms[0].contexts.find(c => c.participantId === f.participantId).generation++; emit({ type: 'scope.test', discussionId: null, data: {} }); });
  assert.throws(() => f.call('dot_turn_get', { requestId, ...attempt, inputPage: 1 }), change === 'revoked' ? /authentication_required/ : /request_stale/);
  const body = { ...attempt, requestId, commandId: key(), text: reply() };
  if (change === 'revoked') assert.throws(() => f.call('dot_turn_submit', body), /authentication_required/);
  else { const result = f.call('dot_turn_submit', body); assert.equal(result.accepted, false); assert.equal(result.disposition, 'quarantined'); }
  await pending; const s = f.state();
  assert.equal(s.resident.messages.length, 0); assert.equal(s.resident.workItems.length, 0); assert.equal(s.resident.turns[0].status, 'unconfirmed');
  if (change !== 'revoked') assert.equal(s.dotMcp.requests.items[0].reply.text, body.text);
  for (let i = 0; i < 20; i++) await f.step(); assert.equal(f.state().resident.turns.length, 1);
});

test('D3 scope change after mailbox acceptance but before core commit cannot publish', async t => {
  const f = await dotFixture(t); f.onEvent = async requestId => {
    await f.respond(requestId); f.app.dotMcp.revoke(f.connectionId, f.grant.version, key());
  };
  await f.step(); const s = f.state(); assert.equal(s.resident.messages.length, 0); assert.equal(s.resident.turns[0].status, 'stale');
  assert.equal(s.dotMcp.requests.items[0].status, 'quarantined'); assert.ok(s.dotMcp.requests.items[0].reply.receipt);
});

test('D3 timeout holds original lease, late mailbox is reconciled exactly once without another call', async t => {
  const f = await dotFixture(t, { timeoutMs: 40 }); let attempt, requestId;
  f.onEvent = async id => { requestId = id; attempt = f.claim(id); };
  await f.step(); assert.equal(f.state().resident.turns[0].status, 'unconfirmed');
  const result = f.call('dot_turn_submit', { requestId, ...attempt, commandId: key(), text: reply() }); assert.equal(result.accepted, true);
  assert.equal(f.state().resident.messages.length, 0); assert.equal(f.state().resident.turns[0].receipt, result.receipt);
  assert.throws(() => f.app.residentRunner.reconcile(f.roomId, requestId, { resolution: 'completed', text: 'altered' }, key()), /reply_mismatch/);
  const command = key(); for (let i = 0; i < 20; i++) f.app.residentRunner.reconcile(f.roomId, requestId, { resolution: 'completed' }, command);
  assert.equal(f.state().resident.messages.length, 1); assert.equal(f.state().resident.turns[0].receipt, result.receipt);
  assert.equal(f.state().resident.dispatchLeases[0].state, 'released'); assert.equal(f.deliveries.length, 1);
  assert.equal(f.room().reason, 'owner_resume_required');
});

test('D3 API quota excludes native dot; native context handoff cannot pretend to clear memory', async t => {
  const f = await dotFixture(t);
  f.app.configureApiDaily({ expectedVersion: f.state().apiUsage?.version ?? 0, maxRequests: 1, maxTokens: 1 }, key());
  // The ready gate for dot must not inspect the exhausted API bucket.
  f.app.store.transact(s => { s.apiUsage.entries.push({ requestId: 'api-existing', participantId: 'api', connectionId: 'api', kind: 'deepseek', day: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }), status: 'settled', reservedAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), usage: { input: 1, output: 1 }, error: null }); });
  const p = f.state().participants.find(p => p.id === f.participantId); assert.equal(participantWait(f.state(), f.room(), p), null);
  await f.step(); assert.equal(f.state().apiUsage.entries.length, 1); assert.equal(f.state().resident.turns[0].usage, null);
  assert.throws(() => f.app.residentRunner.handoff(f.roomId, { participantId: p.id, expectedGeneration: 1, expectedEpoch: f.room().epoch }, key()), /native_dot_context_preserved/);
});

test('D3 three participants and two review rounds keep draft barriers through native input and return to the same room', async t => {
  const f = await dotFixture(t); const inputs = [], paused = new Set();
  for (const participantId of ['fake-a', 'fake-b']) f.control({ action: 'set_member', participantId, enabled: true });
  const original = f.app.providers.complete.bind(f.app.providers);
  f.app.providers.complete = async input => {
    if (input.participant.kind === 'dot-mcp') return original(input);
    input.hooks.dispatched(); inputs.push(input); const d = f.state().discussions[0];
    if (d.phase === 'cross_review' && !paused.has(d.round)) { paused.add(d.round); f.app.engine.control(d.id, { action: 'pause', expectedRevision: 1 }, key()); }
    const answer = JSON.parse(response(input.prompt, input.participant)); answer.verifications = [];
    return { text: JSON.stringify(answer), receipt: key(), usage: null };
  };
  const did = f.app.residentRunner.focus(f.roomId, { ...topic, participantIds: ['fake-a', f.participantId, 'fake-b'], limits: { maxRequests: 60, maxRounds: 2, maxVerificationTasks: 0 } }, key());
  await until(() => { const d = f.state().discussions[0]; return d.status === 'paused' && d.turns.every(t => t.status === 'completed'); });
  await f.step(); assert.equal(f.state().resident.messages.length, 3);
  f.app.engine.control(did, { action: 'resume', expectedRevision: 1 }, key());
  await until(() => { const d = f.state().discussions[0]; return d.status === 'paused' && d.round === 2 && d.turns.every(t => t.status === 'completed'); });
  await f.step(); assert.equal(f.state().resident.messages.length, 6);
  f.app.engine.control(did, { action: 'resume', expectedRevision: 1 }, key());
  await until(() => f.state().discussions[0].status === 'completed');
  await f.step(); const s = f.state(); assert.equal(f.room().topicLink, null);
  assert.equal(s.resident.messages.filter(m => m.sourceKind === 'topic').length, s.discussions[0].turns.length);
  assert.equal(s.resident.messages.filter(m => m.sourceKind === 'wiki').length, 1);
  assert.equal(s.resident.messages.length, s.discussions[0].turns.length + 1);
  assert.equal(s.discussions[0].wikiPublication.status, 'published');
  const native = f.inputs.filter(i => i.prompt.includes('· cross_review ·'));
  assert.equal(native.length, 2);
  native.forEach((i, round) => { const data = JSON.parse(i.prompt.split('\n\n').find(s => s.startsWith('{"topic":'))); assert.equal(data.sharedReplies.length, round ? 6 : 3); });
  assert.equal(f.app.dotMcp.authenticate(f.access.token).id, f.grant.id);
  assert.ok(s.dotMcp.requests.items.every(r => r.status === 'consumed'));
  f.control({ action: 'set_member', participantId: 'fake-a', enabled: false }); f.control({ action: 'set_member', participantId: 'fake-b', enabled: false });
  await f.step(); assert.equal(f.state().resident.turns.at(-1).participantId, f.participantId);
});

test('D3 native work report goes through the original task lease and independent review, not a direct done command', async t => {
  const f = await dotFixture(t); const q = f.app.workQueue;
  f.control({ action: 'set_member', participantId: 'fake-a', enabled: true });
  for (const participantId of [f.participantId, 'fake-a']) q.seat(f.roomId, { participantId, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, key());
  const sourceId = f.app.resident.postMessage(f.roomId, { text: '검증과 합의를 구분하는 분석 보고를 작성하세요.' }, key()).messageId;
  const taskId = q.propose(f.roomId, { proposalKey: key(), title: '원래 업무 흐름', description: '지정 조건을 확인하세요.', kind: 'analysis', sourceMessageIds: [sourceId], acceptance: [{ id: 'c1', text: '원문 포함', check: { kind: 'text_includes', value: '검증과 합의를 구분' } }], allowedParticipantIds: [f.participantId], requiredRole: 'specialist', authorizedScopeRef: 'room:' + f.roomId, dependencies: [], priority: 0 }, key()).taskId;
  f.onEvent = id => f.respond(id, undefined, 20);
  await f.step(); let task = q.detail(f.roomId, taskId).task; assert.equal(task.status, 'review'); assert.equal(task.reports.length, 1);
  assert.equal(f.state().resident.messages.filter(m => m.sourceKind === 'work').length, 1);
  await f.step(); task = q.detail(f.roomId, taskId).task; assert.equal(task.status, 'done'); assert.equal(task.reviews[0].reviewerId, 'fake-a');
  assert.equal(f.state().resident.workAttempts.length, 2); assert.equal(f.state().jobs.length, 0);
  assert.equal(f.app.store.events(0, 10000).filter(e => e.type === 'dot.reply_received').length, 1);
});

for (const changedSeat of [false, true]) test('D3 timed-out work preserves original reconciliation and current seat authority: ' + changedSeat, async t => {
  const f = await dotFixture(t, { timeoutMs: 100 }), q = f.app.workQueue;
  const seat = { participantId: f.participantId, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] };
  q.seat(f.roomId, seat, key());
  const sourceId = f.app.resident.postMessage(f.roomId, { text: '원래 과제의 늦은 보고를 대조하세요.' }, key()).messageId;
  const taskId = q.propose(f.roomId, { proposalKey: key(), title: '늦은 보고', description: '원래 과제를 대조', kind: 'analysis', sourceMessageIds: [sourceId], acceptance: [{ id: 'c1', text: '원래 보고 확인', check: { kind: 'manual' } }], allowedParticipantIds: [f.participantId], requiredRole: 'specialist', authorizedScopeRef: 'room:' + f.roomId, dependencies: [], priority: 0 }, key()).taskId;
  let requestId, attempt;
  f.onEvent = async id => { requestId = id; attempt = f.claim(id); };
  await f.step(); const work = f.state().resident.workAttempts[0];
  assert.equal(f.state().resident.turns[0].status, 'unconfirmed');
  for (let i = 0; i < 20; i++) await f.step(); assert.equal(f.state().resident.workAttempts.length, 1);
  if (changedSeat) q.seat(f.roomId, { ...seat, expectedVersion: 1, enabled: false }, key());
  const text = reply({ proposals: [{ kind: 'work_report', payload: { version: 1, taskId, taskVersion: work.taskVersion, attemptId: work.id, summary: '원래 과제 보고', blockers: [] } }] });
  const receipt = f.call('dot_turn_submit', { requestId, ...attempt, commandId: key(), text });
  assert.equal(receipt.accepted, !changedSeat); assert.equal(q.detail(f.roomId, taskId).task.reports.length, 0);
  const command = key(); for (let i = 0; i < 20; i++) f.app.residentRunner.reconcile(f.roomId, requestId, { resolution: 'completed' }, command);
  const s = f.state(); assert.equal(q.detail(f.roomId, taskId).task.reports.length, changedSeat ? 0 : 1);
  assert.equal(s.resident.turns[0].status, changedSeat ? 'stale' : 'completed');
  assert.equal(s.resident.turns[0].receipt, receipt.receipt); assert.equal(s.resident.dispatchLeases[0].state, 'released');
  assert.equal(f.deliveries.length, 1); assert.equal(f.room().reason, 'owner_resume_required');
});

test('D3 loss of a subscription lets ready topic drafts finish without leaking a partial round to dot', async t => {
  const f = await dotFixture(t); for (const participantId of ['fake-a', 'fake-b']) f.control({ action: 'set_member', participantId, enabled: true });
  const original = f.app.providers.complete.bind(f.app.providers); let first = true;
  f.app.providers.complete = async input => {
    if (input.participant.kind === 'dot-mcp') return original(input);
    input.hooks.dispatched();
    if (first) { first = false; await f.app.mcpEvents.handle('events/unsubscribe', { ...f.params, delivery: { mode: 'webhook', url: f.params.delivery.url } }, f.grant); }
    const answer = JSON.parse(response(input.prompt, input.participant)); answer.verifications = [];
    return { text: JSON.stringify(answer), receipt: key(), usage: null };
  };
  f.app.residentRunner.focus(f.roomId, { ...topic, participantIds: ['fake-a', f.participantId, 'fake-b'], limits: { maxRequests: 30, maxRounds: 1, maxVerificationTasks: 0 } }, key());
  await until(() => f.state().discussions[0].reason === 'dot_subscription_required'); await f.step();
  assert.equal(f.state().discussions[0].turns.length, 2); assert.equal(f.state().resident.messages.length, 0); assert.equal(f.deliveries.length, 0);
  await f.subscribe(); f.app.engine.kick(); await until(() => ['completed', 'blocked'].includes(f.state().discussions[0].status), 7000);
  assert.equal(f.state().discussions[0].status, 'completed', JSON.stringify({ reason: f.state().discussions[0].reason, turns: f.state().discussions[0].turns.map(t => ({ status: t.status, error: t.error })), outbox: f.state().dotMcp.events.outbox.map(e => ({ status: e.status, reason: e.reason })) }));
  const firstNative = JSON.parse(f.inputs[0].prompt.split('\n\n').find(s => s.startsWith('{"topic":')));
  assert.equal(firstNative.sharedReplies.length, 0); assert.equal(f.state().dotMcp.grants.filter(g => g.status === 'active').length, 1);
});

for (const control of ['cancel', 'revise']) test('D3 topic ' + control + ' fences the original mailbox from the current revision', async t => {
  const f = await dotFixture(t); f.control({ action: 'set_member', participantId: 'fake-a', enabled: true });
  let requestId, attempt; f.onEvent = async id => { requestId = id; attempt = f.claim(id); };
  const did = f.app.residentRunner.focus(f.roomId, { ...topic, participantIds: [f.participantId, 'fake-a'] }, key());
  await until(() => requestId);
  f.app.engine.control(did, { action: control, expectedRevision: 1, ...(control === 'revise' ? { text: '새 주제' } : {}) }, key());
  const result = f.call('dot_turn_submit', { ...attempt, requestId, commandId: key(), text: reply() }); assert.equal(result.accepted, false);
  await until(() => f.state().discussions[0].turns[0].status === 'unconfirmed');
  f.app.engine.control(did, { action: 'reconcile', expectedRevision: f.state().discussions[0].revision, turnId: requestId, resolution: 'completed' }, key());
  assert.equal(f.state().discussions[0].turns[0].status, 'stale'); assert.equal(f.state().discussions[0].claims.length, 0);
  assert.equal(f.state().resident.messages.length, 0); assert.equal(f.state().dotMcp.requests.items[0].status, 'quarantined');
});

test('D3 format repair uses one new reserved turn, while future/corrupt mailboxes fail closed', async t => {
  const f = await dotFixture(t); f.onEvent = id => f.respond(id, 'unstructured native reply', 20);
  await f.step(); await f.step();
  const s = f.state(); assert.equal(s.resident.turns.length, 2); assert.equal(s.resident.turns[1].repairOf, s.resident.turns[0].id);
  assert.equal(f.deliveries.length, 2); assert.equal(s.resident.messages.length, 0); assert.equal(f.room().reason, 'format_invalid');
  for (const mutate of [s => s.dotMcp.requests.version = 99, s => s.dotMcp.requests.items[0].inputDigest = '0'.repeat(64), s => s.dotMcp.requests.items[0].reply.text += 'changed']) {
    const invalid = structuredClone(s); mutate(invalid); assert.throws(() => readDotState(invalid), /requests_state_invalid/);
  }
});

test('D3 native structured Wiki proposal uses the existing scope/CAS once for twenty identical submissions', async t => {
  const f = await dotFixture(t);
  f.app.workQueue.seat(f.roomId, { participantId: f.participantId, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, key());
  const sourceId = f.app.resident.postMessage(f.roomId, { text: '이 원문을 공유 기억에 기록하세요.' }, key()).messageId;
  const text = reply({ proposals: [{ kind: 'wiki_edit', payload: { slug: 'native-notes', title: 'dot 메모', body: 'reported 합성 기록', scopeRef: 'room:' + f.roomId, expectedVersion: 0, sourceRefs: [{ kind: 'message', id: sourceId }] } }] });
  f.onEvent = id => f.respond(id, text, 20); await f.step();
  const s = f.state(); assert.equal(s.resident.wikiVersions.length, 1); assert.equal(s.resident.wikiVersions[0].authoredBy, f.participantId);
  assert.equal(s.resident.turns[0].proposalsStatus, 'applied'); assert.equal(s.resident.messages.filter(m => m.sourceId === s.resident.turns[0].id).length, 1);
});

test('D3 claim cannot read a frozen history after its earlier project Wiki access is revoked', async t => {
  const f = await dotFixture(t); const q = f.app.workQueue, w = f.app.wiki; f.app.store.transact(s => s.bindings.push({ id: 'private-project' }));
  const seat = { participantId: f.participantId, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId, 'binding:private-project'] }; q.seat(f.roomId, seat, key());
  const sourceId = f.app.resident.postMessage(f.roomId, { text: '한정 프로젝트 자료의 원문' }, key()).messageId;
  const edit = (slug, scopeRef, body) => w.edit(f.roomId, { slug, title: slug, body, scopeRef, expectedVersion: 0, sourceRefs: [{ kind: 'message', id: sourceId }] }, key());
  const privatePage = edit('project-private', 'binding:private-project', 'private history sentinel'), publicPage = edit('room-public', 'room:' + f.roomId, 'public current input');
  const pin = page => w.pin(f.roomId, { expectedVersion: f.room().version, pins: [{ pageId: page.pageId, version: 1 }] }, key());
  pin(privatePage); await f.step(); assert.ok(f.inputs[0].prompt.includes('private history sentinel')); pin(publicPage);
  let requestId, attempt; f.onEvent = async id => { requestId = id; attempt = f.claim(id); };
  const pending = f.step(); await until(() => requestId);
  q.seat(f.roomId, { ...seat, expectedVersion: 1, scopeRefs: ['room:' + f.roomId] }, key());
  assert.throws(() => f.call('dot_turn_get', { requestId, ...attempt }), /request_stale/);
  assert.throws(() => f.call('dot_turn_get', { requestId, ...attempt, inputPage: 1 }), /request_stale/);
  assert.equal(f.call('dot_turn_submit', { requestId, ...attempt, commandId: key(), text: reply() }).accepted, false);
  await pending; assert.equal(f.state().resident.turns[1].status, 'unconfirmed'); assert.equal(f.state().resident.turns[1].messageId, null);
});
