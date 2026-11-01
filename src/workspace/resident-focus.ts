import type { WorkspaceState } from './model.js';
import type { Room, ResidentTurn, TopicIntent } from './resident-model.js';
import type { Store } from './store.js';
import type { DiscussionEngine } from './engine.js';
import { AppError, code, digest, integer, now, object, string, strings } from './util.js';
import { budgetReason, unresolvedProvider, usageFor } from './dispatch.js';
import { participantIdentity, contextWiki, visibleRoomMessages, assertWikiSnapshots } from './wiki-policy.js';
import { dailyRoom, participantWait } from './api-usage.js';

type Emit = Parameters<Parameters<Store['transact']>[0]>[1];
const hash = (v: unknown) => digest(JSON.stringify(v));
const command = (i: TopicIntent) => ({ action: 'create', body: i.input, roomId: i.roomId });
export function topicPolicy(s: WorkspaceState, r: Room): string {
  return hash({ members: r.members, seats: r.seats ?? [], participants: r.members.map(m => {
    const p = s.participants.find(p => p.id === m.participantId); const c = s.connections.find(c => c.id === p?.connectionId);
    return { p, generation: r.contexts?.find(c => c.participantId === m.participantId)?.generation ?? 1,
      connection: c ? { status: c.status, subject: c.subject, browser: c.browser } : null };
  }), browserPaused: s.browserPaused, ...(dailyRoom(r) ? { budgetMode: r.budgetMode, apiPolicyVersion: s.apiUsage?.version ?? 0 } : {}) });
}
function basis(s: WorkspaceState, r: Room, pids: string[]): string {
  return hash({ messages: visibleRoomMessages(s, r, pids), wiki: contextWiki(s, r, pids) });
}
export function validateTopicIntents(s: WorkspaceState): void {
  const intents = s.resident?.topicIntents; if (intents === undefined) return;
  if (!Array.isArray(intents) || new Set(intents.map(i => i?.id)).size !== intents.length || intents.some(i => {
    const turn = s.resident?.turns.find(t => t.id === i?.turnId && t.roomId === i?.roomId);
    return !i || !turn || i.id !== `resident-topic:${i.turnId}:${i.index}` || !Number.isSafeInteger(i.index) || i.index < 0 ||
      turn.reply?.proposals[i.index]?.kind !== 'topic_propose' || i.participantId !== turn.participantId || i.epoch !== turn.epoch || i.generation !== turn.generation ||
      !['queued', 'linked', 'rejected'].includes(i.status) || !i.input || hash(i.input) !== i.inputDigest ||
      Object.keys(i.input).some(k => !['topic', 'criteria', 'participantIds', 'limits'].includes(k)) || typeof i.input.topic !== 'string' || !i.input.topic.trim() || i.input.topic.length > 5000 || typeof i.input.criteria !== 'string' || !i.input.criteria.trim() || i.input.criteria.length > 2000 ||
      !i.input.limits || Object.keys(i.input.limits).some(k => !['maxRequests', 'maxTokens', 'maxActiveMs', 'maxRounds', 'maxVerificationTasks', 'maxToolJobs'].includes(k)) ||
      !Object.values(i.input.limits).every(Number.isSafeInteger) || i.input.limits.maxRequests < 6 || i.input.limits.maxRequests > 200 || i.input.limits.maxTokens < 1000 || i.input.limits.maxTokens > 1_000_000 || i.input.limits.maxActiveMs < 5000 || i.input.limits.maxActiveMs > 7_200_000 || i.input.limits.maxRounds < 1 || i.input.limits.maxRounds > 8 || i.input.limits.maxVerificationTasks !== 0 || i.input.limits.maxToolJobs !== 0 ||
      !/^[a-f0-9]{64}$/.test(i.policyDigest) || !/^[a-f0-9]{64}$/.test(i.basisDigest) ||
      !Array.isArray(i.input.participantIds) || i.input.participantIds.length < 2 || i.input.participantIds.length > 8 || i.input.participantIds.some(p => typeof p !== 'string' || !p) || new Set(i.input.participantIds).size !== i.input.participantIds.length ||
      !(i.discussionId === null || typeof i.discussionId === 'string') || i.status === 'linked' && !s.discussions.some(d => d.id === i.discussionId && d.roomId === i.roomId);
  })) throw new AppError('invalid_topic_intent_state', 503);
}

// Records a bounded intent with the original reply, then calls the existing
// engine outside that transaction. Its command receipt is the crash boundary;
// this module never performs provider I/O or creates a second topic engine.
export class ResidentFocus {
  constructor(private readonly store: Store, private readonly engine: DiscussionEngine, private readonly enabled: boolean) { validateTopicIntents(store.read()); }
  capture(s: WorkspaceState, r: Room, turn: ResidentTurn, emit: Emit, clock: number): void {
    if (!this.enabled || turn.workAttemptId || turn.status !== 'completed' || !turn.reply) return;
    for (const [index, proposal] of turn.reply.proposals.entries()) {
      if (proposal.kind !== 'topic_propose') continue;
      const id = `resident-topic:${turn.id}:${index}`; const results = turn.proposalResults ??= [];
      if (s.resident!.topicIntents?.some(i => i.id === id) || results.some(v => v.index === index)) continue;
      try {
        if (!r.autoTopic || !r.desiredOn) throw new AppError('auto_topic_not_allowed', 403);
        const p = s.participants.find(p => p.id === turn.participantId);
        if (!p || !r.members.some(m => m.participantId === p.id && m.enabled && !m.blockedReason) || turn.epoch !== r.epoch ||
            turn.generation !== (r.contexts?.find(c => c.participantId === p.id)?.generation ?? 1) || participantIdentity(p) !== participantIdentity(turn.participant) ||
            turn.topicPolicyDigest !== topicPolicy(s, r) || (turn.workSeatVersion ?? 0) !== (r.seats?.find(seat => seat.participantId === p.id)?.version ?? 0) || !assertWikiSnapshots(s, r.id, [p.id], turn.wikiCitations)) throw new AppError('auto_topic_scope_changed', 409);
        if (turn.reply.proposals.filter(p => p.kind === 'topic_propose').length !== 1) throw new AppError('invalid_topic_proposal');
        const b = object(proposal.payload);
        if (Object.keys(b).some(k => !['topic', 'criteria', 'maxRounds', 'sourceMessageIds'].includes(k))) throw new AppError('invalid_topic_proposal');
        const pids = r.members.filter(m => m.enabled && !m.blockedReason).map(m => m.participantId);
        if (pids.length < 2 || pids.length > 8) throw new AppError('two_participants_required');
        for (const pid of pids) { const member = s.participants.find(p => p.id === pid); const wait = member && participantWait(s, r, member, clock); if (wait) throw new AppError(wait, 409); }
        const sources = strings(b.sourceMessageIds, 20); const visible = visibleRoomMessages(s, r, pids);
        if (!sources.length || sources.some(id => !visible.some(m => m.id === id && m.sequence <= turn.basisSequence))) throw new AppError('topic_source_not_public', 403);
        const reason = budgetReason(r, clock); if (reason) throw new AppError(reason, 409);
        const used = usageFor(r); const requests = dailyRoom(r) ? 200 : Math.min(200, r.budgets!.maxRequests - used.requests);
        const tokens = dailyRoom(r) ? 1_000_000 : Math.min(1_000_000, r.budgets!.maxTokens - used.inputTokens - used.outputTokens);
        const activeMs = dailyRoom(r) ? 7_200_000 : Math.min(7_200_000, Date.parse(r.budgets!.deadlineAt) - clock);
        if (requests < 3 * pids.length || tokens < 1000 || activeMs < 5000) throw new AppError('auto_topic_budget_insufficient', 409);
        const input: TopicIntent['input'] = { topic: string(b.topic, 5000), criteria: string(b.criteria, 2000), participantIds: pids,
          limits: { maxRequests: requests, maxTokens: tokens, maxActiveMs: activeMs, maxRounds: integer(b.maxRounds, 2, 1, 8), maxVerificationTasks: 0, maxToolJobs: 0 } };
        (s.resident!.topicIntents ??= []).push({ id, roomId: r.id, turnId: turn.id, index, participantId: p.id, epoch: r.epoch, generation: turn.generation,
          policyDigest: topicPolicy(s, r), basisDigest: basis(s, r, pids), input, inputDigest: hash(input), createdAt: now(), status: 'queued', discussionId: null, reason: null });
        results.push({ index, status: 'applied', intentId: id });
        emit({ type: 'resident.topic_intent', discussionId: null, data: { roomId: r.id, turnId: turn.id, intentId: id, status: 'queued' } });
      } catch (e) { if (!(e instanceof AppError)) throw e; results.push({ index, status: 'not_run', reason: code(e) }); }
      turn.proposalsStatus = results.some(r => r.status === 'not_run') ? 'not_run' : 'applied';
    }
  }
  pump(clock: number): boolean {
    if (!this.enabled) return false;
    for (const i of this.store.read().resident?.topicIntents ?? []) {
      if (i.status !== 'queued') continue;
      validateTopicIntents(this.store.read());
      const old = this.store.readCommand<string>(i.id, command(i));
      if (old.found) { this.finish(i.id, old.result, null); return true; }
      const s = this.store.read(), r = s.resident!.rooms.find(r => r.id === i.roomId);
      let denied: string | null = null;
      try {
        if (!r || !r.desiredOn || !r.autoTopic) denied = 'auto_topic_not_allowed';
        else if (r.epoch !== i.epoch || topicPolicy(s, r) !== i.policyDigest) denied = 'auto_topic_scope_changed';
        else denied = budgetReason(r, clock);
        if (!denied && r) for (const pid of i.input.participantIds) { const p = s.participants.find(p => p.id === pid); const wait = p && participantWait(s, r, p, clock); if (wait) { denied = wait; break; } }
        if (!denied && r && basis(s, r, i.input.participantIds) !== i.basisDigest) denied = 'auto_topic_context_changed';
      } catch (e) { if (!(e instanceof AppError)) throw e; denied = code(e); }
      if (denied) { this.finish(i.id, null, denied); continue; }
      if (!r || r.observedStatus !== 'on' || r.topicLink || r.nextEligibleAt && Date.parse(r.nextEligibleAt) > clock || unresolvedProvider(s) || s.resident!.dispatchLeases.some(l => l.state !== 'released') ||
          s.discussions.some(d => ['running', 'paused', 'blocked'].includes(d.status)) || s.jobs.some(j => ['queued', 'running', 'blocked_approval', 'reconciling'].includes(j.status)) ||
          s.resident!.workItems.some(t => t.roomId === r.id && ['ready', 'claimed', 'running', 'review', 'rework'].includes(t.status)) ||
          s.resident!.workAttempts.some(a => a.roomId === r.id && (['claimed', 'running', 'unconfirmed'].includes(a.status) || !a.reported))) continue;
      try { const did = this.engine.create(i.input, i.id, i.roomId); this.finish(i.id, did, null); return true; }
      catch (e) { if (!(e instanceof AppError)) throw e; if (e.code !== 'root_workflow_busy') this.finish(i.id, null, code(e)); }
    }
    return false;
  }
  private finish(id: string, discussionId: string | null, reason: string | null): void {
    this.store.transact((s, emit) => {
      const i = s.resident!.topicIntents!.find(i => i.id === id)!;
      if (discussionId && !s.discussions.some(d => d.id === discussionId && d.roomId === i.roomId)) throw new AppError('topic_receipt_missing', 503);
      i.discussionId = discussionId; i.reason = reason; i.status = discussionId ? 'linked' : 'rejected';
      const result = s.resident!.turns.find(t => t.id === i.turnId)?.proposalResults?.find(p => p.index === i.index);
      if (result && reason) { result.status = 'not_run'; result.reason = reason; s.resident!.turns.find(t => t.id === i.turnId)!.proposalsStatus = 'not_run'; }
      emit({ type: 'resident.topic_intent', discussionId: null, data: { roomId: i.roomId, intentId: id, status: i.status, discussionId, reason } });
    });
  }
}
