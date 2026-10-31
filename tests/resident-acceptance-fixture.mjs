import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { workFixture } from './work-fixture.mjs';
import { reply } from './resident-fixture.mjs';
import { until } from './workspace-helpers.mjs';

export const key = () => crypto.randomUUID();
export const evidence = async (name, value) => { await mkdir('test-results/resident/R8', { recursive: true }); await writeFile('test-results/resident/R8/' + name + '.json', JSON.stringify(value, null, 2)); };
export async function acceptanceFixture(t, { autoTopic = false } = {}) {
  let ambient = 0; let reports = 0; let reviews = 0; let active = 0; let maximum = 0; const calls = []; let f;
  const observe = async (input, complete, kind) => {
    assert.equal(input.participant.kind, 'fake', 'Acceptance fixtures must never call a real account');
    assert.ok(!calls.some(c => c.requestId === input.requestId), 'one transport call per request');
    calls.push({ requestId: input.requestId, participantId: input.participant.id, kind }); active++; maximum = Math.max(maximum, active);
    try { return await complete(); } finally { active--; }
  };
  f = await workFixture(t, { on: false, maxRequests: 80, provider: { complete: input => observe(input, async () => {
    input.hooks.dispatched(); const receipt = 'acceptance-' + calls.length; input.hooks.receipt(receipt); await delay(2);
    let value;
    if (input.prompt.startsWith('웹쫀쿠 상주 업무')) {
      const d = JSON.parse(input.prompt.split('\n\n').find(v => v.startsWith('{"taskId":')));
      const review = d.purpose === 'review'; const reject = review && reviews++ === 0;
      value = reply({ text: review ? '[모의 독립 검토] ' + (reject ? '원문 근거와 반론을 더 명확히 써 주세요.' : '수정된 산출물과 남은 이견을 검토했습니다.') : '[모의 산출물] 검증과 합의를 구분. ' + (++reports === 1 ? '초기 보고입니다.' : '원문 근거와 반론을 보완한 재작업입니다.'),
        proposals: [{ kind: review ? 'work_review' : 'work_report', payload: { version: 1, taskId: d.taskId, taskVersion: d.taskVersion, attemptId: d.attemptId,
          ...(review ? { reportDigest: d.report.digest, decision: reject ? 'rework' : 'accept', reason: reject ? '원문 근거와 반론 보완' : '독립 검토와 서버 문구 검사를 확인했습니다.' } : { summary: '모의 분석 보고 ' + reports, blockers: [] }) } }] });
    } else {
      const d = JSON.parse(input.prompt.split('\n\n').find(v => v.startsWith('{"roomId":'))); ambient++;
      value = reply({ text: '[모의 자유 대화] ' + input.participant.label + (d.wiki.length ? ' · 공유 Wiki v' + d.wiki[0].version + '를 읽고 다시 분석했습니다.' : ' · 공개 원문과 반론을 함께 검토합니다.'),
        proposals: ambient === 3 ? [{ kind: 'work_propose', payload: f.proposal({ proposalKey: 'unattended-analysis', title: '공개 토론에서 나온 분석 일감', sourceMessageIds: d.messages.filter(m => m.sourceKind === 'room').map(m => m.id) }) }] : ambient === 4 && autoTopic ? [{ kind: 'topic_propose', payload: { topic: '공유 Wiki와 산출물의 근거·이견을 비교', criteria: '근거, 반론, 불확실성', maxRounds: 2, sourceMessageIds: [d.messages.at(-1).id] } }] : [] });
    }
    input.hooks.delta(value); return { text: value, receipt, usage: { input: 10, output: 20 } };
  }, 'resident') } });
  f.app.store.transact(s => { s.participants.push({ ...s.participants[0], id: 'fake-c', label: '모의 참여자 C' }); });
  f.control({ action: 'set_member', participantId: 'fake-c', enabled: true });
  f.q.seat(f.roomId, { participantId: 'fake-c', expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, key());
  if (autoTopic) { const r = f.app.store.read().resident.rooms[0]; f.control({ action: 'configure', budgets: r.budgets, pacing: r.pacing, autoTopic: true }); }
  const topicComplete = f.app.providers.complete.bind(f.app.providers);
  f.app.providers.complete = input => observe(input, () => topicComplete(input), 'topic');
  return { ...f, room: () => f.app.store.read().resident.rooms[0], calls, maximum: () => maximum,
    runUnattended: async () => { f.control({ action: 'on' }); for (let i = 0; i < 8; i++) await f.step(); return f.app.store.read(); },
    focusAndReturn: async () => {
      let did;
      if (autoTopic) { await f.step(); did = f.app.store.read().resident.topicIntents[0].discussionId; assert.ok(did); }
      else did = f.app.residentRunner.focus(f.roomId, { topic: '공유 Wiki와 산출물의 근거·이견을 비교', participantIds: ['fake-a', 'fake-b', 'fake-c'], limits: { maxRequests: 30, maxRounds: 2, maxVerificationTasks: 0 } }, 'acceptance-focus');
      await until(() => ['completed', 'partial'].includes(f.app.store.read().discussions.find(d => d.id === did)?.status), 15000);
      await f.step(); return did;
    } };
}
