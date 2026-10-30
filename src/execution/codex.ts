import { realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RpcProcess } from '../connections/rpc.js';
import type { RpcId } from '../connections/rpc.js';
import type { Store } from '../workspace/store.js';
import type { CodexJob, ExecutionBinding, WorkspaceState } from '../workspace/model.js';
import { AppError, code, digest, id, integer, now, object, string } from '../workspace/util.js';
const execute = promisify(execFile);
const ACTIVE = ['running', 'blocked_approval', 'reconciling'];

export class CodexExecutor {
  private readonly processes = new Map<string, RpcProcess>();
  private readonly connecting = new Map<string, Promise<RpcProcess>>();
  private readonly starting = new Set<string>();
  private closed = false;
  private readonly watchdog: NodeJS.Timeout;
  onProgress: () => void = () => {};
  beforeDispatch: ((state: WorkspaceState, job: CodexJob) => void) | null = null;
  constructor(private readonly store: Store, private readonly command: string[], private readonly roots: string[], private readonly protectedPaths: string[] = []) {
    this.watchdog = setInterval(() => this.expire(), 1000); this.watchdog.unref();
  }
  recover(): void {
    this.store.transact((state, emit) => { for (const job of state.jobs) if (['running', 'blocked_approval'].includes(job.status)) {
      job.status = 'reconciling'; job.error = 'restart_requires_reconciliation';
      emit({ type: 'codex.reconciling', discussionId: job.discussionId, data: { jobId: job.id } });
    } });
    this.kick();
  }
  async register(input: unknown): Promise<string> {
    const body = object(input); const cwd = await realpath(string(body.cwd, 2000));
    const allowed = await Promise.all(this.roots.map(root => realpath(root)));
    if (!allowed.some(root => inside(root, cwd))) throw new AppError('workspace_not_allowed', 403);
    if (this.protectedPaths.some(path => inside(cwd, path) || inside(path, cwd))) throw new AppError('workspace_overlaps_private_state', 403);
    const repository = await gitIdentity(cwd); const allowWrite = body.allowWrite === true;
    if (allowWrite && (!repository.branch || ['main', 'master'].includes(repository.branch))) throw new AppError('feature_branch_required', 409);
    const binding: ExecutionBinding = { id: id('binding'), label: string(body.label, 80), host: hostname(), user: userInfo().username,
      cwd, threadId: string(body.threadId, 200), allowWrite, status: 'unverified', ...repository, sessionTreeId: null };
    if (this.store.read().bindings.some(b => b.threadId === binding.threadId || b.cwd === cwd)) throw new AppError('workspace_already_registered', 409);
    const rpc = await this.connect(binding);
    try {
      const result = object(await rpc.request('thread/read', { threadId: binding.threadId, includeTurns: false }));
      const thread = object(result.thread); await this.validateThread(binding, thread, true);
      binding.sessionTreeId = typeof thread.sessionId === 'string' ? thread.sessionId : null; binding.status = 'ready';
      this.store.transact((state, emit) => { state.bindings.push(binding); emit({ type: 'codex.binding_added', discussionId: null, data: { bindingId: binding.id } }); });
      return binding.id;
    } catch (error) { rpc.close(); this.processes.delete(binding.id); throw error; }
  }
  submit(input: { bindingId: string; prompt: string; requestId: string; discussionId?: string | null; taskId?: string | null; revision?: number | null; maxDurationMs?: number }): string {
    const jobId = this.store.transact((state, emit) => {
      const binding = state.bindings.find(b => b.id === input.bindingId && b.status === 'ready');
      if (!binding) throw new AppError('execution_binding_not_ready', 409);
      if (input.discussionId) {
        const d = state.discussions.find(d => d.id === input.discussionId);
        if (!d || d.revision !== input.revision || d.executionBindingId !== binding.id || !d.tasks.some(t => t.id === input.taskId)) throw new AppError('execution_scope_mismatch', 403);
      }
      const prompt = string(input.prompt, 30_000);
      const job: CodexJob = { id: id('job'), bindingId: binding.id, discussionId: input.discussionId ?? null, taskId: input.taskId ?? null, revision: input.revision ?? null,
        requestId: input.requestId, prompt, promptDigest: digest(prompt), status: 'queued', threadId: binding.threadId, turnId: null,
        createdAt: now(), finishedAt: null, text: '', error: null, activities: [], approvals: [],
        maxDurationMs: integer(input.maxDurationMs, 300_000, 1, 7_200_000), deadlineAt: null };
      state.jobs.push(job); emit({ type: 'codex.queued', discussionId: job.discussionId, data: { jobId: job.id, bindingId: binding.id } }); return job.id;
    }, { id: `codex:${input.requestId}`, input });
    this.kick(); return jobId;
  }
  kick(): void {
    if (this.closed) return;
    const state = this.store.read();
    for (const binding of state.bindings) {
      if (this.starting.has(binding.id) || state.jobs.some(j => j.bindingId === binding.id && ACTIVE.includes(j.status))) continue;
      if ([...this.starting].some(id => state.bindings.find(b => b.id === id)?.repoRoot === binding.repoRoot)) continue;
      const job = state.jobs.find(j => j.bindingId === binding.id && j.status === 'queued' && (!j.discussionId || state.discussions.some(d => d.id === j.discussionId && d.revision === j.revision && d.status === 'running'))); if (!job) continue;
      // Single writer across canonical workspaces, including queued clients.
      if (state.jobs.some(j => ACTIVE.includes(j.status) && state.bindings.find(b => b.id === j.bindingId)?.repoRoot === binding.repoRoot)) continue;
      this.starting.add(binding.id);
      void this.start(binding, job).catch(error => {
        this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!;
          if (['completed', 'failed', 'interrupted'].includes(current.status)) return;
          current.status = current.status === 'queued' ? 'failed' : 'reconciling'; current.error = code(error);
          emit({ type: 'codex.failed', discussionId: current.discussionId, data: { jobId: job.id, status: current.status, code: current.error } }); });
      }).finally(() => { this.starting.delete(binding.id); this.onProgress(); this.kick(); });
    }
  }
  private async start(binding: ExecutionBinding, job: CodexJob): Promise<void> {
    const currentRepo = await gitIdentity(binding.cwd);
    if (currentRepo.repoRoot !== binding.repoRoot || currentRepo.branch !== binding.branch) throw new AppError('workspace_changed', 409);
    const rpc = await this.connect(binding);
    const read = object(await rpc.request('thread/read', { threadId: binding.threadId, includeTurns: false }));
    await this.validateThread(binding, object(read.thread), true);
    const resumed = object(await rpc.request('thread/resume', { threadId: binding.threadId, excludeTurns: true }));
    const thread = object(resumed.thread); await this.validateThread(binding, thread, true);
    this.store.transact((s, emit) => {
      const current = s.jobs.find(j => j.id === job.id)!;
      if (current.status !== 'queued') throw new AppError('job_state_changed', 409);
      if (current.discussionId && !s.discussions.some(d => d.id === current.discussionId && d.revision === current.revision && d.status === 'running')) throw new AppError('discussion_not_running', 409);
      if (s.discussions.some(d => d.id === current.discussionId && d.roomId) && !this.beforeDispatch) throw new AppError('room_dispatch_guard_required', 409);
      this.beforeDispatch?.(s, current);
      current.status = 'running';
      current.deadlineAt = new Date(Date.now() + current.maxDurationMs).toISOString();
      const b = s.bindings.find(b => b.id === binding.id)!; b.sessionTreeId = typeof thread.sessionId === 'string' ? thread.sessionId : null;
      emit({ type: 'codex.dispatching', discussionId: job.discussionId, data: { jobId: job.id } });
    });
    // Contract checked against the installed codex-cli 0.165.0 schema. Read
    // access is broad in this version; bwrap separately hides app credentials.
    const sandboxPolicy = binding.allowWrite
      ? { type: 'workspaceWrite', writableRoots: [binding.cwd], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true }
      : { type: 'readOnly', networkAccess: false };
    const result = object(await rpc.request('turn/start', { threadId: binding.threadId, input: [{ type: 'text', text: job.prompt }],
      cwd: binding.cwd, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandboxPolicy }));
    const turn = object(result.turn); const turnId = string(turn.id, 200);
    this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!;
      if (current.turnId && current.turnId !== turnId) throw new AppError('turn_receipt_mismatch', 409, true);
      current.turnId = turnId; emit({ type: 'codex.receipt', discussionId: job.discussionId, data: { jobId: job.id, turnId } }); });
    if (turn.status !== 'inProgress') this.completeFromTurn(binding.id, turn);
  }
  private async connect(binding: ExecutionBinding): Promise<RpcProcess> {
    const existing = this.processes.get(binding.id); if (existing) return existing;
    const pending = this.connecting.get(binding.id); if (pending) return pending;
    const promise = this.connectOnce(binding); this.connecting.set(binding.id, promise);
    try { return await promise; } finally { this.connecting.delete(binding.id); }
  }
  private async connectOnce(binding: ExecutionBinding): Promise<RpcProcess> {
    // A private PID namespace and procfs prevent reaching masked host paths
    // through another host process’s /proc/<pid>/root or open descriptors.
    const command = this.protectedPaths.length ? ['bwrap', '--die-with-parent', '--new-session', '--unshare-pid', '--bind', '/', '/', '--proc', '/proc', ...this.protectedPaths.flatMap(path => ['--tmpfs', path]), '--', ...this.command] : this.command;
    const rpc = new RpcProcess(command, binding.cwd, false);
    rpc.onNotification = (method, params) => this.notification(binding.id, method, params);
    rpc.onRequest = (requestId, method, params) => this.approval(binding.id, rpc, requestId, method, params);
    rpc.onClose = () => {
      this.processes.delete(binding.id);
      if (this.closed) return;
      this.store.transact((s, emit) => { for (const job of s.jobs) if (job.bindingId === binding.id && ['running', 'blocked_approval'].includes(job.status)) {
        job.status = 'reconciling'; job.error = 'codex_disconnected';
        emit({ type: 'codex.reconciling', discussionId: job.discussionId, data: { jobId: job.id } });
      } }); this.onProgress();
    };
    try { await rpc.request('initialize', { clientInfo: { name: 'webjjoku', title: 'Webjjoku', version: '0.2.0' } });
      rpc.notify('initialized'); this.processes.set(binding.id, rpc); return rpc;
    } catch (error) { rpc.close(); throw error; }
  }
  private async validateThread(binding: ExecutionBinding, thread: Record<string, unknown>, requireIdle: boolean): Promise<void> {
    if (binding.host !== hostname() || binding.user !== userInfo().username || thread.id !== binding.threadId || typeof thread.cwd !== 'string' || await realpath(thread.cwd) !== binding.cwd) throw new AppError('session_target_mismatch', 409);
    const status = object(thread.status).type;
    if (requireIdle && status !== 'idle' && status !== 'notLoaded') throw new AppError('session_busy', 409);
  }
  private notification(bindingId: string, method: string, params: Record<string, unknown>): void {
    const binding = this.store.read().bindings.find(b => b.id === bindingId); if (!binding || params.threadId !== binding.threadId) return;
    if (method === 'turn/started') {
      const turn = object(params.turn);
      this.store.transact((s, emit) => { const job = s.jobs.find(j => j.bindingId === bindingId && j.status === 'running' && !j.turnId);
        if (job) { job.turnId = string(turn.id, 200); emit({ type: 'codex.receipt', discussionId: job.discussionId, data: { jobId: job.id, turnId: job.turnId } }); } });
      return;
    }
    if (method === 'turn/completed') { this.completeFromTurn(bindingId, object(params.turn)); return; }
    if (!['item/agentMessage/delta', 'item/commandExecution/outputDelta', 'item/started', 'item/completed', 'turn/diff/updated', 'serverRequest/resolved'].includes(method)) return;
    this.store.transact((s, emit) => {
      const job = s.jobs.find(j => j.bindingId === bindingId && ACTIVE.includes(j.status) && (j.turnId === params.turnId || method === 'serverRequest/resolved' && j.approvals.some(a => a.id === String(params.requestId)))); if (!job) return;
      if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') job.text = (job.text + params.delta).slice(-100_000);
      if (method === 'item/started' || method === 'item/completed') {
        const item = object(params.item); const type = String(item.type);
        if (['commandExecution', 'fileChange', 'mcpToolCall', 'agentMessage'].includes(type)) {
          const activityId = string(item.id, 200);
          const entry = { id: activityId, type, status: String(item.status ?? (method === 'item/completed' ? 'completed' : 'running')),
            text: JSON.stringify(item).slice(0, 80_000), observedAt: now() };
          const index = job.activities.findIndex(a => a.id === activityId);
          if (index >= 0) job.activities[index] = entry; else job.activities.push(entry);
        }
      }
      if (method === 'item/commandExecution/outputDelta') {
        const activity = job.activities.find(a => a.id === params.itemId);
        if (activity && typeof params.delta === 'string') activity.text = (activity.text + params.delta).slice(-80_000);
      }
      if (method === 'serverRequest/resolved') { for (const a of job.approvals) if (a.rpcId === params.requestId) a.status = 'resolved'; if (!job.approvals.some(a => a.status === 'pending') && job.status === 'blocked_approval') job.status = 'running'; }
      emit({ type: 'codex.activity', discussionId: job.discussionId, data: { jobId: job.id, method } });
    });
    this.onProgress();
  }
  private completeFromTurn(bindingId: string, turn: Record<string, unknown>): void {
    if (!['completed', 'failed', 'interrupted'].includes(String(turn.status))) return;
    this.store.transact((s, emit) => {
      const job = s.jobs.find(j => j.bindingId === bindingId && j.turnId === turn.id && ACTIVE.includes(j.status)); if (!job) return;
      job.status = turn.status as 'completed' | 'failed' | 'interrupted'; job.finishedAt = now();
      job.error = job.status === 'completed' ? null : 'codex_turn_not_completed';
      for (const raw of Array.isArray(turn.items) ? turn.items : []) {
        const item = object(raw);
        if (item.type === 'agentMessage' && typeof item.text === 'string') job.text = item.text.slice(0, 100_000);
        if (['commandExecution', 'fileChange', 'mcpToolCall'].includes(String(item.type))) {
          const activityId = string(item.id, 200); const entry = { id: activityId, type: String(item.type), status: String(item.status ?? 'unknown'), text: JSON.stringify(item).slice(0, 80_000), observedAt: now() };
          const index = job.activities.findIndex(a => a.id === activityId); if (index >= 0) job.activities[index] = entry; else job.activities.push(entry);
        }
      }
      emit({ type: 'codex.finished', discussionId: job.discussionId, data: { jobId: job.id, status: job.status } });
    });
    this.onProgress(); queueMicrotask(() => this.kick());
  }
  private approval(bindingId: string, rpc: RpcProcess, requestId: RpcId, method: string, params: Record<string, unknown>): void {
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) { rpc.respond(requestId, null, { code: -32601, message: 'Owner intervention required; unsupported request' }); return; }
    let accepted = false;
    this.store.transact((s, emit) => {
      const job = s.jobs.find(j => j.bindingId === bindingId && j.threadId === params.threadId && j.turnId === params.turnId && ACTIVE.includes(j.status));
      if (!job) return;
      accepted = true; job.status = 'blocked_approval';
      job.approvals.push({ id: String(requestId), rpcId: requestId, method, params, status: 'pending' });
      emit({ type: 'codex.approval_required', discussionId: job.discussionId, data: { jobId: job.id, approvalId: String(requestId) } });
    });
    if (!accepted) rpc.respond(requestId, { decision: 'cancel' }); this.onProgress();
  }
  decide(jobId: string, approvalId: string, decision: string): void {
    if (!['accept', 'decline', 'cancel'].includes(decision)) throw new AppError('invalid_decision');
    const job = this.store.read().jobs.find(j => j.id === jobId); const approval = job?.approvals.find(a => a.id === approvalId && a.status === 'pending');
    const rpc = job ? this.processes.get(job.bindingId) : null;
    if (!job || !approval || !rpc || job.status !== 'blocked_approval') throw new AppError('approval_not_pending', 409);
    rpc.respond(approval.rpcId, { decision });
    this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === jobId)!;
      current.approvals.find(a => a.id === approvalId)!.status = 'resolved';
      if (!current.approvals.some(a => a.status === 'pending')) current.status = 'running';
      emit({ type: 'codex.approval_decided', discussionId: current.discussionId, data: { jobId, approvalId, decision } }); });
  }
  async steer(jobId: string, expectedTurnId: string, text: string): Promise<void> {
    const job = this.store.read().jobs.find(j => j.id === jobId);
    if (!job || job.status !== 'running' || job.turnId !== expectedTurnId) throw new AppError('turn_conflict', 409);
    const rpc = this.processes.get(job.bindingId); if (!rpc) throw new AppError('reconciliation_required', 409);
    await rpc.request('turn/steer', { threadId: job.threadId, expectedTurnId, input: [{ type: 'text', text: string(text, 10_000) }] });
    this.store.transact((_s, emit) => emit({ type: 'codex.steered', discussionId: job.discussionId, data: { jobId, expectedTurnId } }));
  }
  async cancel(jobId: string): Promise<void> {
    const job = this.store.read().jobs.find(j => j.id === jobId); if (!job) throw new AppError('job_not_found', 404);
    if (job.status === 'queued') {
      this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === jobId)!; current.status = 'interrupted'; current.finishedAt = now(); emit({ type: 'codex.cancelled', discussionId: job.discussionId, data: { jobId } }); }); return;
    }
    const rpc = this.processes.get(job.bindingId);
    if (!rpc || !job.turnId || !['running', 'blocked_approval'].includes(job.status)) throw new AppError('reconciliation_required', 409);
    await rpc.request('turn/interrupt', { threadId: job.threadId, turnId: job.turnId });
    // Keep the lease until turn/completed actually confirms interruption.
  }
  async reconcile(jobId: string, observedTurnId?: string): Promise<void> {
    const state = this.store.read(); const job = state.jobs.find(j => j.id === jobId && j.status === 'reconciling');
    if (!job) throw new AppError('job_not_reconciling', 409);
    const targetTurnId = job.turnId ?? (observedTurnId ? string(observedTurnId, 200) : null);
    if (!targetTurnId) throw new AppError('unconfirmed_turn_requires_owner_review', 409);
    const binding = state.bindings.find(b => b.id === job.bindingId)!; const rpc = await this.connect(binding);
    const read = object(await rpc.request('thread/read', { threadId: binding.threadId, includeTurns: false }));
    await this.validateThread(binding, object(read.thread), false);
    let cursor: string | null = null; let turn: Record<string, unknown> | undefined;
    for (let page = 0; page < 10; page++) {
      const result = object(await rpc.request('thread/turns/list', { threadId: binding.threadId, limit: 100, sortDirection: 'desc', itemsView: 'full', ...(cursor ? { cursor } : {}) }));
      turn = (Array.isArray(result.data) ? result.data.map(object) : []).find(t => t.id === targetTurnId);
      if (turn || typeof result.nextCursor !== 'string') break; cursor = result.nextCursor;
    }
    if (!turn || !['completed', 'failed', 'interrupted'].includes(String(turn.status))) throw new AppError('execution_still_unconfirmed', 409);
    if (!job.turnId) {
      const matches = (Array.isArray(turn.items) ? turn.items.map(object) : []).some(item => item.type === 'userMessage'
        && (Array.isArray(item.content) ? item.content.map(object) : []).some(content => content.type === 'text' && content.text === job.prompt));
      if (!matches || typeof turn.startedAt !== 'number' || turn.startedAt * 1000 < Date.parse(job.createdAt) - 2000) throw new AppError('turn_input_mismatch', 409);
      this.store.transact((s, emit) => {
        if (s.jobs.some(j => j.id !== job.id && j.bindingId === binding.id && j.turnId === targetTurnId)) throw new AppError('turn_already_claimed', 409);
        s.jobs.find(j => j.id === job.id)!.turnId = targetTurnId;
        emit({ type: 'codex.receipt_reconciled', discussionId: job.discussionId, data: { jobId: job.id, turnId: targetTurnId } });
      });
    }
    this.completeFromTurn(binding.id, turn);
  }
  private expire(): void {
    if (this.closed) return;
    for (const job of this.store.read().jobs) if (['running', 'blocked_approval'].includes(job.status) && job.deadlineAt && Date.parse(job.deadlineAt) <= Date.now() && job.error !== 'deadline_interrupt_requested') {
      this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!; current.error = 'deadline_interrupt_requested'; emit({ type: 'codex.deadline', discussionId: job.discussionId, data: { jobId: job.id } }); });
      if (!job.turnId) { this.processes.get(job.bindingId)?.close(); continue; }
      void this.cancel(job.id).catch(() => { if (!this.closed) this.processes.get(job.bindingId)?.close(); });
    }
  }
  close(): void { this.closed = true; clearInterval(this.watchdog); for (const rpc of this.processes.values()) rpc.close(); this.processes.clear(); }
}
function inside(root: string, target: string): boolean { const path = relative(root, target); return path === '' || !path.startsWith('..') && !isAbsolute(path); }
async function gitIdentity(cwd: string): Promise<{ repoRoot: string; branch: string; head: string }> {
  const run = async (args: string[]) => (await execute('git', args, { cwd, timeout: 10_000, maxBuffer: 128_000 })).stdout.trim();
  return { repoRoot: await realpath(await run(['rev-parse', '--show-toplevel'])), branch: await run(['branch', '--show-current']), head: await run(['rev-parse', 'HEAD']) };
}
