import { workspace } from './workspace-helpers.mjs';
import { budget, pacing } from './resident-fixture.mjs';
export async function workFixture(t, options = {}) {
  let clock = Date.now();
  const f = await workspace(t, { residentEnabled: true }, { ...options.runtimeOptions, residentAutoSchedule: options.autoSchedule ?? false, residentClock: () => options.autoSchedule ? Date.now() : clock, ...(options.provider ? { residentProvider: options.provider } : {}) });
  const roomId = f.app.store.read().resident.rooms[0].id; const q = f.app.workQueue;
  const control = body => f.app.resident.control(roomId, { expectedVersion: f.app.store.read().resident.rooms[0].version, ...body }, crypto.randomUUID());
  control({ action: 'configure', budgets: budget(clock, options.maxRequests ?? 60), pacing: { ...pacing, ...(options.pacing ?? {}) } });
  for (const participantId of ['fake-a', 'fake-b']) { control({ action: 'set_member', participantId, enabled: true }); q.seat(roomId, { participantId, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + roomId] }, crypto.randomUUID()); }
  const sourceId = f.app.resident.postMessage(roomId, { text: '함께 처리할 일감을 제안하고 산출물과 이견을 같은 방에 남겨 주세요.' }, 'work-source').messageId;
  const proposal = (overrides = {}) => ({ proposalKey: crypto.randomUUID(), title: '검토할 분석 산출물', description: '공개 자료에 근거한 분석안을 작성하세요.', kind: 'analysis', sourceMessageIds: [sourceId], acceptance: [{ id: 'criterion-1', text: '산출물에 지정한 문구 포함', check: { kind: 'text_includes', value: '검증과 합의를 구분' } }], allowedParticipantIds: ['fake-a'], requiredRole: 'specialist', authorizedScopeRef: 'room:' + roomId, dependencies: [], priority: 0, ...overrides });
  if (options.on !== false) control({ action: 'on' });
  return { ...f, q, roomId, sourceId, control, proposal,
    task: id => q.detail(roomId, id).task,
    propose: body => q.propose(roomId, proposal(body), crypto.randomUUID()).taskId,
    step: async (ms = 1000) => { clock = Math.max(clock, Date.now()) + ms; await f.app.residentRunner.tick(); },
    advance: ms => { clock += ms; } };
}
