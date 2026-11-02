import type { WorkspaceState } from './model.js';
import type { Room } from './resident-model.js';
import type { SeatAssignment, WorkAction, WorkRole, WorkTask, WorkAcceptance, WorkCheck } from './work-model.js';
import { budgetReason } from './dispatch.js';
import { participantWait } from './api-usage.js';
import { dotGrants } from './dot-mcp-policy.js';
import { AppError, object, string, strings } from './util.js';

export const WORK_POLICIES: Readonly<Record<WorkRole, readonly WorkAction[]>> = {
  manager: ['propose', 'manage', 'review'], assistant: ['propose', 'manage', 'review'],
  specialist: ['propose', 'claim', 'report', 'review'], executor: ['claim', 'report'], monitor: [],
};
export const WORK_LIVE = ['claimed', 'running', 'unconfirmed'];
export function workRoom(state: WorkspaceState, roomId: string): Room {
  const room = state.resident?.rooms.find(r => r.id === roomId); if (!room) throw new AppError('room_not_found', 404); return room;
}
export function onlyWork(body: Record<string, unknown>, keys: string[]): void { if (Object.keys(body).some(k => !keys.includes(k))) throw new AppError('invalid_work_fields'); }
export function uniqueWork(value: unknown, max = 20): string[] { return [...new Set(strings(value, max))]; }
export function acceptance(value: unknown): WorkAcceptance[] {
  if (!Array.isArray(value) || value.length > 20) throw new AppError('invalid_work_acceptance');
  const items = value.map(v => { const a = object(v); onlyWork(a, ['id', 'text', 'check']); const c = object(a.check ?? { kind: 'manual' }); onlyWork(c, ['kind', 'value']);
    if (!['manual', 'text_includes', 'execution'].includes(String(c.kind))) throw new AppError('invalid_work_acceptance');
    return { id: string(a.id, 100), text: string(a.text, 2000), check: { kind: c.kind as WorkAcceptance['check']['kind'], ...(c.kind === 'text_includes' ? { value: string(c.value, 2000) } : {}) } }; });
  if (new Set(items.map(a => a.id)).size !== items.length) throw new AppError('invalid_work_acceptance'); return items;
}
export function seatAllows(state: WorkspaceState, room: Room, pid: string, action: WorkAction, kind: WorkTask['kind'], scope: string): SeatAssignment | null {
  const seat = room.seats?.find(s => s.participantId === pid);
  if (!seat?.enabled || seat.policyVersion !== 1 || !Object.hasOwn(WORK_POLICIES, seat.role) || !WORK_POLICIES[seat.role].includes(action) || !seat.kinds.includes(kind) || !seat.scopeRefs.includes(scope)) return null;
  const member = room.members.find(m => m.participantId === pid); const participant = state.participants.find(p => p.id === pid);
  if (!member?.enabled || member.blockedReason || !participant || participant.kind === 'browser' && state.browserPaused) return null;
  if (participant.kind === 'dot-mcp') { if (!dotGrants(state, room, participant).length) return null; }
  else if (participant.kind !== 'fake' && !state.connections.some(c => c.id === participant.connectionId && c.kind === participant.kind && c.status === 'connected')) return null;
  return seat;
}
export function taskWorker(state: WorkspaceState, room: Room, task: WorkTask, pid: string, action: 'claim' | 'review', checkAvailability = false): SeatAssignment | null {
  const seat = seatAllows(state, room, pid, action, task.kind, task.authorizedScopeRef);
  const p = state.participants.find(p => p.id === pid);
  // Dispatch availability does not revoke a completed report/review's scope.
  if (checkAvailability && p && !(action === 'claim' && task.kind === 'codex') && participantWait(state, room, p)) return null;
  if (!seat || action === 'claim' && (!task.allowedParticipantIds.includes(pid) || task.requiredRole && seat.role !== task.requiredRole)) return null;
  return seat;
}
export function slotAvailable(state: WorkspaceState, pid: string, ignoreAttempt?: string): boolean {
  const participant = state.participants.find(p => p.id === pid); if (!participant) return false;
  const account = participant.connectionId ?? participant.id;
  const mine = (other: string) => other === pid || (state.participants.find(p => p.id === other)?.connectionId ?? other) === account;
  const ignoredTurn = state.resident!.workAttempts.find(a => a.id === ignoreAttempt)?.providerTurnId;
  if (state.resident!.turns.some(t => t.id !== ignoredTurn && ['prepared', 'running', 'unconfirmed'].includes(t.status) && mine(t.participantId)) || state.discussions.some(d => d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status) && mine(t.participantId)))) return false;
  return !state.resident!.workAttempts.some(a => a.id !== ignoreAttempt && WORK_LIVE.includes(a.status) &&
    (a.participantId === pid || (state.participants.find(p => p.id === a.participantId)?.connectionId ?? a.participantId) === account));
}
export type ExecutionReadiness = (state: WorkspaceState, task: WorkTask) => string | null;
export function readyReason(state: WorkspaceState, room: Room, task: WorkTask, clock = Date.now(), execution?: ExecutionReadiness): string | null {
  if (!task.sourceMessageIds.length) return 'work_source_required';
  if (!task.acceptance.length) return 'work_acceptance_required';
  if (!task.allowedParticipantIds.length || !task.authorizedScopeRef) return 'work_assignment_required';
  if (task.kind === 'codex') { const reason = execution ? execution(state, task) : 'work_execution_phase_pending'; if (reason) return reason; }
  const reason = budgetReason(room, clock); if (reason) return reason;
  if (task.dependencies.some(id => !state.resident!.workItems.some(t => t.id === id && t.roomId === room.id && t.status === 'done'))) return 'work_dependency_pending';
  if (!task.allowedParticipantIds.some(pid => taskWorker(state, room, task, pid, 'claim', true))) return 'work_scope_not_authorized';
  return null;
}
export function checkReferences(state: WorkspaceState, room: Room, task: Pick<WorkTask, 'id' | 'sourceMessageIds' | 'dependencies' | 'allowedParticipantIds' | 'authorizedScopeRef'>): void {
  if (task.sourceMessageIds.some(id => !state.resident!.messages.some(m => m.id === id && m.roomId === room.id && m.visibility === 'room_public'))) throw new AppError('work_source_not_public', 403);
  if (task.allowedParticipantIds.some(pid => !room.members.some(m => m.participantId === pid))) throw new AppError('participant_not_in_room', 403);
  if (task.authorizedScopeRef && task.authorizedScopeRef !== 'room:' + room.id && !state.bindings.some(b => 'binding:' + b.id === task.authorizedScopeRef)) throw new AppError('work_scope_not_found', 403);
  const checked = new Set<string>();
  const visit = (id: string, seen: Set<string>): void => {
    if (id === task.id || seen.has(id)) throw new AppError('work_dependency_cycle', 409);
    if (checked.has(id)) return;
    const dep = state.resident!.workItems.find(t => t.id === id && t.roomId === room.id); if (!dep) throw new AppError('work_dependency_not_found', 404);
    for (const next of dep.dependencies) visit(next, new Set([...seen, id]));
    checked.add(id);
  };
  for (const id of task.dependencies) visit(id, new Set());
}
export function artifactChecks(task: WorkTask, text: string, ref: string): WorkCheck[] {
  return task.acceptance.map(a => ({ acceptanceId: a.id,
    outcome: a.check.kind === 'text_includes' ? text.includes(a.check.value!) ? 'observed_pass' : 'observed_fail' : a.check.kind === 'execution' ? 'not_run' : 'reported',
    evidenceRefs: [ref], observation: a.check.kind === 'text_includes' ? '서버가 산출물 원문에서 지정 문구 포함 여부를 검사함. 사실 검증 판정이 아님.' : a.check.kind === 'execution' ? '실행 근거 연결은 페이즈 6에서 검사함.' : '독립 검토자의 수동 확인이 필요함.' }));
}

export function validateWorkState(state: WorkspaceState): void {
  const r = state.resident; if (!r) return;
  if (r.workSchemaVersion === undefined) { if (r.workItems.length || r.workAttempts.length || r.rooms.some(room => room.seats?.length)) throw new AppError('unsupported_work_state', 503); return; }
  if (r.workSchemaVersion !== 1) throw new AppError('unsupported_work_schema', 503);
  const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
  const text = (v: unknown) => typeof v === 'string'; const refs = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const badTask = (t: WorkTask) => !text(t.id) || !text(t.title) || !text(t.description) || !text(t.proposalKey) || !hash(t.proposalDigest) || !['analysis', 'codex'].includes(t.kind) || !refs(t.sourceMessageIds) || !refs(t.dependencies) || !refs(t.allowedParticipantIds) || !text(t.authorizedScopeRef) || !Number.isSafeInteger(t.priority) ||
    t.acceptance.some(a => !a || !text(a.id) || !text(a.text) || !a.check || !['manual', 'text_includes', 'execution'].includes(a.check.kind) || a.check.kind === 'text_includes' && !text(a.check.value)) ||
    t.reports.some(p => !p || !hash(p.digest) || !text(p.id) || !text(p.text) || !Array.isArray(p.acceptance) || !Array.isArray(p.checks) || !Array.isArray(p.outputs) || !Array.isArray(p.blockers)) || t.reviews.some(v => !v || !hash(v.reportDigest) || !Array.isArray(v.checks));
  if (r.workItems.some(t => !t || !count(t.version) || !Array.isArray(t.reports) || !Array.isArray(t.reviews) || !Array.isArray(t.dependencies) || !Array.isArray(t.acceptance) ||
      !['backlog', 'ready', 'claimed', 'running', 'review', 'rework', 'done', 'blocked', 'failed', 'cancelled'].includes(t.status) || !r.rooms.some(room => room.id === t.roomId) || badTask(t)) ||
    r.workAttempts.some(a => !a || !count(a.taskVersion) || !count(a.contextGeneration) || !count(a.seatVersion) || !count(a.epoch) || a.requestId !== 'resident-work:' + a.id || a.providerTurnId !== null && !text(a.providerTurnId) || !hash(a.inputDigest) || !a.input || a.providerPromptDigest !== null && !hash(a.providerPromptDigest) || !['claimed', 'running', 'unconfirmed', 'completed', 'failed', 'stale'].includes(a.status) || !r.workItems.some(t => t.id === a.taskId && t.roomId === a.roomId)) ||
    r.rooms.some(room => room.seats && (!Array.isArray(room.seats) || room.seats.some(s => !s || !count(s.version) || s.policyVersion !== 1 || !Object.hasOwn(WORK_POLICIES, s.role) || typeof s.enabled !== 'boolean' || !Array.isArray(s.kinds) || !s.kinds.every(k => ['analysis', 'codex'].includes(k)) || !Array.isArray(s.scopeRefs))))) throw new AppError('invalid_work_state', 503);
}
