import type { Completion, CompletionInput, Providers } from '../connections/providers.js';
import type { WorkspaceState, CodexJob } from './model.js';
import type { Room, ResidentTurn } from './resident-model.js';
import { AppError, now } from './util.js';
import type { Store } from './store.js';

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

export function usageFor(room: Room) {
  const entries = room.ledger ?? [];
  return { requests: entries.length, inputTokens: entries.reduce((n, e) => n + (e.usage?.input ?? 0), 0),
    outputTokens: entries.reduce((n, e) => n + (e.usage?.output ?? 0), 0),
    unknownUsage: entries.filter(e => e.usage === null).length, toolJobs: room.toolReservations?.length ?? 0 };
}
export function budgetReason(room: Room, clock = Date.now()): string | null {
  if (!room.budgets || !room.pacing || !validBudget(room.budgets) || !validPacing(room.pacing)) return 'room_settings_required';
  const used = usageFor(room);
  if (Date.parse(room.budgets.deadlineAt) <= clock || used.requests >= room.budgets.maxRequests ||
      used.inputTokens + used.outputTokens >= room.budgets.maxTokens) return 'budget_exhausted';
  return null;
}
export function unresolvedProvider(state: WorkspaceState): boolean {
  return state.discussions.some(d => d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status))) ||
    !!state.resident?.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status));
}
export class DispatchCoordinator {
  workGuard?: (state: WorkspaceState, turn: ResidentTurn) => boolean;
  constructor(private readonly residentEnabled = true) {}
  async perform(store: Store, provider: Pick<Providers, 'complete'>, input: CompletionInput) {
    const allowed = store.transact((state, emit) => {
      const lease = state.resident?.dispatchLeases.find(l => l.id === input.requestId);
      const turn = state.resident?.turns.find(t => t.id === input.requestId) ?? state.discussions.flatMap(d => d.turns).find(t => t.id === input.requestId);
      if (!turn || turn.status !== 'prepared' || turn.dispatchStartedAt || lease && (lease.state !== 'reserved' || lease.invokedAt)) throw new AppError('dispatch_not_reserved', 409);
      if (input.participant.id !== turn.participantId || input.prompt !== turn.prompt) throw new AppError('dispatch_input_mismatch', 409);
      const room = state.resident?.rooms.find(r => r.id === lease?.roomId);
      if ('workAttemptId' in turn && turn.workAttemptId && (!this.workGuard || !this.workGuard(state, turn))) return false;
      if (room && (!this.residentEnabled || !room.desiredOn || !room.budgets || Date.parse(room.budgets.deadlineAt) <= Date.now() ||
          lease?.ownerKind === 'resident' && ('epoch' in turn && turn.epoch !== room.epoch || room.contexts?.find(c => c.participantId === turn.participantId)?.generation !== turn.generation))) return false;
      turn.dispatchStartedAt = now();
      if (lease) { lease.invokedAt = turn.dispatchStartedAt; lease.state = 'running'; }
      emit({ type: 'dispatch.claimed', discussionId: null, data: { requestId: input.requestId } });
      return true;
    });
    if (!allowed) return { result: null, failure: new AppError('dispatch_scope_changed', 409), uncertain: false };
    return performCompletion(provider, input);
  }
  reserve(state: WorkspaceState, input: { requestId: string; kind: 'topic' | 'resident' | 'work'; participantId: string; generation: number; roomId?: string | null }, clock = Date.now()): string | null {
    const resident = state.resident;
    if (unresolvedProvider(state) || resident?.dispatchLeases.some(l => l.state !== 'released')) return 'dispatch_busy';
    if (resident?.dispatchLeases.some(l => l.id === input.requestId)) return 'request_already_dispatched';
    const room = input.roomId ? resident?.rooms.find(r => r.id === input.roomId) : null;
    if (input.roomId && !room) return 'room_not_found';
    if (room) {
      if (!this.residentEnabled) return 'resident_disabled';
      if (!room.desiredOn) return 'room_off';
      const reason = budgetReason(room, clock); if (reason) return reason;
      (room.ledger ??= []).push({ requestId: input.requestId, kind: input.kind, reservedAt: now(), settledAt: null, usage: null, error: null });
    }
    resident?.dispatchLeases.push({ id: input.requestId, ownerKind: input.kind, ownerAttemptId: input.requestId,
      participantId: input.participantId, generation: input.generation, roomId: input.roomId ?? null, state: 'reserved' });
    return null;
  }
  settle(state: WorkspaceState, requestId: string, usage: Completion['usage'], error: string | null, uncertain: boolean): void {
    const lease = state.resident?.dispatchLeases.find(l => l.id === requestId);
    if (lease) lease.state = uncertain ? 'unconfirmed' : 'released';
    for (const room of state.resident?.rooms ?? []) {
      const entry = room.ledger?.find(e => e.requestId === requestId);
      if (entry && entry.settledAt === null && !uncertain) { entry.settledAt = now(); entry.usage = usage; entry.error = error; }
    }
  }
  reserveTool(state: WorkspaceState, discussionId: string, requestId: string): void {
    const d = state.discussions.find(d => d.id === discussionId); const room = state.resident?.rooms.find(r => r.id === d?.roomId);
    if (!room) return;
    if (!this.residentEnabled || !room.desiredOn || !room.budgets || Date.parse(room.budgets.deadlineAt) <= Date.now()) throw new AppError('room_tool_budget_exhausted', 409);
    if (room.toolReservations?.includes(requestId)) return;
    if (budgetReason(room) || usageFor(room).toolJobs >= room.budgets.maxToolJobs) throw new AppError('room_tool_budget_exhausted', 409);
    (room.toolReservations ??= []).push(requestId);
  }
  validateToolDispatch(state: WorkspaceState, job: CodexJob): void {
    const discussion = state.discussions.find(d => d.id === job.discussionId); if (!discussion?.roomId) return;
    const room = state.resident?.rooms.find(r => r.id === discussion.roomId);
    const slot = room?.toolReservations?.indexOf(job.requestId) ?? -1;
    if (!this.residentEnabled || !room || !room.desiredOn || !room.budgets || budgetReason(room) || slot < 0 || slot >= room.budgets.maxToolJobs) throw new AppError('room_tool_scope_changed', 409);
    job.maxDurationMs = Math.max(1, Math.min(job.maxDurationMs, Date.parse(room.budgets.deadlineAt) - Date.now()));
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
