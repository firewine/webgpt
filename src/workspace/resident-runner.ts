import type { Completion, Providers } from '../connections/providers.js';
import type { WorkspaceState } from './model.js';
import type { ResidentTurn, Room } from './resident-model.js';
import type { Store } from './store.js';
import type { ResidentStore } from './resident-store.js';
import type { DiscussionEngine } from './engine.js';
import { DispatchCoordinator, budgetReason, unresolvedProvider } from './dispatch.js';
import { roomContext, rotateResidentContext } from './resident-context.js';
import { parseResidentReply, promptForRoom, publicRoomData } from './resident-prompts.js';
import { AppError, code, digest, id, now, object, string } from './util.js';

type Emit = Parameters<Parameters<Store['transact']>[0]>[1];
const LIVE = ['prepared', 'running', 'unconfirmed'];
const WAKE = new Set(['resident.room_changed', 'resident.message_created', 'resident.turn_finished', 'resident.reconciled', 'resident.context_rotated',
  'turn.finished', 'discussion.phase', 'discussion.created', 'discussion.pause', 'discussion.resume', 'discussion.cancel', 'discussion.reconcile', 'browser.manual_control']);

export class ResidentRunner {
  private started = false; private stopping = false; private queued = false; private pending = false;
  private active: Promise<void> | null = null; private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null; private unsubscribe: (() => void) | null = null;
  private readonly clock: () => number;
  constructor(private readonly store: Store, private readonly resident: ResidentStore, private readonly dispatch: DispatchCoordinator,
    private readonly provider: Pick<Providers, 'complete'>, private readonly engine: DiscussionEngine, private readonly timeoutMs: number,
    private readonly options: { clock?: () => number; autoSchedule?: boolean } = {}) { this.clock = options.clock ?? Date.now; }

  recover(): void {
    if (!this.store.read().resident) return;
    this.store.transact((state, emit) => {
      for (const turn of state.resident!.turns) if (['prepared', 'running'].includes(turn.status)) {
        turn.status = 'unconfirmed'; turn.error = 'restart_requires_reconciliation';
        const room = state.resident!.rooms.find(r => r.id === turn.roomId);
        if (room) { room.observedStatus = 'blocked'; room.reason = turn.error; }
        emit({ type: 'resident.recovery_blocked', discussionId: null, data: { roomId: turn.roomId, turnId: turn.id } });
      }
      for (const lease of state.resident!.dispatchLeases) if (lease.state !== 'released') lease.state = 'unconfirmed';
      if (unresolvedProvider(state) || state.resident!.dispatchLeases.some(l => l.state !== 'released') || state.jobs.some(j => j.status === 'reconciling')) {
        for (const room of state.resident!.rooms) if (room.desiredOn && room.observedStatus !== 'blocked') {
          room.observedStatus = 'blocked'; room.reason = 'restart_requires_reconciliation'; room.nextEligibleAt = null;
          emit({ type: 'resident.recovery_blocked', discussionId: null, data: { roomId: room.id, reason: room.reason } });
        }
      }
    });
  }
  start(): void {
    this.started = true;
    this.unsubscribe = this.store.subscribe(event => {
      if (WAKE.has(event.type)) { this.engine.kick(); this.kick(); }
    });
    this.kick();
  }
  kick(): void {
    if (!this.started || this.stopping || !this.resident.enabled || this.options.autoSchedule === false) return;
    if (this.active) { this.pending = true; return; }
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; void this.tick().catch(() => this.failClosed()); });
  }
  tick(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.evaluate().finally(() => {
      this.active = null; this.arm();
      if (this.pending) { this.pending = false; this.kick(); }
    });
    return this.active;
  }
  private failClosed(): void {
    if (this.stopping) return;
    this.store.transact((state, emit) => { for (const room of state.resident?.rooms ?? []) if (room.desiredOn && room.observedStatus !== 'blocked') {
      room.observedStatus = 'blocked'; room.reason = 'resident_requires_review'; room.nextEligibleAt = null;
      emit({ type: 'resident.blocked', discussionId: null, data: { roomId: room.id, reason: room.reason } });
    } });
  }
  private arm(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.started || this.stopping || !this.resident.enabled || this.options.autoSchedule === false) return;
    const state = this.store.read();
    if (unresolvedProvider(state) || state.resident?.dispatchLeases.some(l => l.state !== 'released') || state.jobs.some(j => j.status === 'reconciling') || state.discussions.some(d => ['running', 'paused', 'blocked'].includes(d.status))) return;
    const times = (state.resident?.rooms ?? []).filter(r => r.desiredOn && r.observedStatus === 'on' && !r.topicLink)
      .map(r => Math.min(r.nextEligibleAt ? Date.parse(r.nextEligibleAt) : this.clock(), r.budgets ? Date.parse(r.budgets.deadlineAt) : this.clock()));
    if (!times.length) return;
    this.timer = setTimeout(() => { this.timer = null; this.kick(); }, Math.max(1, Math.min(2_147_483_647, Math.min(...times) - this.clock()))); this.timer.unref();
  }
  private async evaluate(): Promise<void> {
    if (!this.resident.enabled) return;
    this.projectFocus();
    const captured = this.store.transact((state, emit) => {
      const room = state.resident?.rooms.find(r => r.desiredOn && r.observedStatus === 'on' && !r.topicLink);
      if (!room) return null;
      const reason = budgetReason(room, this.clock());
      if (reason) { room.observedStatus = reason === 'budget_exhausted' ? 'budget_exhausted' : 'blocked'; room.reason = reason; room.nextEligibleAt = null;
        emit({ type: 'resident.status_changed', discussionId: null, data: { roomId: room.id, status: room.observedStatus, reason } }); return null; }
      if (unresolvedProvider(state) || state.resident!.dispatchLeases.some(l => l.state !== 'released') || state.jobs.some(j => j.status === 'reconciling') ||
          state.discussions.some(d => ['running', 'paused', 'blocked'].includes(d.status))) return null;
      if (room.nextEligibleAt && Date.parse(room.nextEligibleAt) > this.clock()) return null;
      const members = room.members.filter(m => m.enabled && !m.blockedReason).map(m => state.participants.find(p => p.id === m.participantId)).filter(p => p !== undefined);
      if (!members.length) { room.observedStatus = 'blocked'; room.reason = 'no_eligible_members'; room.nextEligibleAt = null;
        emit({ type: 'resident.status_changed', discussionId: null, data: { roomId: room.id, status: room.observedStatus, reason: room.reason } }); return null; }
      const repair = state.resident!.turns.find(t => t.roomId === room.id && t.epoch === room.epoch && t.error === 'format_invalid' && !t.repairOf &&
        members.some(m => m.id === t.participantId) && roomContext(room, t.participantId).generation === t.generation && !state.resident!.turns.some(r => r.repairOf === t.id));
      let index = (room.nextMemberIndex ?? 0) % members.length;
      if (repair) index = members.findIndex(m => m.id === repair.participantId);
      else {
        const ordered = members.map((_, offset) => (index + offset) % members.length);
        const targeted = ordered.find(i => state.resident!.messages.some(m => m.roomId === room.id && m.visibility === 'room_public' && m.sequence > roomContext(room, members[i]!.id).lastSeenSequence && m.mentions.includes(members[i]!.id)));
        const unseen = targeted ?? ordered.find(i => roomContext(room, members[i]!.id).lastSeenSequence < room.lastMessageSequence);
        if (unseen !== undefined) index = unseen;
        else if (room.lastCompletedAt && this.clock() < Date.parse(room.lastCompletedAt) + room.pacing!.idleNudgeMs) {
          room.nextEligibleAt = new Date(Date.parse(room.lastCompletedAt) + room.pacing!.idleNudgeMs).toISOString(); return null;
        }
      }
      const participant = members[index]!;
      if (participant.kind === 'browser' && state.browserPaused) { room.observedStatus = 'blocked'; room.reason = 'browser_manual_control';
        emit({ type: 'resident.status_changed', discussionId: null, data: { roomId: room.id, status: room.observedStatus, reason: room.reason } }); return null; }
      const context = roomContext(room, participant.id); const prompt = promptForRoom(state, room, participant, context, repair?.id ?? null);
      if (prompt.length + context.history.reduce((n, h) => n + h.content.length, 0) > 180_000) { room.observedStatus = 'blocked'; room.reason = 'context_limit_requires_handoff';
        emit({ type: 'resident.status_changed', discussionId: null, data: { roomId: room.id, status: room.observedStatus, reason: room.reason } }); return null; }
      const turn: ResidentTurn = { id: id('resident_turn'), roomId: room.id, participantId: participant.id, participant: structuredClone(participant),
        generation: context.generation, epoch: room.epoch, status: 'prepared', prompt, promptDigest: digest(prompt), history: structuredClone(context.history),
        basisSequence: room.lastMessageSequence, text: '', receipt: null, reply: null, usage: null, startedAt: new Date(this.clock()).toISOString(), finishedAt: null,
        error: null, repairOf: repair?.id ?? null, messageId: null, proposalsStatus: 'none' };
      const denied = this.dispatch.reserve(state, { requestId: turn.id, kind: 'resident', participantId: participant.id, generation: context.generation, roomId: room.id }, this.clock());
      if (denied) return null;
      state.resident!.turns.push(turn); room.nextMemberIndex = (index + 1) % members.length;
      emit({ type: 'resident.turn_prepared', discussionId: null, data: { roomId: room.id, turnId: turn.id, participantId: turn.participantId } });
      return { turn, remainingMs: Date.parse(room.budgets!.deadlineAt) - this.clock() };
    });
    if (!captured) return;
    this.abort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(Math.max(1, Math.min(this.timeoutMs, captured.remainingMs)))]);
    const update = (fn: (turn: ResidentTurn) => void, type: string) => this.store.transact((state, emit) => {
      const turn = state.resident!.turns.find(t => t.id === captured.turn.id)!; fn(turn);
      emit({ type, discussionId: null, data: { roomId: turn.roomId, turnId: turn.id } });
    });
    const outcome = await this.dispatch.perform(this.store, this.provider, { requestId: captured.turn.id, participant: captured.turn.participant,
      prompt: captured.turn.prompt, history: captured.turn.history, signal, hooks: {
        dispatched: () => update(t => { t.status = 'running'; }, 'resident.turn_dispatched'),
        receipt: receipt => update(t => { t.receipt = receipt; }, 'resident.turn_receipt'),
        delta: delta => update(t => { if (t.text.length + delta.length > 100_000) throw new AppError('response_too_large', 502, true); t.text += delta; }, 'resident.turn_progress') } });
    this.abort = null;
    this.store.transact((state, emit) => {
      const turn = state.resident!.turns.find(t => t.id === captured.turn.id)!; const room = state.resident!.rooms.find(r => r.id === turn.roomId)!;
      turn.finishedAt = new Date(this.clock()).toISOString(); room.updatedAt = turn.finishedAt;
      if (outcome.result) this.accept(state, room, turn, outcome.result, emit);
      else {
        turn.status = outcome.uncertain ? 'unconfirmed' : 'failed'; turn.error = code(outcome.failure);
        const member = room.members.find(m => m.participantId === turn.participantId);
        if (turn.error === 'dispatch_scope_changed') { turn.status = 'stale'; turn.proposalsStatus = 'stale'; }
        else if (member) member.blockedReason = turn.error;
        room.observedStatus = room.desiredOn ? 'blocked' : 'off'; room.reason = turn.error; room.nextEligibleAt = null;
      }
      this.dispatch.settle(state, turn.id, turn.usage, turn.error, turn.status === 'unconfirmed');
      emit({ type: 'resident.turn_finished', discussionId: null, data: { roomId: room.id, turnId: turn.id, status: turn.status, reason: turn.error } });
    });
  }
  private accept(state: WorkspaceState, room: Room, turn: ResidentTurn, result: Completion, emit: Emit): void {
    turn.text = result.text; turn.receipt = result.receipt; turn.usage = result.usage;
    const context = roomContext(room, turn.participantId);
    if (turn.epoch !== room.epoch || turn.generation !== context.generation) { turn.status = 'stale'; turn.proposalsStatus = 'stale'; return; }
    const data = publicRoomData(state, room); const messages = data.messages.filter(m => m.sequence <= turn.basisSequence);
    turn.reply = parseResidentReply(turn.text, { messageIds: messages.map(m => m.id), participantIds: room.members.map(m => m.participantId),
      claimIds: data.claims.filter(c => messages.some(m => m.sourceId === c.turnId)).map(c => c.id) });
    turn.status = 'completed';
    context.history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: turn.text }); context.lastSeenSequence = turn.basisSequence;
    room.lastCompletedAt = turn.finishedAt; room.nextEligibleAt = new Date(this.clock() + room.pacing!.minIntervalMs).toISOString();
    if (!turn.reply) {
      turn.error = 'format_invalid';
      if (turn.repairOf) { room.observedStatus = 'blocked'; room.reason = 'format_invalid'; const member = room.members.find(m => m.participantId === turn.participantId); if (member) member.blockedReason = 'format_invalid'; }
      return;
    }
    turn.proposalsStatus = turn.reply.proposals.length ? 'not_run' : 'none';
    if (turn.reply.action === 'pass') {
      room.passCount = (room.passCount ?? 0) + 1;
      room.nextEligibleAt = new Date(this.clock() + Math.max(room.pacing!.minIntervalMs, Math.min(86_400_000, room.pacing!.passBackoffMs * 2 ** Math.min(20, room.passCount - 1)))).toISOString();
      if (room.passCount >= room.pacing!.sleepAfterPasses) { room.observedStatus = 'sleeping'; room.reason = 'consecutive_passes'; room.nextEligibleAt = null; }
    } else {
      room.passCount = 0; const messageId = id('message'); turn.messageId = messageId;
      state.resident!.messages.push({ id: messageId, roomId: room.id, sequence: ++room.lastMessageSequence, sourceKind: 'room', sourceId: turn.id,
        authorId: turn.participantId, text: turn.reply.text, replyTo: turn.reply.replyTo, mentions: turn.reply.mentions, visibility: 'room_public', createdAt: turn.finishedAt! });
      for (const claim of turn.reply.claims) (state.resident!.claims ??= []).push({ id: id('room_claim'), roomId: room.id, turnId: turn.id, participantId: turn.participantId, status: 'reported', ...claim });
      emit({ type: 'resident.message_created', discussionId: null, data: { roomId: room.id, messageId, sequence: room.lastMessageSequence } });
    }
    if (turn.proposalsStatus === 'not_run') emit({ type: 'resident.proposals_not_run', discussionId: null, data: { roomId: room.id, turnId: turn.id, reason: 'work_wiki_phase_not_available' } });
  }
  private projectFocus(): void {
    const before = this.store.read(); if (!before.resident?.rooms.some(r => r.topicLink)) return;
    this.store.transact((state, emit) => { for (const room of state.resident!.rooms) {
      if (!room.topicLink) continue;
      const d = state.discussions.find(d => d.id === room.topicLink); if (!d) { room.observedStatus = 'blocked'; room.reason = 'focus_reference_missing'; continue; }
      const groups = new Set(d.turns.filter(t => t.revision === d.revision).map(t => t.phase + ':' + t.round));
      for (const key of groups) {
        const tasks = d.tasks.filter(t => t.revision === d.revision && t.phase + ':' + t.round === key);
        const expected = [...new Set(tasks.map(t => t.participantId))];
        if (!expected.length || tasks.some(t => ['pending', 'running', 'unconfirmed'].includes(t.status))) continue;
        const turns = expected.map(pid => d.turns.findLast(t => t.revision === d.revision && t.phase + ':' + t.round === key && t.participantId === pid && t.status === 'completed' && t.reply));
        if (turns.some(t => !t)) continue;
        for (const turn of turns) {
          if (!turn || state.resident!.messages.some(m => m.sourceId === turn.id && m.roomId === room.id)) continue;
          const messageId = id('message'); state.resident!.messages.push({ id: messageId, roomId: room.id, sequence: ++room.lastMessageSequence, sourceKind: 'topic', sourceId: turn.id,
            authorId: turn.participantId, text: turn.reply!.text, replyTo: null, mentions: [], visibility: 'room_public', createdAt: now() });
          for (const claim of d.claims.filter(c => c.turnId === turn.id)) (state.resident!.claims ??= []).push({ id: claim.id, roomId: room.id, turnId: turn.id, participantId: claim.participantId, text: claim.text, assumptions: claim.assumptions, status: 'reported' });
          emit({ type: 'resident.message_created', discussionId: null, data: { roomId: room.id, messageId, sequence: room.lastMessageSequence } });
        }
      }
      if (['completed', 'partial', 'cancelled'].includes(d.status) && !d.turns.some(t => LIVE.includes(t.status)) &&
          !state.jobs.some(j => j.discussionId === d.id && ['queued', 'running', 'blocked_approval', 'reconciling'].includes(j.status))) {
        room.legacyDiscussionIds.push(d.id); room.topicLink = null; room.version++; room.updatedAt = now();
        room.nextEligibleAt = new Date(this.clock() + (room.pacing?.minIntervalMs ?? 0)).toISOString();
        emit({ type: 'resident.focus_returned', discussionId: null, data: { roomId: room.id, discussionId: d.id } });
      }
    } });
  }
  focus(roomId: string, input: unknown, requestId: string): string {
    if (!this.resident.enabled) throw new AppError('resident_disabled', 409);
    return this.engine.create(input, 'resident:focus:' + string(requestId, 200), roomId);
  }
  handoff(roomId: string, input: unknown, requestId: string) { return rotateResidentContext(this.store, this.resident.enabled, roomId, input, requestId); }
  reconcile(roomId: string, turnId: string, input: unknown, requestId: string) {
    const body = object(input); if (Object.keys(body).some(k => !['resolution', 'text', 'receipt'].includes(k))) throw new AppError('invalid_room_fields');
    return this.store.transact((state, emit) => {
      if (!this.resident.enabled) throw new AppError('resident_disabled', 409);
      const turn = state.resident?.turns.find(t => t.id === turnId && t.roomId === roomId && t.status === 'unconfirmed');
      const room = state.resident?.rooms.find(r => r.id === roomId); if (!turn || !room) throw new AppError('unconfirmed_turn_not_found', 404);
      turn.finishedAt = now();
      if (body.resolution === 'completed') {
        const text = string(body.text, 100_000); const receipt = 'owner-confirmed:' + string(body.receipt, 2000);
        this.accept(state, room, turn, { text, receipt, usage: null }, emit);
        if (turn.status !== 'stale' && !turn.reply) throw new AppError('format_invalid');
      } else if (body.resolution === 'not_sent' || body.resolution === 'skip') { turn.status = 'failed'; turn.error = 'owner_confirmed_' + body.resolution; }
      else throw new AppError('invalid_resolution');
      this.dispatch.settle(state, turn.id, turn.usage, turn.error, false);
      room.observedStatus = room.desiredOn ? 'blocked' : 'off'; room.reason = 'owner_resume_required'; room.nextEligibleAt = null;
      emit({ type: 'resident.reconciled', discussionId: null, data: { roomId, turnId, status: turn.status } });
      return { turnId, status: turn.status };
    }, { id: 'resident:reconcile:' + string(requestId, 200), input: { roomId, turnId, body } });
  }
  turn(roomId: string, turnId: string) {
    const turn = this.store.read().resident?.turns.find(t => t.roomId === roomId && t.id === turnId);
    if (!turn) throw new AppError('resident_turn_not_found', 404); return { turn, digest: digest(turn.text), cursor: this.store.cursor() };
  }
  turns(roomId: string, after: number, limit: number) {
    this.resident.room(roomId);
    const all = this.store.read().resident!.turns.filter(t => t.roomId === roomId);
    if (after > all.length) throw new AppError('invalid_cursor', 409);
    const turns = all.slice(after, after + limit).map(t => ({ id: t.id, participantId: t.participantId, status: t.status, generation: t.generation,
      epoch: t.epoch, startedAt: t.startedAt, finishedAt: t.finishedAt, error: t.error, messageId: t.messageId, proposalsStatus: t.proposalsStatus, digest: digest(t.text) }));
    return { turns, nextAfter: after + turns.length, hasMore: after + turns.length < all.length, cursor: this.store.cursor() };
  }
  checkpoint(roomId: string, checkpointId: string) {
    const checkpoint = this.store.read().resident?.contextCheckpoints.find(c => c.roomId === roomId && c.id === checkpointId);
    if (!checkpoint) throw new AppError('resident_checkpoint_not_found', 404); return { checkpoint, cursor: this.store.cursor() };
  }
  async close(): Promise<void> {
    this.stopping = true; this.unsubscribe?.(); if (this.timer) clearTimeout(this.timer); this.abort?.abort(); await this.active;
  }
}
