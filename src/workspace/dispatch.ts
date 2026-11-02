import type { Completion, CompletionInput, Providers } from '../connections/providers.js';
import type { WorkspaceState, CodexJob, Member } from './model.js';
import type { Room, RoomToolBudget, ResidentTurn } from './resident-model.js';
import { AppError, now } from './util.js';
import type { Store } from './store.js';
import { assertWikiSnapshots, wikiHistoryAllowed } from './wiki-policy.js';
import { reserveApiUsage, claimApiUsage, settleApiUsage } from './api-usage.js';
import type { DotMcpAdapter, DotInput } from '../connections/dot-mcp.js';

const bounded = (v: unknown, min: number, max: number): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
export function validBudget(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return bounded(v.maxRequests, 1, 10_000) && bounded(v.maxTokens, 1, 100_000_000) && bounded(v.maxToolJobs, 0, 100) && typeof v.deadlineAt === 'string' && Number.isFinite(Date.parse(v.deadlineAt));
}
export function validPacing(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return bounded(v.minIntervalMs, 1, 3_600_000) && bounded(v.idleNudgeMs, 1, 86_400_000) && bounded(v.passBackoffMs, 1, 86_400_000) && bounded(v.sleepAfterPasses, 1, 100);
}
export function validToolBudget(value: unknown): value is RoomToolBudget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return bounded(v.maxToolJobs, 0, 100) && typeof v.deadlineAt === 'string' && Number.isFinite(Date.parse(v.deadlineAt));
}
export function toolBudget(room: Room): RoomToolBudget | null {
  if (room.toolBudget !== undefined) return room.toolBudget;
  return room.budgets ? { maxToolJobs: room.budgets.maxToolJobs, deadlineAt: room.budgets.deadlineAt } : null;
}

export function usageFor(room: Room) {
  const entries = room.ledger ?? [];
  return { requests: entries.length, inputTokens: entries.reduce((n, e) => n + (e.usage?.input ?? 0), 0),
    outputTokens: entries.reduce((n, e) => n + (e.usage?.output ?? 0), 0),
    unknownUsage: entries.filter(e => e.usage === null).length, toolJobs: room.toolReservations?.length ?? 0 };
}
export function budgetReason(room: Room, _clock?: number): string | null {
  if (!room.pacing || !validPacing(room.pacing)) return 'room_settings_required';
  return null;
}
export function toolBudgetReason(room: Room, clock = Date.now()): string | null {
  const b = toolBudget(room);
  return !validToolBudget(b) || Date.parse(b.deadlineAt) <= clock ? 'room_tool_budget_exhausted' : null;
}
export function unresolvedProvider(state: WorkspaceState): boolean {
  return state.discussions.some(d => d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status))) ||
    !!state.resident?.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status));
}
export class DispatchCoordinator {
  dot?: Pick<DotMcpAdapter, 'prepare' | 'settle'>;
  prepareDot(state: WorkspaceState, emit: Parameters<Parameters<Store['transact']>[0]>[1], input: DotInput): void {
    if (input.participant.kind !== 'dot-mcp') return;
    if (!this.dot) throw new AppError('dot_transport_not_ready', 409);
    this.dot.prepare(state, emit, input);
  }
  workGuard?: (state: WorkspaceState, turn: ResidentTurn) => boolean;
  constructor(private readonly residentEnabled = true) {}
  async perform(store: Store, provider: Pick<Providers, 'complete'>, input: CompletionInput) {
    const allowed = store.transact((state, emit) => {
      const lease = state.resident?.dispatchLeases.find(l => l.id === input.requestId);
      const turn = state.resident?.turns.find(t => t.id === input.requestId) ?? state.discussions.flatMap(d => d.turns).find(t => t.id === input.requestId);
      if (!turn || turn.status !== 'prepared' || turn.dispatchStartedAt || lease && (lease.state !== 'reserved' || lease.invokedAt)) throw new AppError('dispatch_not_reserved', 409);
      if (input.participant.id !== turn.participantId || input.prompt !== turn.prompt) throw new AppError('dispatch_input_mismatch', 409);
      const room = state.resident?.rooms.find(r => r.id === lease?.roomId);
      if (room && 'wikiCitations' in turn && !assertWikiSnapshots(state, room.id, [turn.participantId], turn.wikiCitations)) return false;
      const history = room?.contexts?.find(c => c.participantId === turn.participantId);
      if (room && history && !wikiHistoryAllowed(state, room, history)) return false;
      if ('workAttemptId' in turn && turn.workAttemptId && (!this.workGuard || !this.workGuard(state, turn))) return false;
      if (room && (!this.residentEnabled || !room.desiredOn || budgetReason(room) ||
          lease?.ownerKind === 'resident' && ('epoch' in turn && turn.epoch !== room.epoch || room.contexts?.find(c => c.participantId === turn.participantId)?.generation !== turn.generation))) return false;
      turn.dispatchStartedAt = now();
      if (lease) { lease.invokedAt = turn.dispatchStartedAt; lease.state = 'running'; }
      emit({ type: 'dispatch.claimed', discussionId: null, data: { requestId: input.requestId } });
      return true;
    });
    if (!allowed) return { result: null, failure: new AppError('dispatch_scope_changed', 409), uncertain: false };
    return performCompletion(provider, { ...input, hooks: { ...input.hooks, dispatched: () => {
      store.transact(state => { const lease = state.resident?.dispatchLeases.find(l => l.id === input.requestId); const room = state.resident?.rooms.find(r => r.id === lease?.roomId);
        const denied = claimApiUsage(state, input.participant, input.requestId, room, Date.now()); if (denied) throw new AppError(denied, 409); });
      input.hooks.dispatched();
    } } });
  }
  reserve(state: WorkspaceState, input: { requestId: string; kind: 'topic' | 'resident' | 'work'; participantId: string; participant?: Member; generation: number; roomId?: string | null }, clock = Date.now()): string | null {
    const resident = state.resident;
    if (unresolvedProvider(state) || resident?.dispatchLeases.some(l => l.state !== 'released')) return 'dispatch_busy';
    if (resident?.dispatchLeases.some(l => l.id === input.requestId)) return 'request_already_dispatched';
    const room = input.roomId ? resident?.rooms.find(r => r.id === input.roomId) : null;
    if (input.roomId && !room) return 'room_not_found';
    if (room) {
      if (!this.residentEnabled) return 'resident_disabled';
      if (!room.desiredOn) return 'room_off';
      const reason = budgetReason(room, clock); if (reason) return reason;
    }
    const participant = input.participant ?? state.participants.find(p => p.id === input.participantId);
    if (participant) { const reason = reserveApiUsage(state, participant, input.requestId, room ?? undefined, clock); if (reason) return reason; }
    if (room) {
      (room.ledger ??= []).push({ requestId: input.requestId, kind: input.kind, reservedAt: now(), settledAt: null, usage: null, error: null });
    }
    resident?.dispatchLeases.push({ id: input.requestId, ownerKind: input.kind, ownerAttemptId: input.requestId,
      participantId: input.participantId, generation: input.generation, roomId: input.roomId ?? null, state: 'reserved' });
    return null;
  }
  settle(state: WorkspaceState, requestId: string, usage: Completion['usage'], error: string | null, uncertain: boolean): void {
    this.dot?.settle(state, requestId);
    settleApiUsage(state, requestId, usage, error, uncertain);
    const lease = state.resident?.dispatchLeases.find(l => l.id === requestId);
    if (lease) lease.state = uncertain ? 'unconfirmed' : 'released';
    for (const room of state.resident?.rooms ?? []) {
      const entry = room.ledger?.find(e => e.requestId === requestId);
      if (entry && entry.settledAt === null && !uncertain) { entry.settledAt = now(); entry.usage = usage; entry.error = error; }
    }
  }
  recover(state: WorkspaceState): void {
    for (const e of state.apiUsage?.entries ?? []) if (e.status === 'running') { e.status = 'unconfirmed'; e.error = 'restart_requires_reconciliation'; e.finishedAt = null; }
  }
  reserveTool(state: WorkspaceState, discussionId: string, requestId: string): void {
    const d = state.discussions.find(d => d.id === discussionId); const room = state.resident?.rooms.find(r => r.id === d?.roomId);
    if (!room) return;
    if (!this.residentEnabled || !room.desiredOn || toolBudgetReason(room)) throw new AppError('room_tool_budget_exhausted', 409);
    if (room.toolReservations?.includes(requestId)) return;
    if (usageFor(room).toolJobs >= toolBudget(room)!.maxToolJobs) throw new AppError('room_tool_budget_exhausted', 409);
    (room.toolReservations ??= []).push(requestId);
  }
  validateToolDispatch(state: WorkspaceState, job: CodexJob): void {
    const discussion = state.discussions.find(d => d.id === job.discussionId); if (!discussion?.roomId) return;
    const room = state.resident?.rooms.find(r => r.id === discussion.roomId);
    const slot = room?.toolReservations?.indexOf(job.requestId) ?? -1;
    if (!this.residentEnabled || !room || !room.desiredOn || toolBudgetReason(room) || slot < 0 || slot >= toolBudget(room)!.maxToolJobs) throw new AppError('room_tool_scope_changed', 409);
    job.maxDurationMs = Math.max(1, Math.min(job.maxDurationMs, Date.parse(toolBudget(room)!.deadlineAt) - Date.now()));
  }
}
export function classifyFailure(error: unknown, dispatched: boolean): boolean { return dispatched && (!(error instanceof AppError) || error.uncertain); }
// The transports keep their own completion/receipt rules. This boundary only
// captures dispatch uncertainty, and never retries or substitutes a provider.
async function performCompletion(provider: Pick<Providers, 'complete'>, input: CompletionInput): Promise<{ result: Completion | null; failure: unknown; uncertain: boolean }> {
  let dispatched = false;
  try {
    const result = await provider.complete({ ...input, hooks: { ...input.hooks, dispatched: () => { dispatched = true; input.hooks.dispatched(); } } });
    if (result.text.length > 100_000) throw new AppError('response_too_large', 502, true);
    return { result, failure: null, uncertain: false };
  } catch (failure) { return { result: null, failure, uncertain: classifyFailure(failure, dispatched) }; }
}
