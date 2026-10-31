import type { Providers } from '../connections/providers.js';
import { fetchSource } from '../connections/sources.js';
import type { Store } from './store.js';
import type { Checkpoint, Discussion, DiscussionTurn, Evidence, Phase, Task, WorkspaceState } from './model.js';
import { AppError, code, digest, id, integer, now, object, string, strings } from './util.js';
import { parseReply, promptFor } from './prompts.js';
import { reasoningEffort, modelEffort, oauthKind } from './settings.js';
import type { LocalMaterials } from './materials.js';
import { DispatchCoordinator, budgetReason } from './dispatch.js';
import { contextWiki, visibleRoomMessages } from './wiki-policy.js';

interface Executor { submit(input: { bindingId: string; prompt: string; requestId: string; discussionId: string; taskId: string; revision: number; maxDurationMs?: number }): string; kick?(): void }
export class DiscussionEngine {
  private active = false;
  private pendingKick = false;
  private stopping = false;
  private abort: AbortController | null = null;
  executor: Executor | null = null;
  materials: LocalMaterials | null = null;
  constructor(private readonly store: Store, private readonly providers: Pick<Providers, 'complete'>,
    private readonly options: { sourceFetch: boolean; turnTimeoutMs: number }, private readonly sourceReader = fetchSource,
    readonly dispatch = new DispatchCoordinator()) {}

  recover(): void {
    this.store.transact((state, emit) => {
      for (const d of state.discussions) {
        for (const job of state.jobs.filter(j => j.discussionId === d.id && j.taskId)) {
          const task = d.tasks.find(t => t.id === job.taskId); if (task && !task.jobId) { task.jobId = job.id; if (task.status === 'pending') task.status = 'running'; }
        }
        d.used.toolJobs = Math.max(d.used.toolJobs, state.jobs.filter(j => j.discussionId === d.id && j.taskId).length);
        let interrupted = false;
        for (const turn of d.turns) if (['prepared', 'running'].includes(turn.status)) {
          turn.status = 'unconfirmed'; turn.error = 'restart_requires_reconciliation'; interrupted = true;
          const task = d.tasks.find(t => t.id === turn.taskId); if (task) { task.status = 'unconfirmed'; task.reason = turn.error; }
        }
        if (interrupted) { d.status = 'blocked'; d.reason = 'restart_requires_reconciliation'; emit({ type: 'discussion.blocked', discussionId: d.id, data: { reason: d.reason } }); }
      }
    });
    this.kick();
  }
  create(input: unknown, requestId: string, roomId?: string): string {
    const body = object(input); const participantIds = [...new Set(strings(body.participantIds, 8))];
    if (participantIds.length < 2) throw new AppError('two_participants_required');
    const n = participantIds.length; const limits = body.limits ? object(body.limits) : {};
    const result = this.store.transact((state, emit) => {
      if (state.discussions.some(d => ['running', 'paused', 'blocked'].includes(d.status)) || unresolved(state) ||
          state.resident?.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status)) ||
          state.jobs.some(j => j.discussionId && ['running', 'blocked_approval', 'reconciling'].includes(j.status))) throw new AppError('root_workflow_busy', 409);
      const members = participantIds.map(pid => {
        const member = state.participants.find(p => p.id === pid); if (!member) throw new AppError('participant_not_found', 404);
        if (member.kind !== 'fake') {
          const c = state.connections.find(x => x.id === member.connectionId && x.kind === member.kind);
          if (!c || c.status !== 'connected') throw new AppError('participant_not_ready', 409);
        }
        return structuredClone(member);
      });
      const packageIds = [...new Set(strings(body.materialPackageIds ?? [], 8))];
      const packages = packageIds.map(pid => {
        const pack = state.materialPackages?.find(p => p.id === pid);
        if (!pack) throw new AppError('material_package_not_found', 404); return pack;
      });
      if (packages.length) {
        if (!this.materials) throw new AppError('materials_not_configured', 409);
        this.materials.verify(packages);
      }
      const d: Discussion = { id: id('discussion'), topic: string(body.topic, 5000), materials: string(body.materials ?? '', 20_000, true),
        criteria: string(body.criteria ?? '결론, 근거, 실현 가능성, 불확실성', 2000), revision: 1, members, excludedIds: [],
        contexts: members.map(p => ({ participantId: p.id, generation: 1, checkpointId: null, history: [], observation: {
          connection: p.kind === 'fake' ? 'fixture' : 'ready', response: 'waiting', tool: 'not_applicable', work: 'pending',
          observedAt: now(), lastProgressAt: null, source: p.kind, reason: null } })),
        phase: 'independent', round: 1, status: 'running', reason: null, createdAt: now(), updatedAt: now(),
        limits: { maxRequests: integer(limits.maxRequests, 7 * n, 3 * n, 200), maxActiveMs: integer(limits.maxActiveMs, 3_600_000, 5000, 7_200_000),
          maxRounds: integer(limits.maxRounds, 2, 1, 8), maxVerificationTasks: integer(limits.maxVerificationTasks, n, 0, 16),
          maxTokens: integer(limits.maxTokens, 100_000, 1000, 1_000_000), maxToolJobs: integer(limits.maxToolJobs, 2, 0, 8) },
        used: { requests: 0, activeMs: 0, inputTokens: 0, outputTokens: 0, unknownUsage: 0, toolJobs: 0 },
        tasks: [], turns: [], claims: [], evidence: [], checkpoints: [], interventions: [],
        executionBindingId: body.executionBindingId ? string(body.executionBindingId) : null, materialPackageIds: packageIds };
      if (d.executionBindingId && !state.bindings.some(b => b.id === d.executionBindingId && b.status === 'ready')) throw new AppError('execution_binding_not_ready', 409);
      if (d.materials) d.evidence.push({ id: id('evidence'), revision: 1, claimIds: [], participantId: null, taskId: null,
        kind: 'user_material', source: '사용자 제공 자료', text: d.materials, observedAt: now(), digest: digest(d.materials), status: 'reported', reason: null });
      for (const pack of packages) for (const file of pack.files) {
        const { text, identity: _identity, ...metadata } = file;
        d.evidence.push({ id: id('evidence'), revision: 1, claimIds: [], participantId: null, taskId: null,
          kind: 'user_material', source: file.path, text, digest: file.digest, observedAt: file.observedAt,
          status: 'observed', reason: 'local_snapshot_not_claim_verification', material: { ...metadata, packageId: pack.id } });
      }
      d.tasks = members.map(p => taskFor(d, p.id, 'independent', 1));
      if (d.tasks.some(t => promptFor(d, t).length > 180_000)) throw new AppError('material_context_budget_exceeded', 413);
      if (roomId) {
        const room = state.resident?.rooms.find(r => r.id === roomId);
        if (!room || !room.desiredOn || room.topicLink || budgetReason(room)) throw new AppError('room_focus_not_ready', 409);
        const publicText = visibleRoomMessages(state, room, participantIds).map(m => ({ id: m.id, authorId: m.authorId, text: m.text }));
        d.wikiCitations = contextWiki(state, room, participantIds);
        const material = JSON.stringify({ roomPublicMessages: publicText, wiki: d.wikiCitations });
        d.roomMaterial = { text: material, digest: digest(material) };
        if (d.tasks.some(t => promptFor(d, t).length > 180_000)) throw new AppError('focus_material_requires_selection', 409);
        d.roomId = roomId; room.topicLink = d.id; room.epoch++; room.version++; room.updatedAt = now();
        emit({ type: 'resident.focus_changed', discussionId: null, data: { roomId, discussionId: d.id } });
      }
      state.discussions.push(d);
      emit({ type: 'discussion.created', discussionId: d.id, data: { participantIds, revision: d.revision } }); return d.id;
    }, { id: requestId, input: { action: 'create', body, ...(roomId ? { roomId } : {}) } });
    this.kick(); return result;
  }
  control(discussionId: string, input: unknown, requestId: string): void {
    const body = object(input); const action = string(body.action);
    this.store.transact((state, emit) => {
      const d = findDiscussion(state, discussionId);
      if (body.expectedRevision !== d.revision) throw new AppError('revision_conflict', 409);
      const hasUnconfirmed = d.turns.some(t => t.status === 'unconfirmed');
      if (action === 'pause') { if (d.status !== 'running') throw new AppError('not_running', 409); d.status = 'paused'; }
      else if (action === 'cancel') {
        d.status = 'cancelled'; d.reason = 'user_cancelled';
        for (const task of d.tasks) if (task.status === 'pending') task.status = 'cancelled';
        for (const job of state.jobs) if (job.discussionId === d.id && job.status === 'queued') { job.status = 'interrupted'; job.finishedAt = now(); }
      } else if (action === 'resume') {
        if (!['paused', 'blocked'].includes(d.status) || hasUnconfirmed) throw new AppError('reconciliation_required', 409);
        if (state.discussions.some(x => x.id !== d.id && ['running', 'paused', 'blocked'].includes(x.status))) throw new AppError('root_workflow_busy', 409);
        for (const task of d.tasks) if (task.status === 'failed' && task.reason !== 'format_invalid' && task.revision === d.revision) { task.status = 'pending'; task.reason = null; }
        d.status = 'running'; d.reason = null;
      } else if (action === 'configure_participant') {
        if (!['paused', 'blocked'].includes(d.status) || d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status))) throw new AppError('participant_settings_require_pause', 409);
        const member = d.members.find(p => p.id === body.participantId);
        if (!member || !oauthKind(member.kind)) throw new AppError('reasoning_requires_oauth', 409);
        const c = state.connections.find(c => c.id === member.connectionId); if (!c) throw new AppError('connection_not_found', 404);
        member.reasoningEffort = modelEffort(c, member.modelId, body.reasoningEffort);
      } else if (action === 'revise') {
        if (['completed', 'partial', 'cancelled'].includes(d.status)) throw new AppError('discussion_finished', 409);
        d.revision++; d.interventions.push({ revision: d.revision, text: string(body.text, 5000), createdAt: now() });
        for (const job of state.jobs) if (job.discussionId === d.id && job.status === 'queued') { job.status = 'interrupted'; job.finishedAt = now(); }
        for (const task of d.tasks) if (task.status === 'pending') task.status = 'cancelled';
        d.phase = 'independent'; d.round = 1;
        d.tasks.push(...activeMembers(d).map(p => taskFor(d, p.id, 'independent', 1)));
        d.status = hasUnconfirmed ? 'blocked' : d.status === 'paused' ? 'paused' : 'running';
      } else if (action === 'exclude') {
        const pid = string(body.participantId);
        if (!d.members.some(p => p.id === pid) || d.excludedIds.includes(pid)) throw new AppError('participant_not_found', 404);
        if (d.turns.some(t => t.participantId === pid && ['prepared', 'running', 'unconfirmed'].includes(t.status))) throw new AppError('reconciliation_required', 409);
        d.excludedIds.push(pid); d.reason = 'participant_excluded';
        for (const task of d.tasks) if (task.participantId === pid && ['pending', 'failed'].includes(task.status)) task.status = 'cancelled';
        d.status = hasUnconfirmed ? 'blocked' : 'running';
      } else if (action === 'reconcile') {
        const turn = d.turns.find(t => t.id === body.turnId && t.status === 'unconfirmed');
        if (!turn) throw new AppError('unconfirmed_turn_not_found', 404);
        const task = d.tasks.find(t => t.id === turn.taskId)!; const resolution = string(body.resolution);
        if (resolution === 'completed') {
          const text = string(body.text, 100_000);
          turn.text = text; turn.receipt = `owner-confirmed:${string(body.receipt, 2000)}`;
          turn.finishedAt = now(); turn.error = 'owner_confirmed_result';
          if (turn.revision !== d.revision || turn.generation !== d.contexts.find(c => c.participantId === turn.participantId)!.generation) { turn.status = 'stale'; task.status = 'cancelled'; }
          else { turn.status = 'completed'; turn.reply = parseReply(text, d, task); if (!turn.reply) throw new AppError('format_invalid'); task.status = task.jobId && !d.evidence.some(e => e.taskId === task.id && e.kind === 'execution') ? 'running' : 'completed'; this.applyReply(d, turn); }
        } else if (resolution === 'not_sent' || resolution === 'skip') {
          turn.status = 'failed'; turn.error = `owner_confirmed_${resolution}`; turn.finishedAt = now();
          task.status = resolution === 'not_sent' && task.revision === d.revision && d.status !== 'cancelled' ? 'pending' : 'cancelled';
          task.reason = turn.error;
        } else throw new AppError('invalid_resolution');
        this.dispatch.settle(state, turn.id, turn.usage, turn.error, false);
        // Reconciliation records evidence. Resume remains an explicit, idempotent action.
      } else if (action === 'handoff') {
        const pid = string(body.participantId); const context = d.contexts.find(c => c.participantId === pid);
        const member = d.members.find(p => p.id === pid);
        if (!context || !member) throw new AppError('participant_not_found', 404);
        if (body.expectedGeneration !== context.generation) throw new AppError('generation_conflict', 409);
        if (member.kind === 'browser') throw new AppError('existing_browser_context_preserved', 409);
        if (d.turns.some(t => t.participantId === pid && ['prepared', 'running', 'unconfirmed'].includes(t.status))) throw new AppError('reconciliation_required', 409);
        const checkpoint = this.checkpoint(d, pid, 'owner_handoff');
        context.generation++; context.checkpointId = checkpoint.id;
        context.history = [{ role: 'user', content: checkpoint.text }]; checkpoint.applied = true;
      } else throw new AppError('unknown_control');
      d.updatedAt = now(); emit({ type: `discussion.${action}`, discussionId: d.id, data: { revision: d.revision } });
      return null;
    }, { id: requestId, input: { discussionId, body } });
    this.executor?.kick?.(); this.kick();
  }
  private checkpoint(d: Discussion, pid: string, reason: string): Checkpoint {
    const context = d.contexts.find(c => c.participantId === pid)!;
    const draftBarrier = d.phase === 'independent';
    const turns = d.turns.filter(t => t.status === 'completed' && (!draftBarrier || t.participantId === pid));
    const evidence = d.evidence.filter(e => e.kind === 'user_material' || !draftBarrier || e.participantId === pid);
    // Deterministic reference package, no extra model call and no fabricated summary.
    const text = JSON.stringify({ topic: d.topic, criteria: d.criteria, conditions: d.interventions, revision: d.revision,
      originalRecords: 'All full originals remain in the durable workspace. Excerpts are not complete source documents.',
      priorReplies: turns.map(t => { const original = t.reply?.text ?? t.text; return { id: t.id, revision: t.revision, participantId: t.participantId,
        text: original.slice(0, 1500), truncated: original.length > 1500, originalDigest: digest(t.text), reviews: t.reply?.reviews ?? [], uncertainty: t.reply?.uncertainty ?? [] }; }),
      claims: d.claims.filter(c => turns.some(t => t.id === c.turnId)),
      evidence: evidence.map(e => ({ id: e.id, source: e.source, status: e.status, text: e.text.slice(0, 1000), truncated: e.text.length > 1000, originalDigest: e.digest })),
      pendingTasks: d.tasks.filter(t => ['pending', 'running', 'unconfirmed'].includes(t.status)), used: d.used, limits: d.limits });
    if (text.length > 80_000) throw new AppError('checkpoint_requires_selection', 409);
    const cp: Checkpoint = { id: id('checkpoint'), participantId: pid, revision: d.revision, generation: context.generation,
      basisCursor: this.store.cursor(), createdAt: now(), reason, text, turnIds: turns.map(t => t.id), evidenceIds: evidence.map(e => e.id),
      pendingTaskIds: d.tasks.filter(t => ['pending', 'running'].includes(t.status)).map(t => t.id),
      unresolvedTurnIds: d.turns.filter(t => ['prepared', 'running', 'unconfirmed'].includes(t.status)).map(t => t.id), requestsUsed: d.used.requests, applied: false };
    d.checkpoints.push(cp); return cp;
  }
  kick(): void {
    if (this.stopping) return;
    if (this.active) { this.pendingKick = true; return; }
    this.active = true;
    queueMicrotask(() => { void this.loop().catch(() => {
      this.store.transact((state, emit) => { for (const d of state.discussions) if (d.status === 'running') {
        d.status = 'blocked'; d.reason = 'engine_requires_review'; emit({ type: 'discussion.blocked', discussionId: d.id, data: { reason: d.reason } });
      } });
    }).finally(() => { this.active = false; if (this.pendingKick) { this.pendingKick = false; this.kick(); } }); });
  }
  private async loop(): Promise<void> {
    while (!this.stopping) {
      const state = this.store.read(); const d = state.discussions.find(x => x.status === 'running');
      if (!d || unresolved(state)) return;
      const members = activeMembers(d);
      if (!members.length) { this.finish(d.id, 'partial', 'all_participants_unavailable'); continue; }
      if (d.used.activeMs >= d.limits.maxActiveMs || d.used.inputTokens + d.used.outputTokens >= d.limits.maxTokens || d.used.requests >= d.limits.maxRequests) {
        this.finish(d.id, 'partial', 'budget_exhausted'); continue;
      }
      if (!['synthesis', 'summary_review'].includes(d.phase) && d.used.requests >= d.limits.maxRequests - members.length) {
        this.store.transact((s, emit) => { const current = findDiscussion(s, d.id);
          for (const task of current.tasks) if (task.status === 'pending') task.status = 'cancelled';
          current.reason = 'budget_exhausted'; this.schedule(current, 'synthesis', 1);
          emit({ type: 'discussion.phase', discussionId: d.id, data: { phase: 'synthesis', reason: 'budget_exhausted' } }); }); continue;
      }
      const waiting = d.tasks.find(t => t.revision === d.revision && t.status === 'running' && t.jobId);
      if (waiting) {
        const job = state.jobs.find(j => j.id === waiting.jobId);
        if (!job || ['queued', 'running', 'blocked_approval', 'reconciling'].includes(job.status)) return;
        this.store.transact((s, emit) => { const current = findDiscussion(s, d.id); const task = current.tasks.find(t => t.id === waiting.id)!;
          task.status = 'pending';
          if (job.finishedAt) current.used.activeMs += Math.max(0, Date.parse(job.finishedAt) - Date.parse(job.createdAt));
          const context = current.contexts.find(c => c.participantId === task.participantId)!; context.observation.tool = job.status;
          current.evidence.push({ id: id('evidence'), revision: task.revision, claimIds: task.claimIds, participantId: task.participantId, taskId: task.id,
            kind: 'execution', source: `codex:${job.id}`, text: JSON.stringify({ status: job.status, text: job.text, activities: job.activities }),
            observedAt: now(), digest: digest(JSON.stringify(job.activities)), status: job.status === 'completed' ? 'observed' : 'failed', reason: job.error });
          emit({ type: 'evidence.added', discussionId: d.id, data: { taskId: task.id, jobId: job.id } }); }); continue;
      }
      const task = d.tasks.find(t => t.revision === d.revision && t.status === 'pending' && !d.excludedIds.includes(t.participantId)
        && t.dependencyIds.every(dep => d.tasks.some(x => x.id === dep && x.status === 'completed')));
      if (!task) {
        if (d.tasks.some(t => t.revision === d.revision && t.status === 'pending')) { this.finish(d.id, 'partial', 'dependency_blocked'); continue; }
        this.advance(d.id); continue;
      }
      if (task.phase === 'verification' && !d.evidence.some(e => e.taskId === task.id)) {
        const delegated = task.method === 'codex' && !task.jobId && d.executionBindingId && d.members.some(p => p.id === task.participantId && p.kind === 'browser')
          && state.grants.some(g => !g.revoked && g.discussionId === d.id && g.participantId === task.participantId && g.tools.includes('codex_send'));
        if (delegated) { if (!await this.turn(d.id, task.id)) return; continue; }
        if (task.method === 'codex' && !task.jobId && d.executionBindingId && this.executor && d.used.toolJobs < d.limits.maxToolJobs) {
          this.store.transact(s => this.dispatch.reserveTool(s, d.id, task.id));
          const jobId = this.executor.submit({ bindingId: d.executionBindingId, requestId: task.id, discussionId: d.id, taskId: task.id, revision: d.revision, maxDurationMs: Math.max(1, d.limits.maxActiveMs - d.used.activeMs),
            prompt: `토론 검증 과제입니다. 등록된 작업 공간과 기존 권한 안에서 수행하고 실제 입력·검사·출력·실패·미실행 항목을 기록하세요.\n주제: ${d.topic}\n조건: ${d.criteria}\n검증할 것: ${task.question}\n관련 주장: ${JSON.stringify(d.claims.filter(c => task.claimIds.includes(c.id)))}` });
          this.store.transact((s, emit) => { const current = findDiscussion(s, d.id); const currentTask = current.tasks.find(t => t.id === task.id)!;
            currentTask.jobId = jobId; currentTask.status = 'running'; current.used.toolJobs++;
            current.contexts.find(c => c.participantId === task.participantId)!.observation.tool = 'queued';
            emit({ type: 'verification.execution_queued', discussionId: d.id, data: { taskId: task.id, jobId } }); });
          return;
        }
        await this.verify(d.id, task.id); if (this.stopping) return;
      }
      if (!await this.turn(d.id, task.id)) return;
    }
  }
  private async verify(discussionId: string, taskId: string): Promise<void> {
    const d = findDiscussion(this.store.read(), discussionId); const task = d.tasks.find(t => t.id === taskId)!;
    let evidence: Evidence = { id: id('evidence'), revision: task.revision, claimIds: task.claimIds, participantId: task.participantId, taskId,
      kind: task.method === 'source' ? 'source' : 'provider_report', source: task.url || task.method || 'review', text: '', observedAt: now(), digest: '', status: 'not_run', reason: 'capability_unavailable' };
    const started = Date.now();
    if (task.method === 'source' && this.options.sourceFetch) {
      try { const source = await this.sourceReader(task.url, AbortSignal.timeout(20_000)); evidence = { ...evidence, ...source, status: 'observed', reason: null }; }
      catch (error) { evidence.reason = code(error); evidence.status = 'failed'; }
    } else if (task.method === 'review') evidence.reason = 'reasoning_is_not_independent_verification';
    this.store.transact((s, emit) => { const current = findDiscussion(s, discussionId); current.evidence.push(evidence); current.used.activeMs += Date.now() - started;
      emit({ type: 'evidence.added', discussionId, data: { evidenceId: evidence.id, taskId, status: evidence.status } }); });
  }
  private async turn(discussionId: string, taskId: string): Promise<boolean> {
    const captured = this.store.transact((state, emit) => {
      const d = findDiscussion(state, discussionId); const task = d.tasks.find(t => t.id === taskId)!;
      if (d.status !== 'running' || task.revision !== d.revision || task.status !== 'pending') return null;
      const context = d.contexts.find(c => c.participantId === task.participantId)!; const participant = d.members.find(p => p.id === task.participantId)!;
      let prompt = promptFor(d, task);
      if (task.method === 'codex' && !task.jobId && participant.kind === 'browser' && state.grants.some(g => !g.revoked && g.discussionId === d.id && g.participantId === participant.id && g.tools.includes('codex_send'))) {
        prompt += `\n\n이 과제의 MCP codex_send 권한이 있습니다. taskId=${task.id}. 검증할 내용을 구체적인 프롬프트로 작성해 codex_send({taskId,prompt})로 한 번 제출하세요. 접수 결과는 실행 완료가 아닙니다. 결과는 Core가 실제 완료 후 다시 전달합니다. 도구가 없거나 실패하면 실행하지 못했다고 명시하세요.`;
      }
      if (prompt.length + context.history.reduce((n, h) => n + h.content.length, 0) > 180_000) {
        d.status = 'blocked'; d.reason = 'context_limit_requires_handoff';
        emit({ type: 'discussion.blocked', discussionId, data: { reason: d.reason } }); return null;
      }
      const turn: DiscussionTurn = { id: id('turn'), taskId, participantId: participant.id, revision: d.revision, generation: context.generation,
        phase: task.phase, round: task.round, status: 'prepared', prompt, promptDigest: digest(prompt), text: '', reply: null,
        startedAt: now(), finishedAt: null, receipt: null, error: null, usage: null, ...(d.wikiCitations ? { wikiCitations: structuredClone(d.wikiCitations) } : {}),
        ...(oauthKind(participant.kind) ? { reasoningEffort: reasoningEffort(participant.reasoningEffort) } : {}),
        evidenceIds: d.evidence.filter(e => e.revision === d.revision && (task.phase !== 'independent' || e.kind === 'user_material')).map(e => e.id) };
      const denied = this.dispatch.reserve(state, { requestId: turn.id, kind: 'topic', participantId: participant.id, generation: turn.generation, roomId: d.roomId ?? null });
      if (denied) {
        if (denied === 'budget_exhausted' || denied === 'room_settings_required') {
          d.status = 'partial'; d.reason = 'room_' + denied;
          emit({ type: 'discussion.phase', discussionId, data: { phase: d.phase, status: d.status, reason: d.reason } });
        }
        return null;
      }
      d.used.requests++; task.status = 'running'; task.turnId = turn.id; d.turns.push(turn); d.updatedAt = now();
      context.observation = { ...context.observation, response: 'prepared', work: 'running', observedAt: now(), reason: null };
      emit({ type: 'turn.prepared', discussionId, data: { turnId: turn.id, participantId: participant.id, phase: task.phase } });
      const room = state.resident?.rooms.find(r => r.id === d.roomId);
      return { turn, participant, history: structuredClone(context.history), remaining: Math.min(d.limits.maxActiveMs - d.used.activeMs, room?.budgets ? Date.parse(room.budgets.deadlineAt) - Date.now() : Infinity) };
    });
    if (!captured) return false;
    const start = Date.now(); this.abort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(Math.max(1, Math.min(this.options.turnTimeoutMs, captured.remaining)))]);
    const update = (action: (turn: DiscussionTurn) => void, type: string, data: unknown) => this.store.transact((state, emit) => {
      const d = findDiscussion(state, discussionId); const turn = d.turns.find(t => t.id === captured.turn.id)!; action(turn);
      const context = d.contexts.find(c => c.participantId === turn.participantId)!;
      if (context.generation === turn.generation) { context.observation.observedAt = now(); context.observation.lastProgressAt = now(); context.observation.response = turn.status; }
      emit({ type, discussionId, data });
    });
    const { result, failure, uncertain } = await this.dispatch.perform(this.store, this.providers, { requestId: captured.turn.id, participant: captured.participant, prompt: captured.turn.prompt, history: captured.history, signal,
        hooks: { dispatched: () => { update(t => { t.status = 'running'; }, 'turn.dispatched', { turnId: captured.turn.id }); },
          receipt: receipt => update(t => { t.receipt = receipt; }, 'turn.receipt', { turnId: captured.turn.id }),
          delta: delta => update(t => { if (t.text.length + delta.length > 100_000) throw new AppError('response_too_large', 502, true); t.text += delta; },
            'turn.delta', { turnId: captured.turn.id, delta }) } });
    this.abort = null;
    this.store.transact((state, emit) => {
      const d = findDiscussion(state, discussionId); const task = d.tasks.find(t => t.id === taskId)!;
      const turn = d.turns.find(t => t.id === captured.turn.id)!; const context = d.contexts.find(c => c.participantId === turn.participantId)!;
      d.used.activeMs += Date.now() - start; turn.finishedAt = now(); d.updatedAt = now();
      if (result) {
        turn.text = result.text; turn.receipt = result.receipt; turn.usage = result.usage;
        if (result.usage) { d.used.inputTokens += result.usage.input; d.used.outputTokens += result.usage.output; } else d.used.unknownUsage++;
        if (turn.revision !== d.revision || turn.generation !== context.generation || d.status === 'cancelled') { turn.status = 'stale'; task.status = 'cancelled'; }
        else {
          turn.status = 'completed'; task.status = 'completed'; turn.reply = parseReply(turn.text, d, task);
          if (task.jobId && !d.evidence.some(e => e.taskId === task.id && e.kind === 'execution')) task.status = 'running';
          else if (task.method === 'codex' && !d.evidence.some(e => e.taskId === task.id)) d.evidence.push({ id: id('evidence'), revision: d.revision,
            claimIds: task.claimIds, participantId: task.participantId, taskId, kind: 'execution', source: 'codex', text: '', digest: digest(''), observedAt: now(), status: 'not_run', reason: 'participant_did_not_submit_execution' });
          this.applyReply(d, turn);
          if (!turn.reply) {
            turn.error = 'format_invalid';
            if (task.reason !== 'format_retry' && d.used.requests < d.limits.maxRequests - activeMembers(d).length) {
              const repair = taskFor(d, task.participantId, task.phase, task.round); repair.claimIds = task.claimIds; repair.reason = 'format_retry';
              repair.question = task.question; d.tasks.push(repair);
            } else d.reason = 'partial_unstructured_reply';
          }
        }
      } else {
        turn.status = uncertain ? 'unconfirmed' : 'failed'; turn.error = code(failure); task.status = uncertain ? 'unconfirmed' : 'failed'; task.reason = turn.error;
        if (d.status !== 'cancelled') { d.status = 'blocked'; d.reason = turn.error; }
      }
      if (context.generation === turn.generation) context.observation = { ...context.observation, response: turn.status, work: d.status, observedAt: now(), reason: turn.error };
      this.dispatch.settle(state, turn.id, turn.usage, turn.error, turn.status === 'unconfirmed');
      emit({ type: 'turn.finished', discussionId, data: { turnId: turn.id, status: turn.status, error: turn.error } });
    });
    return true;
  }
  private applyReply(d: Discussion, turn: DiscussionTurn): void {
    const context = d.contexts.find(c => c.participantId === turn.participantId)!;
    context.history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: turn.text });
    if (turn.reply && turn.phase === 'independent') for (const claim of turn.reply.claims) d.claims.push({ id: id('claim'), participantId: turn.participantId, turnId: turn.id, revision: turn.revision, ...claim });
  }
  private advance(discussionId: string): void {
    this.store.transact((state, emit) => {
      const d = findDiscussion(state, discussionId); const members = activeMembers(d);
      if (d.phase === 'independent') this.schedule(d, 'cross_review', 1);
      else if (d.phase === 'cross_review' && d.round < d.limits.maxRounds && d.used.requests + members.length < d.limits.maxRequests - members.length * 2) this.schedule(d, 'cross_review', d.round + 1);
      else if (d.phase === 'cross_review') {
        d.phase = 'verification'; d.round = 1;
        const reviews = d.turns.filter(t => t.revision === d.revision && t.reply).flatMap(t => t.reply!.reviews);
        const score = (claimId: string) => reviews.filter(r => r.claimId === claimId && r.stance !== 'support').length;
        const proposals = d.turns.filter(t => t.revision === d.revision && t.phase === 'cross_review' && t.reply).flatMap(t => t.reply!.verifications.map(v => ({ ...v, participantId: t.participantId }))).sort((a, b) => score(b.claimId) - score(a.claimId));
        const seen = new Set<string>(); let count = 0;
        for (const p of proposals) {
          const key = `${p.claimId}|${p.method}|${p.url}|${p.question}`;
          if (seen.has(key) || count >= d.limits.maxVerificationTasks) continue;
          seen.add(key); count++;
          const task = taskFor(d, p.participantId, 'verification', 1); task.claimIds = [p.claimId]; task.method = p.method; task.url = p.url; task.question = p.question;
          task.dependencyIds = d.tasks.filter(t => t.revision === d.revision && t.phase === 'cross_review' && t.status === 'completed').map(t => t.id);
          d.tasks.push(task);
        }
      } else if (d.phase === 'verification') this.schedule(d, 'revision', 1);
      else if (d.phase === 'revision') this.schedule(d, 'synthesis', 1);
      else if (d.phase === 'synthesis') this.schedule(d, 'summary_review', 1);
      else {
        d.status = d.excludedIds.length || d.reason ? 'partial' : 'completed'; d.reason ??= 'procedure_completed';
        for (const context of d.contexts) context.observation.work = d.status;
        for (const member of members) {
          try { this.checkpoint(d, member.id, 'discussion_finished'); } catch { /* original durable records are retained even if package is too large */ }
        }
      }
      d.updatedAt = now(); emit({ type: 'discussion.phase', discussionId, data: { phase: d.phase, round: d.round, status: d.status, reason: d.reason } });
    });
  }
  private schedule(d: Discussion, phase: Phase, round: number): void {
    const dependencies = d.tasks.filter(t => t.revision === d.revision && t.phase === d.phase && t.status === 'completed').map(t => t.id);
    d.phase = phase; d.round = round;
    const members = activeMembers(d); const selected = phase === 'synthesis' ? members.slice(0, 1) : phase === 'summary_review' ? members.slice(1) : members;
    for (const member of selected) {
      const task = taskFor(d, member.id, phase, round);
      task.dependencyIds = dependencies;
      if (phase === 'cross_review') {
        task.claimIds = d.claims.filter(c => c.revision === d.revision && c.participantId !== member.id && members.some(m => m.id === c.participantId)).map(c => c.id);
      }
      d.tasks.push(task);
    }
  }
  private finish(discussionId: string, status: 'completed' | 'partial', reason: string): void {
    this.store.transact((s, emit) => { const d = findDiscussion(s, discussionId); d.status = status; d.reason = reason;
      for (const context of d.contexts) context.observation.work = status;
      for (const task of d.tasks) if (task.status === 'pending') task.status = 'cancelled';
      emit({ type: 'discussion.finished', discussionId, data: { status, reason } }); });
  }
  async close(): Promise<void> {
    this.stopping = true; this.abort?.abort();
    while (this.active) await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function activeMembers(d: Discussion) { return d.members.filter(p => !d.excludedIds.includes(p.id)); }
export function findDiscussion(s: WorkspaceState, discussionId: string): Discussion { const d = s.discussions.find(x => x.id === discussionId); if (!d) throw new AppError('discussion_not_found', 404); return d; }
function unresolved(s: WorkspaceState): boolean { return s.discussions.some(d => d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status))); }
function taskFor(d: Discussion, participantId: string, phase: Phase, round: number): Task { return { id: id('task'), phase, round, revision: d.revision, participantId, status: 'pending', dependencyIds: [], claimIds: [], method: null, url: '', question: '', reason: null, turnId: null, jobId: null }; }
