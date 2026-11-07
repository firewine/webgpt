import { assertJobAuthority, authorityReason, bindingDigest, bindingReason, discussionDigest, grantDigest, initializeExecutionProtection, issueAuthority } from './authority.js';
import { ExecutionEvidenceStore } from './evidence-store.js';
import { OutputPreview, redactOutput, safeOutput } from './output-policy.js';
import { ProtectedWorkspaces } from './workspace-protection.js';
import { ExecutionIsolation } from './isolation.js';
import { realpath } from 'node:fs/promises';
import { relative, isAbsolute, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RpcProcess } from '../connections/rpc.js';
import type { RpcId } from '../connections/rpc.js';
import type { Store } from '../workspace/store.js';
import type { CodexJob, ExecutionBinding, WorkspaceState } from '../workspace/model.js';
import { AppError, code, digest, id, integer, now, object, string } from '../workspace/util.js';
import type { WorkScopePhase } from '../workspace/work-execution.js';
const execute = promisify(execFile);
const ACTIVE = ['running', 'blocked_approval', 'reconciling'];

export class CodexExecutor {
  readonly evidence: ExecutionEvidenceStore;
  readonly workspaces: ProtectedWorkspaces;
  private readonly isolation: ExecutionIsolation;
  private readonly previews = new Map<string, OutputPreview>();
  private readonly applying = new Set<string>();
  private readonly draftsFinishing = new Set<string>();
  private readonly secrets: () => string[];
  private readonly processes = new Map<string, RpcProcess>();
  private readonly connecting = new Map<string, Promise<RpcProcess>>();
  private readonly starting = new Set<string>();
  private closed = false;
  private readonly watchdog: NodeJS.Timeout;
  onProgress: () => void = () => {};
  beforeDispatch: ((state: WorkspaceState, job: CodexJob) => void) | null = null;
  workScopeGuard: ((state: WorkspaceState, job: CodexJob, phase: WorkScopePhase) => void) | null = null;
  private checkWorkScope(state: WorkspaceState, job: CodexJob, phase: WorkScopePhase): void {
    if (!job.requestId.startsWith('resident-work:')) return;
    if (!this.workScopeGuard) throw new AppError('work_execution_guard_required', 409);
    this.workScopeGuard(state, job, phase);
  }
  constructor(private readonly store: Store, private readonly command: string[], private readonly roots: string[], private readonly protectedPaths: string[] = [], options: { secrets?: () => string[] } = {}) {
    initializeExecutionProtection(this.store.read());
    if (this.store.read().executionProtectionVersion === undefined) this.store.transact(initializeExecutionProtection);
    this.secrets = options.secrets ?? (() => []);
    this.evidence = new ExecutionEvidenceStore(join(store.directory, 'execution-evidence'), this.secrets);
    this.workspaces = new ProtectedWorkspaces(join(store.directory, 'execution-drafts'));
    this.isolation = new ExecutionIsolation(command, protectedPaths, join(store.directory, 'execution-probes'));
    this.watchdog = setInterval(() => this.expire(), 1000); this.watchdog.unref();
  }
  recover(): void {
    this.store.transact((state, emit) => { for (const job of state.jobs) if (['running', 'blocked_approval'].includes(job.status)) {
      this.captureIncomplete(job, 'restart_capture_gap');
      job.status = 'reconciling'; job.error = 'restart_requires_reconciliation';
      emit({ type: 'codex.reconciling', discussionId: job.discussionId, data: { jobId: job.id } });
    }
      for (const job of state.jobs) if (job.draft?.status === 'applying') { job.draft.status = 'unconfirmed'; job.draft.reason = 'restart_requires_application_review'; }
    });
    for (const job of this.store.read().jobs) if (['completed', 'failed', 'interrupted'].includes(job.status) && job.draft?.status === 'running') {
      if (job.turnId) void this.finishDraftForTurn(job.bindingId, job.turnId);
      else this.store.transact(s => { const current = s.jobs.find(j => j.id === job.id)!; current.draft = { ...current.draft!, status: 'blocked', reason: 'draft_turn_receipt_missing' }; });
    }
    this.kick();
  }
  async register(input: unknown): Promise<string> {
    const body = object(input); const cwd = await realpath(string(body.cwd, 2000));
    const allowed = await Promise.all(this.roots.map(root => realpath(root)));
    if (!allowed.some(root => inside(root, cwd))) throw new AppError('workspace_not_allowed', 403);
    if (this.protectedPaths.some(path => inside(cwd, path) || inside(path, cwd))) throw new AppError('workspace_overlaps_private_state', 403);
    const repository = await gitIdentity(cwd); const allowWrite = body.allowWrite === true;
    if (allowWrite && (!repository.branch || ['main', 'master'].includes(repository.branch))) throw new AppError('feature_branch_required', 409);
    const prior = this.store.read().bindings.find(b => b.threadId === body.threadId || b.cwd === cwd);
    if (prior && (prior.threadId !== body.threadId || prior.cwd !== cwd || !authorityReason(prior.authority))) throw new AppError('workspace_already_registered', 409);
    if (prior && this.store.read().jobs.some(j => j.bindingId === prior.id && ACTIVE.includes(j.status))) throw new AppError('workspace_busy', 409);
    if (prior) this.processes.get(prior.id)?.close();
    const binding: ExecutionBinding = { id: prior?.id ?? id('binding'), label: string(body.label, 80), host: hostname(), user: userInfo().username,
      cwd, threadId: string(body.threadId, 200), allowWrite, status: 'unverified', ...repository, sessionTreeId: null, authority: issueAuthority(body.expiresInHours, (prior?.authority?.epoch ?? 0) + 1),
      protection: { version: 1, status: 'unverified', reason: allowWrite ? 'protected_execution_not_verified' : null } };
    let registrationDraftId: string | undefined;
    if (allowWrite) {
      registrationDraftId = id('registration');
      const manifest = await this.workspaces.prepare(registrationDraftId, binding);
      await this.verifyProtection(binding, manifest.copyRoot); binding.protection = { version: 1, status: 'ready', reason: null };
    }
    const rpc = await this.connect(binding, registrationDraftId);
    try {
      const result = object(await rpc.request('thread/read', { threadId: binding.threadId, includeTurns: false }));
      const thread = object(result.thread); await this.validateThread(binding, thread, true);
      binding.sessionTreeId = typeof thread.sessionId === 'string' ? thread.sessionId : null; binding.status = 'ready';
      this.store.transact((state, emit) => { const old = state.bindings.findIndex(b => b.id === binding.id); if (old >= 0) state.bindings[old] = binding; else state.bindings.push(binding); emit({ type: 'codex.binding_added', discussionId: null, data: { bindingId: binding.id } }); });
      return binding.id;
    } catch (error) { rpc.close(); this.processes.delete(binding.id); throw error; }
  }
  submit(input: { bindingId: string; prompt: string; requestId: string; discussionId?: string | null; taskId?: string | null; revision?: number | null; maxDurationMs?: number; grantId?: string }): string {
    const preflight = this.store.read(); const denied = bindingReason(preflight.bindings.find(b => b.id === input.bindingId));
    if (denied) throw new AppError(denied, 409);
    if (input.grantId) { const grant = preflight.grants.find(g => g.id === input.grantId); if (!grant || grant.revoked || authorityReason(grant.authority)) throw new AppError('execution_grant_revoked_or_changed', 409); }
    const cached = this.store.readCommand<string>('codex:' + input.requestId, input);
    if (cached.found) { const previous = preflight.jobs.find(j => j.id === cached.result); if (!previous) throw new AppError('execution_job_missing', 409); assertJobAuthority(preflight, previous); this.kick(); return previous.id; }
    const jobId = this.store.transact((state, emit) => {
      const binding = state.bindings.find(b => b.id === input.bindingId && b.status === 'ready');
      const denied = bindingReason(binding); if (denied || !binding) throw new AppError(denied ?? 'execution_binding_not_ready', 409);
      if (input.discussionId) {
        const d = state.discussions.find(d => d.id === input.discussionId);
        if (!d || d.revision !== input.revision || d.executionBindingId !== binding.id || !d.tasks.some(t => t.id === input.taskId)) throw new AppError('execution_scope_mismatch', 403);
      }
      const prompt = string(input.prompt, 30_000);
      const job: CodexJob = { id: id('job'), bindingId: binding.id, discussionId: input.discussionId ?? null, taskId: input.taskId ?? null, revision: input.revision ?? null,
        requestId: input.requestId, prompt, promptDigest: digest(prompt), status: 'queued', threadId: binding.threadId, turnId: null,
        createdAt: now(), finishedAt: null, text: '', error: null, activities: [], approvals: [],
        maxDurationMs: integer(input.maxDurationMs, 300_000, 1, 7_200_000), deadlineAt: null };
      job.authority = { version: 1, binding: { id: binding.id, epoch: binding.authority!.epoch, expiresAt: binding.authority!.expiresAt, scopeDigest: bindingDigest(binding) } };
      if (input.grantId) { const grant = state.grants.find(g => g.id === input.grantId); if (!grant?.authority) throw new AppError('execution_grant_revoked_or_changed', 409);
        job.authority.grant = { id: grant.id, epoch: grant.authority.epoch, expiresAt: grant.authority.expiresAt, scopeDigest: grantDigest(grant) }; }
      if (job.discussionId) job.authority.discussion = { scopeDigest: discussionDigest(state, job) };
      assertJobAuthority(state, job);
      state.jobs.push(job); emit({ type: 'codex.queued', discussionId: job.discussionId, data: { jobId: job.id, bindingId: binding.id } }); return job.id;
    }, { id: `codex:${input.requestId}`, input });
    this.kick(); return jobId;
  }
  kick(): void {
    if (this.closed) return;
    const state = this.store.read();
    for (const binding of state.bindings) {
      if (this.applying.has(binding.repoRoot) || this.starting.has(binding.id) || state.jobs.some(j => j.bindingId === binding.id && ACTIVE.includes(j.status))) continue;
      if ([...this.starting].some(id => state.bindings.find(b => b.id === id)?.repoRoot === binding.repoRoot)) continue;
      const job = state.jobs.find(j => j.bindingId === binding.id && j.status === 'queued' && (!j.discussionId || state.discussions.some(d => d.id === j.discussionId && d.revision === j.revision && d.status === 'running'))); if (!job) continue;
      // Single writer across canonical workspaces, including queued clients.
      if (state.jobs.some(j => ACTIVE.includes(j.status) && state.bindings.find(b => b.id === j.bindingId)?.repoRoot === binding.repoRoot)) continue;
      this.starting.add(binding.id);
      void this.start(binding, job).catch(error => {
        this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!;
          if (['completed', 'failed', 'interrupted'].includes(current.status)) return;
          current.status = current.status === 'queued' ? 'failed' : 'reconciling'; current.error = code(error);
          if (current.draft && current.status === 'failed') { current.draft.status = 'blocked'; current.draft.reason = current.error; }
          if (current.status === 'reconciling') this.captureIncomplete(current, 'dispatch_unconfirmed');
          emit({ type: 'codex.failed', discussionId: current.discussionId, data: { jobId: job.id, status: current.status, code: current.error } }); });
      }).finally(() => { this.starting.delete(binding.id); this.onProgress(); this.kick(); });
    }
  }
  private async start(binding: ExecutionBinding, job: CodexJob): Promise<void> {
    assertJobAuthority(this.store.read(), job);
    const currentRepo = await gitIdentity(binding.cwd);
    if (currentRepo.repoRoot !== binding.repoRoot || currentRepo.branch !== binding.branch) throw new AppError('workspace_changed', 409);
    if (binding.allowWrite) {
      this.store.transact(s => { s.jobs.find(j => j.id === job.id)!.draft = { version: 1, status: 'preparing' }; });
      const manifest = await this.workspaces.prepare(job.id, binding);
      await this.verifyProtection(binding, manifest.copyRoot);
      assertJobAuthority(this.store.read(), job);
      this.processes.get(binding.id)?.close();
      this.store.transact(s => { s.jobs.find(j => j.id === job.id)!.draft = { version: 1, status: 'running', manifestDigest: manifest.digest }; });
    }
    const rpc = await this.connect(binding, binding.allowWrite ? job.id : undefined);
    const read = object(await rpc.request('thread/read', { threadId: binding.threadId, includeTurns: false }));
    await this.validateThread(binding, object(read.thread), true);
    const resumed = object(await rpc.request('thread/resume', { threadId: binding.threadId, excludeTurns: true, ...(binding.allowWrite ? { permissions: this.isolation.profileId } : {}) }));
    const thread = object(resumed.thread); await this.validateThread(binding, thread, true);
    this.store.transact((s, emit) => {
      const current = s.jobs.find(j => j.id === job.id)!;
      if (current.status !== 'queued') throw new AppError('job_state_changed', 409);
      if (current.discussionId && !s.discussions.some(d => d.id === current.discussionId && d.revision === current.revision && d.status === 'running')) throw new AppError('discussion_not_running', 409);
      if (s.discussions.some(d => d.id === current.discussionId && d.roomId) && !this.beforeDispatch) throw new AppError('room_dispatch_guard_required', 409);
      assertJobAuthority(s, current);
      this.beforeDispatch?.(s, current);
      this.checkWorkScope(s, current, 'dispatch');
      current.capture = this.evidence.begin(current.id);
      this.previews.set(current.id, new OutputPreview(this.secrets));
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
      cwd: binding.cwd, approvalPolicy: 'untrusted', approvalsReviewer: 'user', ...(binding.allowWrite ? { permissions: this.isolation.profileId } : { sandboxPolicy }) }));
    const turn = object(result.turn); const turnId = string(turn.id, 200);
    this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!;
      if (current.turnId && current.turnId !== turnId) throw new AppError('turn_receipt_mismatch', 409, true);
      current.turnId = turnId; emit({ type: 'codex.receipt', discussionId: job.discussionId, data: { jobId: job.id, turnId } }); });
    if (turn.status !== 'inProgress') this.completeFromTurn(binding.id, turn);
  }
  private async connect(binding: ExecutionBinding, draftJobId?: string): Promise<RpcProcess> {
    const existing = this.processes.get(binding.id); if (existing) return existing;
    const pending = this.connecting.get(binding.id); if (pending) return pending;
    const promise = this.connectOnce(binding, draftJobId); this.connecting.set(binding.id, promise);
    try { return await promise; } finally { this.connecting.delete(binding.id); }
  }
  private async connectOnce(binding: ExecutionBinding, draftJobId?: string): Promise<RpcProcess> {
    // A private PID namespace and procfs prevent reaching masked host paths
    // through another host process’s /proc/<pid>/root or open descriptors.
    const command = draftJobId ? this.isolation.commandFor(binding, this.workspaces.manifest(draftJobId).copyRoot) : this.protectedPaths.length ? ['bwrap', '--die-with-parent', '--new-session', '--unshare-pid', '--bind', '/', '/', '--proc', '/proc', ...this.protectedPaths.flatMap(path => ['--tmpfs', path]), '--', ...this.command] : this.command;
    const rpc = new RpcProcess(command, binding.cwd, false);
    rpc.onNotification = (method, params) => this.notification(binding.id, method, params);
    rpc.onRequest = (requestId, method, params) => this.approval(binding.id, rpc, requestId, method, params);
    rpc.onClose = () => {
      this.processes.delete(binding.id);
      if (this.closed) return;
      this.store.transact((s, emit) => { for (const job of s.jobs) if (job.bindingId === binding.id && ['running', 'blocked_approval'].includes(job.status)) {
        this.captureIncomplete(job, 'transport_capture_gap'); job.status = 'reconciling'; job.error = 'codex_disconnected';
        emit({ type: 'codex.reconciling', discussionId: job.discussionId, data: { jobId: job.id } });
      } }); this.onProgress();
    };
    try { await rpc.request('initialize', { clientInfo: { name: 'webjjoku', title: 'Webjjoku', version: '0.2.0' }, ...(draftJobId ? { capabilities: { experimentalApi: true } } : {}) });
      rpc.notify('initialized');
      if (draftJobId) { const profiles = object(await rpc.request('permissionProfile/list', { cwd: binding.cwd }));
        if (!Array.isArray(profiles.data) || !profiles.data.some(p => p && typeof p === 'object' && p.id === this.isolation.profileId && p.allowed === true)) throw new AppError('protected_profile_not_allowed', 409); }
      this.processes.set(binding.id, rpc); return rpc;
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
        if (job) { this.captureEvent(job, 'turn/started', params); job.turnId = string(turn.id, 200); emit({ type: 'codex.receipt', discussionId: job.discussionId, data: { jobId: job.id, turnId: job.turnId } }); } });
      return;
    }
    if (method === 'turn/completed') { this.completeFromTurn(bindingId, object(params.turn)); return; }
    if (!['item/agentMessage/delta', 'item/commandExecution/outputDelta', 'item/started', 'item/completed', 'turn/diff/updated', 'serverRequest/resolved'].includes(method)) return;
    this.store.transact((s, emit) => {
      const job = s.jobs.find(j => j.bindingId === bindingId && ACTIVE.includes(j.status) && (j.turnId === params.turnId || method === 'serverRequest/resolved' && j.approvals.some(a => a.id === String(params.requestId)))); if (!job) return;
      this.captureEvent(job, method, params);
      if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') { const preview = this.previews.get(job.id); if (preview) { preview.append(params.delta); job.text = preview.value; job.previewTruncated = preview.truncated; } else this.captureIncomplete(job, 'preview_state_missing'); }
      if (method === 'item/started' || method === 'item/completed') {
        const item = object(params.item); const type = String(item.type);
        if (['commandExecution', 'fileChange', 'mcpToolCall', 'agentMessage'].includes(type)) {
          const activityId = string(item.id, 200);
          const entry = this.activity(item, method === 'item/completed' ? 'completed' : 'running');
          if (method === 'item/completed' && type === 'agentMessage' && typeof item.text === 'string') { const clean = redactOutput(item.text, this.secrets()); job.text = clean.slice(0, 100_000); job.previewTruncated = clean.length > 100_000; }
          const index = job.activities.findIndex(a => a.id === activityId);
          if (index >= 0) job.activities[index] = entry; else job.activities.push(entry);
        }
      }
      if (method === 'item/commandExecution/outputDelta') {
        const activity = job.activities.find(a => a.id === params.itemId);
        if (activity && typeof params.delta === 'string') { /* Raw deltas are captured privately; previews use complete items only. */ activity.status = 'running'; }
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
      this.captureEvent(job, 'turn/completed', turn);
      try { job.capture = this.evidence.finish(job.id); } catch { this.captureIncomplete(job, 'artifact_finalize_failed'); }
      job.status = turn.status as 'completed' | 'failed' | 'interrupted'; job.finishedAt = now();
      job.error = job.status === 'completed' ? null : 'codex_turn_not_completed';
      for (const approval of job.approvals) if (approval.status === 'pending') approval.status = 'resolved';
      const preview = this.previews.get(job.id); if (preview) { const text = preview.finish(); if (text) job.text = text; job.previewTruncated ||= preview.truncated; }
      for (const raw of Array.isArray(turn.items) ? turn.items : []) {
        const item = object(raw);
        if (item.type === 'agentMessage' && typeof item.text === 'string') { const clean = redactOutput(item.text, this.secrets()); job.text = clean.slice(0, 100_000); job.previewTruncated = clean.length > 100_000; }
        if (['commandExecution', 'fileChange', 'mcpToolCall'].includes(String(item.type))) {
          const activityId = string(item.id, 200); const entry = this.activity(item, 'unknown');
          const index = job.activities.findIndex(a => a.id === activityId); if (index >= 0) job.activities[index] = entry; else job.activities.push(entry);
        }
      }
      this.previews.delete(job.id);
      try { assertJobAuthority(s, job); } catch (error) { job.resultScopeReason = code(error); }
      // Remote completion remains an observation even when its work scope was
      // revoked. The bridge must not publish it as a current task result.
      try { this.checkWorkScope(s, job, 'result'); }
      catch (error) { if (!(error instanceof AppError)) throw error;
        const link = s.resident?.jobLinks.find(l => l.input.requestId === job.requestId); if (link) link.resultScopeReason = error.code;
        emit({ type: 'codex.work_result_stale', discussionId: null, data: { jobId: job.id, reason: error.code } }); }
      emit({ type: 'codex.finished', discussionId: job.discussionId, data: { jobId: job.id, status: job.status } });
    });
    void this.finishDraftForTurn(bindingId, String(turn.id));
    this.onProgress(); queueMicrotask(() => this.kick());
  }
  private approval(bindingId: string, rpc: RpcProcess, requestId: RpcId, method: string, params: Record<string, unknown>): void {
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) { rpc.respond(requestId, null, { code: -32601, message: 'Owner intervention required; unsupported request' }); return; }
    let accepted = false;
    this.store.transact((s, emit) => {
      const job = s.jobs.find(j => j.bindingId === bindingId && j.threadId === params.threadId && j.turnId === params.turnId && ACTIVE.includes(j.status));
      if (!job) return;
      try { assertJobAuthority(s, job); } catch { return; }
      this.captureEvent(job, 'approval', { requestId, method, params });
      accepted = true; job.status = 'blocked_approval';
      job.approvals.push({ id: String(requestId), rpcId: requestId, method, params: safeOutput(params, this.secrets()) as Record<string, unknown>, status: 'pending' });
      emit({ type: 'codex.approval_required', discussionId: job.discussionId, data: { jobId: job.id, approvalId: String(requestId) } });
    });
    if (!accepted) rpc.respond(requestId, { decision: 'cancel' }); this.onProgress();
  }
  decide(jobId: string, approvalId: string, decision: string): void {
    if (!['accept', 'decline', 'cancel'].includes(decision)) throw new AppError('invalid_decision');
    const job = this.store.read().jobs.find(j => j.id === jobId); const approval = job?.approvals.find(a => a.id === approvalId && a.status === 'pending');
    const rpc = job ? this.processes.get(job.bindingId) : null;
    if (!job || !approval || !rpc || job.status !== 'blocked_approval') throw new AppError('approval_not_pending', 409);
    if (decision === 'accept') { assertJobAuthority(this.store.read(), job); this.checkWorkScope(this.store.read(), job, 'approval');
      if (job.draft) throw new AppError('protected_approval_requires_scoped_support', 409); }
    rpc.respond(approval.rpcId, { decision });
    this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === jobId)!;
      current.approvals.find(a => a.id === approvalId)!.status = 'resolved';
      if (!current.approvals.some(a => a.status === 'pending')) current.status = 'running';
      emit({ type: 'codex.approval_decided', discussionId: current.discussionId, data: { jobId, approvalId, decision } }); });
  }
  async steer(jobId: string, expectedTurnId: string, text: string): Promise<void> {
    const job = this.store.read().jobs.find(j => j.id === jobId);
    if (!job || job.status !== 'running' || job.turnId !== expectedTurnId) throw new AppError('turn_conflict', 409);
    assertJobAuthority(this.store.read(), job);
    if (job.draft) throw new AppError('protected_input_immutable', 409);
    this.checkWorkScope(this.store.read(), job, 'steer');
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
    const binding = state.bindings.find(b => b.id === job.bindingId)!; const rpc = await this.connect(binding, job.draft ? job.id : undefined);
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
    let changed = false;
    for (const job of this.store.read().jobs) {
      if (['queued', 'running', 'blocked_approval'].includes(job.status)) {
        try { assertJobAuthority(this.store.read(), job); } catch (error) {
          if (job.error !== 'authority_interrupt_requested') { changed = true; this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!; current.resultScopeReason = code(error); current.error = 'authority_interrupt_requested';
            if (current.status === 'queued') { current.status = 'failed'; current.finishedAt = now(); }
            emit({ type: 'codex.authority_lost', discussionId: job.discussionId, data: { jobId: job.id, reason: current.resultScopeReason } }); });
            if (job.status !== 'queued') void this.cancel(job.id).catch(() => this.processes.get(job.bindingId)?.close());
          }
          continue;
        }
      }
      if (['running', 'blocked_approval'].includes(job.status) && job.deadlineAt && Date.parse(job.deadlineAt) <= Date.now() && job.error !== 'deadline_interrupt_requested') {
      this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!; current.error = 'deadline_interrupt_requested'; emit({ type: 'codex.deadline', discussionId: job.discussionId, data: { jobId: job.id } }); });
      if (!job.turnId) { this.processes.get(job.bindingId)?.close(); continue; }
      void this.cancel(job.id).catch(() => { if (!this.closed) this.processes.get(job.bindingId)?.close(); });
    }
    }
    if (changed) { this.onProgress(); this.kick(); }
  }
  private async verifyProtection(binding: ExecutionBinding, copyRoot: string): Promise<void> {
    try { await this.isolation.verify(binding, copyRoot); } catch { throw new AppError('protected_execution_unavailable', 409); }
  }
  private captureEvent(job: CodexJob, channel: string, value: unknown): void {
    try { job.capture = this.evidence.append(job.id, channel, value); }
    catch { this.captureIncomplete(job, 'artifact_capture_failed'); }
  }
  private captureIncomplete(job: CodexJob, reason: string): void {
    try { job.capture = this.evidence.incomplete(job.id, reason); }
    catch { if (job.capture) { job.capture.complete = false; job.capture.reason = reason; } }
  }
  private activity(item: Record<string, unknown>, fallback: string): CodexJob['activities'][number] {
    const clean = safeOutput(item, this.secrets()) as Record<string, unknown>;
    const output = typeof clean.aggregatedOutput === 'string' ? clean.aggregatedOutput : null;
    const bounded = { ...clean, ...(output === null ? {} : { aggregatedOutput: output.slice(0, 60_000) }) };
    const text = JSON.stringify(bounded);
    return { id: string(item.id, 200), type: String(item.type), status: String(item.status ?? fallback), text: text.length <= 80_000 ? text : JSON.stringify({ type: clean.type, omitted: true }), observedAt: now(),
      truncated: text.length > 80_000 || (output?.length ?? 0) > 60_000,
      ...(item.type === 'commandExecution' ? { command: { command: typeof clean.command === 'string' ? clean.command.slice(0, 10_000) : null,
        exitCode: typeof clean.exitCode === 'number' && Number.isSafeInteger(clean.exitCode) ? clean.exitCode : null, output: output?.slice(0, 60_000) ?? null } } : {}) };
  }
  private async finishDraftForTurn(bindingId: string, turnId: string): Promise<void> {
    const j = this.store.read().jobs.find(j => j.bindingId === bindingId && j.turnId === turnId && j.draft?.status === 'running');
    if (!j || this.draftsFinishing.has(j.id)) return; this.draftsFinishing.add(j.id);
    try {
      const inspection = await this.workspaces.inspect(j.id);
      if (this.closed) return;
      this.store.transact((s, emit) => { const job = s.jobs.find(job => job.id === j.id)!; if (job.draft?.status !== 'running') return;
        job.draft = { version: 1, status: job.status !== 'completed' || !job.capture?.complete || job.resultScopeReason ? 'blocked' : inspection.status === 'ready' ? 'pending' : inspection.status,
          manifestDigest: inspection.manifestDigest, diffDigest: inspection.diffDigest, reason: job.resultScopeReason ?? (!job.capture?.complete ? 'execution_capture_incomplete' : inspection.reason) };
        emit({ type: 'codex.draft_ready', discussionId: job.discussionId, data: { jobId: job.id, status: job.draft.status } }); });
    } catch (error) { if (this.closed) return; this.store.transact(s => { const job = s.jobs.find(job => job.id === j.id)!; job.draft = { ...job.draft!, status: 'blocked', reason: code(error) }; }); }
    finally { this.draftsFinishing.delete(j.id); this.onProgress(); }
  }
  authorityChanged(): void { this.expire(); this.onProgress(); }
  async revokeBinding(bindingId: string): Promise<void> {
    this.store.transact((s, emit) => { const b = s.bindings.find(b => b.id === bindingId); if (!b) throw new AppError('execution_binding_not_found', 404);
      if (b.authority && !b.authority.revokedAt) b.authority.revokedAt = now(); b.status = 'blocked';
      emit({ type: 'codex.binding_revoked', discussionId: null, data: { bindingId } }); });
    this.authorityChanged();
  }
  private job(jobId: string): CodexJob { const job = this.store.read().jobs.find(j => j.id === jobId); if (!job) throw new AppError('job_not_found', 404); return job; }
  validateResult(jobId: string): string | null {
    const state = this.store.read(); const job = state.jobs.find(j => j.id === jobId); if (!job) return 'execution_job_missing';
    if (job.resultScopeReason) return job.resultScopeReason;
    try { assertJobAuthority(state, job); } catch (error) { return code(error); }
    if (!job.capture?.complete) return 'execution_capture_incomplete';
    try { const actual = this.evidence.describe(jobId);
      return actual.complete && actual.digest === job.capture.digest && actual.byteLength === job.capture.byteLength && actual.pageCount === job.capture.pageCount ? null : 'execution_capture_integrity_changed';
    } catch { return 'execution_capture_integrity_changed'; }
  }
  evidencePage(jobId: string, page: number) {
    const job = this.job(jobId); if (!job.capture) throw new AppError('execution_original_unavailable', 409);
    try { const metadata = this.evidence.describe(job.id); if (!Number.isSafeInteger(page) || page < 0 || page >= metadata.pageCount) throw new AppError('invalid_page', 416); return this.evidence.page(job.id, page); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('execution_original_unavailable', 409); }
  }
  async inspectDraft(jobId: string) {
    const job = this.job(jobId); if (!job.draft) throw new AppError('protected_draft_required', 409);
    const result = await this.workspaces.inspect(job.id);
    return { ...result, files: result.files.map(f => ({ path: f.path, beforeDigest: f.beforeDigest, afterDigest: f.afterDigest, diff: redactOutput(f.diff, this.secrets()) })) };
  }
  async applyDraft(jobId: string, expectedDiffDigest: string, commandId: string) {
    const job = this.job(jobId); assertJobAuthority(this.store.read(), job);
    const integrity = this.validateResult(jobId); if (integrity) throw new AppError(integrity, 409);
    const input = { jobId, expectedDiffDigest }; const receipt = this.store.readCommand('codex:apply:' + commandId, input); if (receipt.found) return receipt.result;
    if (job.status !== 'completed' || !job.capture?.complete || job.resultScopeReason || job.draft?.status !== 'pending' || job.draft.diffDigest !== expectedDiffDigest) throw new AppError('draft_not_applicable', 409);
    const binding = this.store.read().bindings.find(b => b.id === job.bindingId)!;
    if (this.applying.has(binding.repoRoot) || this.store.read().jobs.some(j => this.store.read().bindings.find(b => b.id === j.bindingId)?.repoRoot === binding.repoRoot && ACTIVE.includes(j.status))) throw new AppError('workspace_busy', 409);
    this.applying.add(binding.repoRoot);
    let sourceApplied = false;
    try {
      this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === job.id)!; assertJobAuthority(s, current); this.checkWorkScope(s, current, 'result');
        if (current.draft?.status !== 'pending' || current.draft.diffDigest !== expectedDiffDigest) throw new AppError('draft_not_applicable', 409);
        current.draft.status = 'applying'; emit({ type: 'codex.application_intent', discussionId: current.discussionId, data: { jobId, diffDigest: expectedDiffDigest } });
        return { jobId, expectedDiffDigest };
      }, { id: 'codex:apply-reservation:' + commandId, input });
      const applied = await this.workspaces.apply(jobId, expectedDiffDigest, () => {
        if (this.closed) throw new AppError('execution_stopping', 409);
        const integrity = this.validateResult(jobId); if (integrity) throw new AppError(integrity, 409);
        const s = this.store.read(); const current = s.jobs.find(j => j.id === jobId)!; assertJobAuthority(s, current); this.checkWorkScope(s, current, 'result');
        if (current.draft?.status !== 'applying' || current.draft.diffDigest !== expectedDiffDigest) throw new AppError('draft_not_applicable', 409);
      });
      sourceApplied = true;
      return this.store.transact((s, emit) => { const current = s.jobs.find(j => j.id === jobId)!;
        current.draft = { ...current.draft!, status: 'applied', receipt: applied, reason: null };
        // Application is an observed fact even if authority is revoked immediately afterwards.
        try { assertJobAuthority(s, current); } catch (error) { current.resultScopeReason = code(error); }
        emit({ type: 'codex.application_completed', discussionId: current.discussionId, data: { jobId, path: applied.path, beforeDigest: applied.beforeDigest, afterDigest: applied.afterDigest } }); return applied;
      }, { id: 'codex:apply:' + commandId, input });
    } catch (error) {
      const current = this.job(jobId);
      if (current.draft?.status === 'applying') this.store.transact((s, emit) => { const j = s.jobs.find(j => j.id === jobId)!; j.draft = { ...j.draft!, status: !sourceApplied && error instanceof AppError && !error.uncertain ? 'conflict' : 'unconfirmed', reason: code(error) };
        emit({ type: 'codex.application_unconfirmed', discussionId: j.discussionId, data: { jobId, reason: code(error) } }); });
      throw error;
    } finally { this.applying.delete(binding.repoRoot); this.onProgress(); }
  }
  close(): void { this.closed = true; clearInterval(this.watchdog); for (const rpc of this.processes.values()) rpc.close(); this.processes.clear(); }
}
function inside(root: string, target: string): boolean { const path = relative(root, target); return path === '' || !path.startsWith('..') && !isAbsolute(path); }
async function gitIdentity(cwd: string): Promise<{ repoRoot: string; branch: string; head: string }> {
  const run = async (args: string[]) => (await execute('git', args, { cwd, timeout: 10_000, maxBuffer: 128_000 })).stdout.trim();
  return { repoRoot: await realpath(await run(['rev-parse', '--show-toplevel'])), branch: await run(['branch', '--show-current']), head: await run(['rev-parse', 'HEAD']) };
}
