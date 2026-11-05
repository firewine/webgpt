import test from 'node:test';
import assert from 'node:assert/strict';
import { workFixture } from './work-fixture.mjs';
import { reply } from './resident-fixture.mjs';
import { inspectWorkWikiCycle } from '../scripts/work-wiki-evidence.mjs';

test('work prompt examples run through the actual report and review validators without inventing or tolerating fields', async t => {
  const examples = [];
  const provider = { complete: async input => {
    assert.equal(input.participant.kind, 'fake');
    input.hooks.dispatched();
    const prefix = 'JSON 객체만 반환: ';
    const example = JSON.parse(input.prompt.split('\n\n').find(block => block.startsWith(prefix)).slice(prefix.length));
    examples.push(structuredClone(example));
    // Echo the actual example fields; change only the output text required by the fixture's acceptance check.
    example.text = '검증과 합의를 구분';
    return { text: JSON.stringify(example), receipt: 'prompt-example-' + input.requestId, usage: { input: 10, output: 20 } };
  } };
  const f = await workFixture(t, { provider }); const taskId = f.propose();
  await f.step();
  let task = f.task(taskId);
  assert.equal(task.status, 'review'); assert.equal(task.reports.length, 1);
  const report = structuredClone(task.reports[0]);
  await f.step(); task = f.task(taskId);
  assert.equal(task.status, 'done'); assert.equal(task.reviews.length, 1);
  assert.equal(task.reviews[0].reviewerId, 'fake-b');
  assert.equal(task.reviews[0].reportDigest, report.digest);
  assert.deepEqual(task.reports, [report], 'The review must not change the accepted report');
  assert.equal(examples[0].proposals[0].kind, 'work_report');
  assert.equal(examples[1].proposals[0].kind, 'work_review');
  assert.equal(examples[1].proposals[0].payload.reportDigest, report.digest);
  assert.equal(Object.hasOwn(examples[1].proposals[0].payload, 'blockers'), false);
  assert.equal(Object.hasOwn(examples[1].proposals[0].payload, 'summary'), false);
  assert.equal(f.app.store.read().resident.turns.every(turn => turn.proposalsStatus === 'applied'), true);
});

test('a completed review with an extra report field stays blocked and preserves its original response and report', async t => {
  const provider = { complete: async input => {
    input.hooks.dispatched();
    const prefix = 'JSON 객체만 반환: ';
    const example = JSON.parse(input.prompt.split('\n\n').find(block => block.startsWith(prefix)).slice(prefix.length));
    example.text = '검증과 합의를 구분';
    if (example.proposals[0].kind === 'work_review') example.proposals[0].payload.blockers = [];
    return { text: JSON.stringify(example), receipt: 'strict-review-' + input.requestId, usage: null };
  } };
  const f = await workFixture(t, { provider }); const taskId = f.propose();
  await f.step(); const report = structuredClone(f.task(taskId).reports[0]);
  await f.step(); const task = f.task(taskId); const state = f.app.store.read();
  assert.equal(task.status, 'blocked'); assert.equal(task.reason, 'invalid_work_fields');
  assert.equal(task.reviews.length, 0); assert.deepEqual(task.reports, [report]);
  const attempt = state.resident.workAttempts.find(a => a.purpose === 'review');
  const turn = state.resident.turns.find(turn => turn.id === attempt.providerTurnId);
  assert.equal(attempt.status, 'failed'); assert.equal(attempt.error, 'invalid_work_fields');
  assert.equal(turn.status, 'completed'); assert.equal(turn.proposalsStatus, 'not_run');
  assert.deepEqual(JSON.parse(turn.text).proposals[0].payload.blockers, []);
  assert.equal(turn.receipt, 'strict-review-' + turn.id);
});

test('recommendation2: manager and executor finish proposal, automatic work, independent review and ambient Wiki citation with no owner relay', async t => {
  const calls = []; let f;
  const provider = { complete: async input => {
    assert.equal(input.participant.kind, 'fake', 'This protocol test must never use a real account');
    assert.equal(calls.some(c => c.id === input.requestId), false);
    input.hooks.dispatched(); input.hooks.receipt('protocol-fixture-' + input.requestId);
    let value;
    if (input.prompt.startsWith('웹쫀쿠 상주 업무')) {
      const data = JSON.parse(input.prompt.split('\n\n').find(block => block.startsWith('{"taskId":')));
      const review = data.purpose === 'review';
      assert.equal(input.participant.id, review ? 'fake-a' : 'fake-b');
      calls.push({ id: input.requestId, kind: review ? 'review' : 'report' });
      value = reply({ text: review ? '세 점검 항목과 원문을 검토했습니다. 실제 효과는 미검증입니다.' : '결정: 원문과 담당을 기록. 이견: 반대 근거를 보존. 미확인: 실제 효과는 아직 검증하지 않음.',
        proposals: [{ kind: review ? 'work_review' : 'work_report', payload: { version: 1, taskId: data.taskId, taskVersion: data.taskVersion, attemptId: data.attemptId,
          ...(review ? { reportDigest: data.report.digest, decision: 'accept', reason: '다른 참여자의 보고와 서버 문자열 포함 관측을 확인함' } : { summary: '가상 모임의 세 항목 점검표', blockers: [] }) } }] });
    } else {
      const data = JSON.parse(input.prompt.split('\n\n').find(block => block.startsWith('{"roomId":')));
      const first = !data.workTasks.length;
      assert.equal(input.participant.id, first ? 'fake-a' : 'fake-b');
      calls.push({ id: input.requestId, kind: first ? 'proposal' : 'ambient' });
      if (first) value = reply({ text: '공개 원문을 근거로 회의 기록 점검표 분석 일감 하나를 제안합니다.', proposals: [{ kind: 'work_propose', payload: f.proposal({
        proposalKey: 'recommendation2-one-analysis', title: '가상 모임의 기록 점검표', allowedParticipantIds: ['fake-b'], requiredRole: 'executor',
        acceptance: ['결정', '이견', '미확인'].map((word, index) => ({ id: 'criterion-' + index, text: word + ' 항목 포함', check: { kind: 'text_includes', value: word } })),
      }) }] });
      else {
        assert.equal(data.wiki.length, 1);
        const ref = data.wiki[0];
        value = reply({ text: `공유 보고 ${ref.pageId} version ${ref.version}, digest ${ref.digest}, 원문 ${ref.sourceRefs[0].id}를 참고했습니다. 합의와 실제 검증은 구분합니다.` });
      }
    }
    const text = value; input.hooks.delta(text);
    return { text, receipt: 'protocol-fixture-' + input.requestId, usage: { input: 10, output: 20 } };
  } };
  f = await workFixture(t, { on: false, provider });
  for (const [participantId, role] of [['fake-a', 'manager'], ['fake-b', 'executor']]) f.q.seat(f.roomId, {
    participantId, expectedVersion: 1, role, enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId],
  }, crypto.randomUUID());
  f.control({ action: 'on' });
  await f.step();
  let state = f.app.store.read(); const taskId = state.resident.workItems[0].id;
  assert.equal(state.resident.workItems[0].proposedBy, 'fake-a'); assert.equal(state.resident.workItems[0].status, 'ready');
  await f.step(); state = f.app.store.read();
  assert.equal(f.task(taskId).status, 'review'); assert.equal(state.resident.wikiVersions.length, 1);
  const report = f.task(taskId).reports[0], version = state.resident.wikiVersions[0];
  assert.equal(report.authorId, 'fake-b'); assert.equal(version.epistemicStatus, 'reported'); assert.equal(version.sourceRefs[0].id, report.id);
  assert.ok(report.checks.every(c => c.outcome === 'observed_pass'));
  const original = JSON.stringify(report);
  assert.equal(inspectWorkWikiCycle(state, taskId).status, 'incomplete');
  await f.step(); state = f.app.store.read();
  assert.equal(f.task(taskId).status, 'done'); assert.equal(f.task(taskId).reviews[0].reviewerId, 'fake-a');
  assert.equal(inspectWorkWikiCycle(state, taskId).status, 'incomplete', 'A work review reading Wiki is not the next ambient conversation');
  await f.step(); state = f.app.store.read();
  const evidence = inspectWorkWikiCycle(state, taskId);
  assert.equal(evidence.status, 'records_consistent', JSON.stringify(evidence));
  assert.equal(evidence.realModelAcceptance, 'UNVERIFIED_BY_AUDIT'); assert.equal(evidence.modelCalls, 0);
  assert.deepEqual(calls.map(c => c.kind), ['proposal', 'report', 'review', 'ambient']);
  assert.equal(state.resident.messages.filter(m => m.authorId === 'owner').length, 1);
  assert.equal(state.resident.workItems.length, 1); assert.equal(state.resident.wikiVersions.length, 1);
  assert.equal(JSON.stringify(f.task(taskId).reports[0]), original);
  assert.equal(state.resident.messages.filter(m => m.sourceKind === 'wiki').length, 1); assert.equal(state.jobs.length, 0);
  const following = state.resident.turns.at(-1);
  assert.equal(following.workAttemptId, undefined); assert.equal(following.wikiCitations[0].digest, version.digest);
  assert.equal(state.resident.messages.find(m => m.sourceId === following.id).wikiCitations[0].digest, version.digest);
});
