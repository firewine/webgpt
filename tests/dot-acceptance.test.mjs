import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nativeFixture, key, dataOf, topicReply, evidence } from './dot-acceptance-fixture.mjs';
import { executionFixture } from './work-execution-fixture.mjs';
import { until } from './workspace-helpers.mjs';
import { reply } from './resident-fixture.mjs';
import { participantWait } from '../dist/server/workspace/api-usage.js';

test('D5-E: the additive gate map retains all original fifty gates and keeps real-account acceptance open', async () => {
  const added = JSON.parse(await readFile('docs/implementation/dot-acceptance-manifest.json', 'utf8'));
  const original = JSON.parse(await readFile(added.originalManifest, 'utf8'));
  assert.equal(original.gateCount, 50); assert.equal(original.gates.length, 50);
  assert.deepEqual(original.gates.map(g => g.id), added.originalGateIds);
  assert.deepEqual(Object.fromEntries(original.gates.filter(g => g.status !== 'PASS').map(g => [g.id, g.status])), added.originalOpenGates);
  assert.equal(new Set(added.gates.map(g => g.id)).size, 6);
  for (const gate of added.gates) {
    for (const id of gate.originalGates) assert.ok(added.originalGateIds.includes(id));
    for (const file of gate.files) assert.ok((await readFile(file)).length > 0);
  }
  assert.equal(added.gates.find(g => g.id === 'D5-F').realStatus, 'NOT_RUN');
});

test('D5-A: private stdio and signed callback carry native dot through mixed ambient/work/rework/Wiki/automatic topic and back', { timeout: 60000 }, async t => {
  const f = await nativeFixture(t), calls = [], seenLong = new Set(); let active = 0, maximum = 0, reports = 0, reviews = 0, proposed = false;
  const longText = 'D5 원문 근거와 반론을 구분합니다. '.repeat(500) + 'D5_LONG_ORIGINAL_END';
  // Real provider kinds exercise policy/dispatch, but no credentials exist and
  // all model transports below are deterministic fixture functions.
  f.app.store.transact(s => {
    for (const [id, kind] of [['fake-a', 'openai-oauth'], ['fake-b', 'deepseek'], ['d5-gpt-b', 'codex-oauth']]) {
      let p = s.participants.find(p => p.id === id);
      if (!p) { p = { ...s.participants[0], id }; s.participants.push(p); }
      Object.assign(p, { kind, connectionId: 'd5-' + id, modelId: 'fixture-model', label: 'D5 fixture ' + kind });
      s.connections.push({ id: p.connectionId, kind, label: p.label, status: 'connected', models: [{ id: p.modelId, label: 'fixture only' }] });
    }
  });
  f.control({ action: 'set_member', participantId: 'd5-gpt-b', enabled: true });
  f.control({ action: 'configure', pacing: f.room().pacing, autoTopic: true });
  f.app.configureApiDaily({ expectedVersion: 0, maxRequests: 100, maxTokens: 1000000 }, key());
  const scripted = input => {
    if (!input.prompt.startsWith('웹쫀쿠 상주')) return topicReply(input);
    if (input.prompt.startsWith('웹쫀쿠 상주 업무')) {
      const d = dataOf(input.prompt, 'taskId'), review = d.purpose === 'review', reject = review && reviews++ === 0;
      return reply({ text: review ? '독립 검토: ' + (reject ? '반론 보완 필요' : '원문과 반론 확인') : '검증과 합의를 구분. 보고 ' + ++reports,
        proposals: [{ kind: review ? 'work_review' : 'work_report', payload: { version: 1, taskId: d.taskId, taskVersion: d.taskVersion, attemptId: d.attemptId,
          ...(review ? { reportDigest: d.report.digest, decision: reject ? 'rework' : 'accept', reason: reject ? '반론을 원문에 보완하세요' : '독립 검토 완료' } : { summary: 'D5 분석 보고', blockers: [] }) } }] });
    }
    const d = dataOf(input.prompt, 'roomId'), native = input.participant.kind === 'dot-mcp';
    if (!native && input.prompt.includes(longText)) seenLong.add(input.participant.id);
    let proposals = [];
    if (native && !proposed) { proposed = true; proposals = [{ kind: 'work_propose', payload: f.proposal({ proposalKey: 'd5-work', allowedParticipantIds: [f.participantId], sourceMessageIds: d.messages.map(m => m.id) }) }]; }
    else if (native && seenLong.size === 3 && d.wiki.length && f.state().resident.workItems[0]?.status === 'done') {
      proposals = [{ kind: 'topic_propose', payload: { topic: 'D5 위키와 원문 근거의 이견을 비교', criteria: '근거·반론·미확인 구분', maxRounds: 2, sourceMessageIds: [d.messages.at(-1).id] } }];
    }
    return reply({ text: native ? longText : '긴 원문을 읽고 반론을 다시 분석한 fixture 답변', proposals });
  };
  f.replyFor = scripted;
  const original = f.app.providers.complete.bind(f.app.providers);
  f.app.providers.complete = async input => {
    assert.ok(['dot-mcp', 'openai-oauth', 'codex-oauth', 'deepseek'].includes(input.participant.kind));
    assert.ok(!calls.some(c => c.requestId === input.requestId)); calls.push(input); active++; maximum = Math.max(maximum, active);
    try {
      if (input.participant.kind === 'dot-mcp') return await original(input);
      input.hooks.dispatched(); const receipt = 'd5-fixture-' + calls.length; input.hooks.receipt(receipt);
      return { text: scripted(input), receipt, usage: { input: 10, output: 20 } };
    } finally { active--; }
  };
  f.control({ action: 'on' });
  for (let i = 0; i < 25 && !f.state().resident.topicIntents?.[0]?.discussionId; i++) { await f.step(); f.assertClean(); }
  const intent = f.state().resident.topicIntents[0]; assert.ok(intent?.discussionId, JSON.stringify(f.room()));
  await until(() => f.state().discussions[0].status === 'completed', 25000); await f.step();
  await until(() => f.answers.length === f.state().dotMcp.requests.items.length); f.assertClean();
  const s = f.state(), task = s.resident.workItems[0], wiki = s.resident.wikiVersions.at(-1), d = s.discussions[0];
  assert.equal(task.proposedBy, f.participantId); assert.equal(task.status, 'done'); assert.equal(task.reports.length, 2);
  assert.deepEqual(task.reviews.map(r => r.decision), ['rework', 'accept']); assert.ok(task.reviews.every(r => r.reviewerId !== f.participantId));
  assert.equal(s.resident.wikiVersions.length, 2); assert.equal(wiki.sourceRefs[0].id, task.reports[1].id);
  assert.equal(d.wikiCitations[0].digest, wiki.digest); assert.ok(d.turns.every(t => t.wikiCitations[0].digest === wiki.digest));
  assert.equal(seenLong.size, 3); assert.equal(maximum, 1); assert.equal(f.room().topicLink, null);
  assert.equal(f.room().id, f.roomId); assert.equal(s.resident.messages.filter(m => m.authorId === 'owner').length, 1);
  assert.equal(s.resident.topicIntents.length, 1); assert.equal(s.jobs.length, 0);
  const nativeReview = f.inputs.filter(i => i.prompt.includes('· cross_review ·'));
  assert.equal(nativeReview.length, 2); nativeReview.forEach((input, round) => assert.equal(dataOf(input.prompt, 'topic').sharedReplies.length, round ? 8 : 4));
  assert.ok(s.dotMcp.requests.items.every(r => r.status === 'consumed'));
  assert.equal(s.dotMcp.requests.items.length, f.answers.length);
  assert.ok(s.apiUsage.entries.length > 0); assert.ok(s.apiUsage.entries.every(e => e.kind === 'deepseek' && e.usage.input === 10));
  const apiRequests = s.apiUsage.entries.length;
  f.app.configureApiDaily({ expectedVersion: s.apiUsage.version, maxRequests: apiRequests, maxTokens: 1000000 }, key());
  assert.equal(participantWait(f.state(), f.room(), s.participants.find(p => p.id === 'fake-b')), 'api_daily_exhausted');
  for (const id of ['fake-a', 'd5-gpt-b', f.participantId]) assert.equal(participantWait(f.state(), f.room(), s.participants.find(p => p.id === id)), null);
  await evidence('mixed-flow', { members: 4, maximumProviderCalls: maximum, nativeReplies: f.answers.length, workReports: 2, independentReviews: ['rework', 'accept'], wikiVersions: 2,
    fullOriginalCharacters: longText.length, readersOfFullOriginal: seenLong.size, reviewRounds: 2, explicitOwnerFocusRequests: 0, sameRoomReturn: true, apiRequests,
    nativeUnknownUsage: d.turns.filter(t => t.participantId === f.participantId).every(t => t.usage === null), callbacks: f.callbacks.length });
});

test('D5-B: reconnect and twenty duplicate submits publish once; off quarantines the old request and revoke disables forwarding', { timeout: 30000 }, async t => {
  const f = await nativeFixture(t); for (const id of ['fake-a', 'fake-b']) f.control({ action: 'set_member', participantId: id, enabled: false });
  f.control({ action: 'on' }); f.onEvent = id => f.respond(id, reply({ text: '원래 답변과 영수증' }), 20); await f.step(); await until(() => f.answers.length === 1); f.assertClean();
  const receipt = f.answers[0].results[0].receipt; let before = f.state();
  assert.equal(new Set(f.answers[0].results.map(r => r.receipt)).size, 1);
  await f.reconnect(); await f.subscribe();
  for (let i = 0; i < 20; i++) { await f.api('/api/dot/status'); await f.request('tools/list'); }
  assert.equal(f.state().dotMcp.requests.items.length, 1); assert.deepEqual(f.state().resident.messages, before.resident.messages);
  assert.equal((await f.call('dot_turn_submit', f.answers[0].body)).receipt, receipt);
  f.control({ action: 'off' }); f.control({ action: 'on' }); f.onEvent = id => f.respond(id);
  await f.step(); await until(() => f.answers.length === 2); before = f.state();
  assert.equal(before.dotMcp.grants.length, 1); assert.equal(before.dotMcp.requests.items[1].status, 'consumed');
  let requestId, attempt;
  f.onEvent = async id => { attempt = await f.call('dot_turn_claim', { requestId: id, commandId: 'held-' + id }); requestId = id; };
  const pending = f.step(); await until(() => requestId); f.control({ action: 'off' });
  const late = await f.call('dot_turn_submit', { requestId, ...attempt, commandId: key(), text: reply({ text: 'off 이후 늦은 원문' }) });
  assert.equal(late.accepted, false); assert.equal(late.disposition, 'quarantined'); await pending;
  for (let i = 0; i < 20; i++) await f.step();
  assert.deepEqual(f.state().resident.messages, before.resident.messages); assert.equal(f.state().dotMcp.requests.items.length, 3);
  assert.equal(f.state().dotMcp.requests.items[2].reply.receipt, late.receipt);
  const revoke = await f.api('/api/dot/connections/' + f.connectionId + '/revoke', { expectedVersion: 2 }); assert.equal(revoke.status, 200);
  await assert.rejects(f.call('dot_turn_get'), /rpc_rejected/); f.assertClean();
  await evidence('reconnect', { originalReceiptPreserved: true, duplicateSubmits: 20, publishedReplies: 2, grantReissuedOnRoomRestart: false, lateReply: 'quarantined', refreshes: 20, newTurnsFromRefresh: 0, revokedForwarding: 'denied' });
});

test('D5-C: Codex fixture approval and execution evidence feed an independent native dot review without broader dot tools', { timeout: 30000 }, async t => {
  const f = await nativeFixture(t, { factory: executionFixture, mode: 'approval' });
  f.control({ action: 'set_member', participantId: 'fake-b', enabled: false });
  f.q.seat(f.roomId, { participantId: f.participantId, expectedVersion: 1, role: 'specialist', enabled: true, kinds: ['analysis', 'codex'], scopeRefs: ['room:' + f.roomId, 'binding:' + f.bindingId] }, key());
  f.replyFor = input => {
    const d = dataOf(input.prompt, 'taskId'); assert.equal(d.purpose, 'review');
    assert.ok(input.prompt.includes('fixture only')); assert.ok(input.prompt.includes(f.state().jobs[0].turnId));
    return reply({ text: '모의 명령 근거와 미실행 경계를 독립 검토했습니다.', proposals: [{ kind: 'work_review', payload: {
      version: 1, taskId: d.taskId, taskVersion: d.taskVersion, attemptId: d.attemptId, reportDigest: d.report.digest, decision: 'accept', reason: 'fixture 명령 종료 상태와 원문 확인',
    } }] });
  };
  f.control({ action: 'on' }); const taskId = f.proposeCode(); f.bridge.tick();
  const job = await until(() => f.state().jobs.find(j => j.status === 'blocked_approval'));
  for (const name of ['codex_send', 'resident_wiki_edit', 'work_claim']) await assert.rejects(f.call(name), /rpc_rejected/);
  assert.equal((await f.trace()).filter(v => v.id === '017' && v.result).length, 0);
  f.codex.decide(job.id, '017', 'accept'); await until(() => f.state().jobs[0].status === 'completed'); f.bridge.tick();
  assert.equal(f.task(taskId).status, 'review'); await f.step(); f.assertClean();
  const task = f.task(taskId); assert.equal(task.status, 'done'); assert.equal(task.reviews[0].reviewerId, f.participantId);
  assert.equal(task.reports[0].execution.commands[0].exitCode, 0); assert.equal(f.inputs.length, 1);
  for (let i = 0; i < 20; i++) f.bridge.tick();
  const starts = (await f.trace()).filter(v => v.method === 'turn/start'); assert.equal(starts.length, 1);
  assert.equal(starts[0].params.approvalPolicy, 'untrusted'); assert.equal(starts[0].params.approvalsReviewer, 'user');
  await evidence('execution-review', { fixtureExecutionStarts: 1, ownerApprovals: 1, nativeIndependentReviews: 1, commandExitCode: 0, broaderDotTools: 'denied', realCodexExecution: 'NOT_RUN' });
});
