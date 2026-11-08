import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executionGuard, validateExecutionPolicy } from '../scripts/live-acceptance-codex.mjs';
import { acceptanceGuard } from '../scripts/live-acceptance-guard.mjs';

// Load the real Store and approval seals in a private directory. Running this
// file needs neither node_modules nor a build of the concurrently edited dist.
const source = fileURLToPath(new URL('../src/', import.meta.url));
const compiled = mkdtempSync(join(tmpdir(), 'wj-acceptance-test-runtime-'));
after(() => rmSync(compiled, { recursive: true, force: true }));
writeFileSync(join(compiled, 'package.json'), '{"type":"module"}');
for (const name of ['workspace/store', 'workspace/model', 'workspace/util', 'execution/approval-policy']) {
  const target = join(compiled, `${name}.js`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stripTypeScriptTypes(readFileSync(join(source, `${name}.ts`), 'utf8'), { mode: 'transform' }));
}
const { Store } = await import(pathToFileURL(join(compiled, 'workspace/store.js')));
const { AppError } = await import(pathToFileURL(join(compiled, 'workspace/util.js')));
const { createScopedApproval } = await import(pathToFileURL(join(compiled, 'execution/approval-policy.js')));
const hash = text => createHash('sha256').update(text).digest('hex');
const before = 'export const allowed = (used, cap) => used <= cap;\n';
const afterText = before.replace('<=', '<');
const deny = (action, reason = /acceptance_execution_/) => assert.rejects(async () => action(), reason);
const wrapped = ['register', 'submit', 'decide', 'applyDraft', 'steer', 'beforeDispatch', 'workScopeGuard'];

function fixture(t, { install = true } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'wj-acceptance-codex-')));
  const root = join(directory, 'repo'); mkdirSync(root);
  writeFileSync(join(root, 'allowance.mjs'), before);
  const participant = { id: 'reviewer', connectionId: 'synthetic-only', modelId: 'fixture', kind: 'browser', label: 'Fixture', role: '' };
  const policy = { roomId: 'room', participants: [participant], baselineLeases: [], maxRequests: 30, maxApiRequests: 6,
    maxMs: 1_800_000, drainMs: 300_000, execution: { version: 1, runId: 'fixture-run', root,
      branch: 'r8-fixture', head: 'a'.repeat(40), baselineJobs: ['old-job'], baselineBindings: ['old-binding'],
      commands: { read: 'node check-boundary.mjs', write: 'node repair-boundary.mjs && node check-boundary.mjs' },
      applyPath: 'allowance.mjs', applyBeforeDigest: hash(before), applyAfterDigest: hash(afterText) } };
  const f = { directory, root, policy, time: Date.parse('2026-11-08T00:00:00Z'), calls: [],
    admission: { reason: null, deadlineReached: false }, store: new Store(join(directory, 'state')) };
  const called = (method, args) => { f.calls.push({ method, args }); };
  f.count = method => f.calls.filter(c => c.method === method).length;
  f.store.transact(s => {
    s.bindings.push({ id: 'old-binding', threadId: 'old-thread' });
    s.jobs.push({ id: 'old-job', bindingId: 'old-binding', status: 'completed', approvals: [] });
    s.resident = { rooms: [{ id: policy.roomId, version: 1, desiredOn: true, ledger: [] }], dispatchLeases: [] };
  });
  const codex = {
    async register(input) {
      called('register', input);
      if (f.registerWait) await f.registerWait;
      if (f.registerError) throw f.registerError;
      return f.store.transact((s, emit) => {
        const prior = s.bindings.find(b => b.cwd === input.cwd);
        const b = { id: prior?.id ?? 'new-binding', threadId: prior?.threadId ?? 'new-thread',
          host: 'fixture-host', user: 'fixture-owner', cwd: input.cwd, repoRoot: input.cwd,
          branch: policy.execution.branch, head: policy.execution.head, label: input.label, status: 'ready',
          allowWrite: input.allowWrite, readProtection: 1, protection: { version: 1, status: 'ready', reason: null },
          authority: { version: 1, epoch: (prior?.authority.epoch ?? 0) + 1,
            issuedAt: new Date(f.time).toISOString(), expiresAt: new Date(f.time + 3_600_000).toISOString(), revokedAt: null } };
        if (prior) s.bindings[s.bindings.indexOf(prior)] = b; else s.bindings.push(b);
        emit({ type: 'codex.binding_added', discussionId: null, data: { bindingId: b.id } }); return b.id;
      });
    },
    submit(input) {
      called('submit', input);
      const cached = f.store.readCommand(`codex:${input.requestId}`, input);
      if (cached.found) return cached.result;
      return f.store.transact((s, emit) => {
        const b = s.bindings.find(b => b.id === input.bindingId), id = `job-${input.requestId}`;
        s.jobs.push({ ...input, id, threadId: b.threadId, turnId: `turn-${id}`, status: 'queued',
          createdAt: new Date(f.time).toISOString(), finishedAt: null, text: '', error: null, activities: [], approvals: [],
          authority: { version: 1, binding: { id: b.id, epoch: b.authority.epoch, expiresAt: b.authority.expiresAt, scopeDigest: hash(b.id) } },
          ...(b.allowWrite ? { draft: { version: 1, status: 'running' } } : { readCopy: { version: 1, status: 'running', reason: null } }) });
        emit({ type: 'codex.queued', discussionId: input.discussionId, data: { jobId: id, bindingId: b.id } }); return id;
      }, { id: `codex:${input.requestId}`, input });
    },
    decide(jobId, approvalId, decision, confirmation) {
      called('decide', { jobId, approvalId, decision, confirmation });
      f.store.transact(s => {
        const j = s.jobs.find(j => j.id === jobId), a = j.approvals.find(a => a.id === approvalId);
        a.status = 'resolved'; j.status = 'running';
        if (decision === 'accept') {
          a.scope.state = 'sent'; a.scope.choice = { commandId: confirmation.commandId,
            selectedAt: new Date(f.time).toISOString(), delivery: 'sent' };
        }
      });
    },
    async inspectDraft(jobId) { called('inspectDraft', { jobId }); if (f.inspectWait) await f.inspectWait; return structuredClone(f.diff); },
    workspaces: { async apply(jobId, expectedDiffDigest, beforeWrite) {
      called('workspaceApply', { jobId, expectedDiffDigest });
      const guarded = beforeWrite();
      if (guarded instanceof Promise) {
        void guarded.catch(() => {});
        throw new AppError('protected_workspace_synchronous_guard_required', 409);
      }
      if (guarded !== null && typeof guarded === 'object' && 'then' in guarded)
        throw new AppError('protected_workspace_synchronous_guard_required', 409);
      writeFileSync(join(root, 'allowance.mjs'), afterText);
      return { path: 'allowance.mjs', beforeDigest: hash(before), afterDigest: hash(afterText), appliedAt: new Date(f.time).toISOString() };
    } },
    async applyDraft(jobId, expectedDiffDigest, commandId) {
      called('applyDraft', { jobId, expectedDiffDigest, commandId });
      const input = { jobId, expectedDiffDigest }, cached = f.store.readCommand(`codex:apply:${commandId}`, input);
      if (cached.found) return cached.result;
      f.store.transact(s => { s.jobs.find(j => j.id === jobId).draft.status = 'applying'; });
      const result = await this.workspaces.apply(jobId, expectedDiffDigest, () => { if (f.beforeWrite) return f.beforeWrite(); });
      return f.store.transact((s, emit) => {
        const j = s.jobs.find(j => j.id === jobId); j.draft.status = 'applied'; j.draft.receipt = result;
        emit({ type: 'codex.application_completed', discussionId: j.discussionId, data: { jobId, ...result } }); return result;
      }, { id: `codex:apply:${commandId}`, input });
    },
    async steer(...args) { called('steer', args); },
    beforeDispatch(s, job) { called('beforeDispatch', { jobId: job.id }); assert.ok(s.jobs.some(j => j.id === job.id)); if (f.dispatchError) throw f.dispatchError; },
    workScopeGuard(s, job, phase) { called('workScopeGuard', { jobId: job.id, phase }); assert.ok(s.jobs.some(j => j.id === job.id)); if (f.scopeError) throw f.scopeError; },
    async cancel(jobId) { called('cancel', { jobId }); if (f.cancelWait) await f.cancelWait; },
  };
  f.app = { config: { workspaceRoots: [root], turnTimeoutMs: 300_000 }, store: f.store, codex,
    engine: { control(id, body, requestId) {
      called('control', { id, body, requestId }); f.store.transact((s, emit) => {
        const d = s.discussions.find(d => d.id === id); assert.equal(body.expectedRevision, d.revision);
        if (body.action === 'pause') { assert.equal(d.status, 'running'); d.status = 'paused'; } else d.status = 'running';
        emit({ type: 'discussion.controlled', discussionId: id, data: body });
      });
    } }, resident: { control(id, body) { f.store.transact(s => {
      const r = s.resident.rooms.find(r => r.id === id); assert.equal(body.expectedVersion, r.version); r.version++; r.desiredOn = false;
    }); } }, dispatch: { reserve(s, input) {
      called('reserve', input); s.resident.dispatchLeases.push({ id: input.requestId, roomId: input.roomId, participantId: input.participantId, state: 'released' });
      s.resident.rooms[0].ledger.push({ requestId: input.requestId, reservedAt: new Date(f.time).toISOString() }); return null;
    } } };
  f.originals = Object.fromEntries(wrapped.map(k => [k, codex[k]])); f.originalApply = codex.workspaces.apply;
  f.install = () => { f.guard = executionGuard(f.app, policy, { clock: () => f.time, admission: () => f.admission, ErrorType: AppError }); return f.guard; };
  f.restart = () => { f.guard.close(); f.store.close(); f.store = new Store(join(directory, 'state')); f.app.store = f.store; return f.install(); };
  f.receipt = suffix => f.store.readCommand(`acceptance:${policy.execution.runId}:${suffix}`, policy);
  f.binding = () => f.store.read().bindings.find(b => b.id === 'new-binding');
  f.job = id => f.store.read().jobs.find(j => j.id === id);
  f.register = extra => codex.register({ cwd: root, label: 'Synthetic only', sessionMode: 'new', allowWrite: false, expiresInHours: 1, ...extra });
  f.input = (taskId = 'read-task', extra = {}) => ({ bindingId: 'new-binding', discussionId: 'topic', taskId, requestId: taskId,
    revision: 1, prompt: 'Synthetic fixture only', maxDurationMs: 300_000, ...extra });
  f.topic = () => f.store.transact(s => { s.discussions.push({ id: 'topic', roomId: policy.roomId, revision: 1, status: 'running',
    executionBindingId: 'new-binding', members: [participant], limits: { maxRounds: 1, maxVerificationTasks: 2, maxToolJobs: 2 },
    turns: [], evidence: [], tasks: ['read-task', 'write-task', 'third-task'].map(id => ({ id, revision: 1, participantId: participant.id,
      phase: 'verification', method: 'codex', status: 'pending', turnId: null, jobId: null })) }); });
  f.startRead = async () => { await f.register(); f.topic(); return codex.submit(f.input()); };
  f.completeRead = id => f.store.transact((s, emit) => {
    const j = s.jobs.find(j => j.id === id), d = s.discussions.find(d => d.id === j.discussionId);
    j.status = 'completed'; j.finishedAt = new Date(f.time).toISOString(); j.readCopy.status = 'checked';
    j.capture = { version: 1, jobId: id, artifactId: 'capture-read', digest: hash('read'), byteLength: 4, pageCount: 1, complete: true, reason: null };
    d.tasks.find(t => t.id === j.taskId).jobId = id;
    d.evidence.push({ id: 'read-evidence', taskId: j.taskId, kind: 'execution', source: `codex:${id}`, text: 'Observed boundary failure', status: 'observed' });
    emit({ type: 'evidence.added', discussionId: d.id, data: { jobId: id, taskId: j.taskId } });
  });
  f.evaluateRead = (id, extra = {}) => f.store.transact((s, emit) => {
    const j = s.jobs.find(j => j.id === id), d = s.discussions.find(d => d.id === j.discussionId), task = d.tasks.find(t => t.id === j.taskId);
    task.status = 'completed'; task.turnId = 'evaluation-turn';
    d.turns.push({ id: task.turnId, taskId: task.id, status: 'completed', reply: { text: 'Read independently evaluated' }, error: null, ...extra });
    emit({ type: 'turn.finished', discussionId: d.id, data: { turnId: task.turnId, status: 'completed', error: null } });
  });
  f.revoke = () => f.store.transact(s => { s.bindings.find(b => b.id === 'new-binding').authority.revokedAt = new Date(f.time).toISOString(); });
  f.upgrade = () => f.register({ sessionMode: 'existing', threadId: 'new-thread', allowWrite: true });
  f.startWrite = async () => {
    const id = await f.startRead(); f.completeRead(id); f.evaluateRead(id); f.revoke(); await f.upgrade();
    f.app.engine.control('topic', { action: 'resume', expectedRevision: 1 }, 'explicit-resume');
    return codex.submit(f.input('write-task'));
  };
  f.approval = (id, approvalId = 'approval') => {
    const j = f.job(id), write = j.authority.binding.epoch === 2, command = policy.execution.commands[write ? 'write' : 'read'];
    const params = { kind: 'command', threadId: j.threadId, turnId: j.turnId, itemId: 'command-item', environmentId: 'local', cwd: root,
      command, availableDecisions: ['accept', 'decline', 'cancel'] };
    const scope = createScopedApproval({ jobId: id, threadId: j.threadId, turnId: j.turnId, rpcId: approvalId,
      method: 'item/commandExecution/requestApproval', params, contextDigest: hash('live-context'), displayCommand: command,
      cwd: root, profileId: write ? 'webjjoku_copy' : 'webjjoku_read' });
    assert.equal(scope.state, 'checking'); scope.state = 'ready';
    f.store.transact(s => { const job = s.jobs.find(j => j.id === id); job.status = 'blocked_approval';
      job.approvals.push({ id: approvalId, rpcId: approvalId, method: 'item/commandExecution/requestApproval', params, status: 'pending', scope }); });
    return { ownerConfirmed: true, expectedScopeDigest: scope.digest, commandId: `choice-${approvalId}` };
  };
  f.pendingDraft = id => {
    f.diff = { status: 'ready', reason: null, manifestDigest: hash('manifest'), diffDigest: hash('one-file-diff'),
      files: [{ path: 'allowance.mjs', beforeDigest: hash(before), afterDigest: hash(afterText), diff: '-used <= cap\n+used < cap\n' }] };
    f.store.transact(s => { const j = s.jobs.find(j => j.id === id); j.status = 'completed'; j.capture = { complete: true };
      j.draft = { version: 1, status: 'pending', diffDigest: f.diff.diffDigest }; });
  };
  t.after(() => { f.guard?.close(); f.store.close(); rmSync(directory, { recursive: true, force: true }); });
  if (install) f.install();
  return f;
}

test('execution policy is synchronous, defaults to no roots, and requires one exact canonical opt-in root', t => {
  const f = fixture(t);
  assert.equal(validateExecutionPolicy(f.policy, f.app.config), undefined);
  assert.equal(validateExecutionPolicy({}, { workspaceRoots: [] }), undefined);
  assert.throws(() => validateExecutionPolicy({}, f.app.config), /acceptance_requires_no_codex_roots/);
  assert.throws(() => executionGuard({ ...f.app, config: { workspaceRoots: [] } }, {}), /acceptance_execution_opt_in_required/);
  for (const change of [{ version: 2 }, { runId: '../run' }, { branch: 'main' }, { head: 'bad' },
    { baselineJobs: ['same', 'same'] }, { baselineBindings: [1] }, { commands: { read: 'x', write: 'x' } },
    { commands: { read: 'x', write: 'y', extra: 'z' } }, { applyPath: '../allowance.mjs' },
    { applyAfterDigest: f.policy.execution.applyBeforeDigest }, { extraAuthority: true }]) {
    assert.throws(() => validateExecutionPolicy({ ...f.policy, execution: { ...f.policy.execution, ...change } }, f.app.config), /invalid_acceptance_execution_policy/);
  }
  const alias = join(f.directory, 'alias'); symlinkSync(f.root, alias);
  for (const [root, roots] of [[alias, [alias]], [f.root, []], [f.root, [f.root, f.root]], [f.root, [f.directory]]])
    assert.throws(() => validateExecutionPolicy({ ...f.policy, execution: { ...f.policy.execution, root } }, { workspaceRoots: roots }), /acceptance_execution_root_mismatch/);
  assert.throws(() => validateExecutionPolicy({ ...f.policy, execution: { ...f.policy.execution, root: join(f.directory, 'missing') } }, f.app.config), /acceptance_execution_root_missing/);
});

test('registration admits one new thread, blocks concurrent/changed registration, and persists uncertain intent', async t => {
  const f = fixture(t);
  for (const extra of [{ allowWrite: true }, { sessionMode: 'existing', threadId: 'foreign-thread' }, { expiresInHours: 2 }, { threadId: 'foreign-thread' }, { cwd: f.directory }])
    await deny(() => f.register(extra), /acceptance_execution_registration_not_allowed/);
  assert.equal(f.count('register'), 0);
  let release; f.registerWait = new Promise(resolve => { release = resolve; });
  const pending = f.register(); assert.equal(f.guard.observe(f.store.read()).active, true);
  await deny(() => f.register(), /acceptance_execution_registration_not_allowed/); release(); await pending;
  assert.equal(f.count('register'), 1); assert.equal(f.receipt('binding').result.threadId, 'new-thread');
  await deny(() => f.register()); f.restart(); await deny(() => f.register()); assert.equal(f.count('register'), 1);
  const failed = fixture(t); failed.registerError = new Error('synthetic disconnected thread/start');
  await assert.rejects(failed.register(), /synthetic disconnected/);
  assert.equal(failed.receipt('register-intent').found, true); assert.equal(failed.receipt('binding').found, false);
  assert.throws(() => failed.restart(), /acceptance_execution_registration_unconfirmed/);
  assert.equal(failed.count('register'), 1);
});

test('submit and existing dispatch hooks fence forged room, topic, job, binding and authority scope', async t => {
  const f = fixture(t), id = await f.startRead(), valid = f.store.read();
  const edits = [s => { s.bindings[1].cwd = f.directory; }, s => { s.bindings[1].repoRoot = f.directory; },
    s => { s.bindings[1].branch = 'other'; }, s => { s.bindings[1].head = 'b'.repeat(40); },
    s => { s.bindings[1].threadId = 'foreign-thread'; }, s => { s.bindings[1].host = 'foreign-host'; },
    s => { s.bindings[1].authority.epoch = 2; }, s => { s.bindings[1].readProtection = 0; },
    s => { s.discussions[0].roomId = 'other-room'; }, s => { s.discussions[0].tasks[0].method = 'review'; },
    s => { s.discussions[0].members[0].id = 'outside-member'; }, s => { s.discussions[0].limits.maxToolJobs = 3; },
    s => { s.jobs[1].threadId = 'other-thread'; }, s => { s.jobs[1].authority.binding.epoch = 2; },
    s => { s.jobs[1].maxDurationMs = 300_001; }, s => { s.jobs[1].revision = 2; }];
  for (const edit of edits) {
    const s = structuredClone(valid); edit(s);
    assert.throws(() => f.app.codex.beforeDispatch(s, s.jobs.find(j => j.id === id)), /acceptance_execution_/);
  }
  assert.equal(f.count('beforeDispatch'), 0);
  const j = f.job(id); f.app.codex.beforeDispatch(valid, j); f.app.codex.workScopeGuard(valid, j, 'dispatch');
  assert.equal(f.count('beforeDispatch'), 1); assert.equal(f.count('workScopeGuard'), 1);
  f.dispatchError = new Error('existing dispatch denial'); assert.throws(() => f.app.codex.beforeDispatch(valid, j), /existing dispatch denial/);
  f.scopeError = new Error('existing work denial'); assert.throws(() => f.app.codex.workScopeGuard(valid, j, 'result'), /existing work denial/);
  for (const extra of [{ bindingId: 'old-binding' }, { grantId: 'unapproved' }, { discussionId: 'outside-topic' }, { taskId: 'outside-task' }, { revision: 2 }, { maxDurationMs: 300_001 }])
    await deny(() => f.app.codex.submit(f.input('write-task', extra)));
  assert.equal(f.count('submit'), 1); await deny(() => f.app.codex.steer(id, j.turnId, 'changed command')); assert.equal(f.count('steer'), 0);
});

test('durable topic pins and two job slots survive replay, failure, restart and policy changes', async t => {
  const f = fixture(t), id = await f.startWrite(), input = f.input('write-task');
  assert.equal(f.app.codex.submit(input), id);
  assert.throws(() => f.app.codex.submit({ ...input, prompt: 'changed replay' }), /idempotency_conflict/);
  f.store.transact(s => { s.jobs.find(j => j.id === id).status = 'failed'; });
  f.restart(); assert.equal(f.guard.observe(f.store.read()).jobs, 2);
  assert.equal(f.app.codex.submit(input), id); await deny(() => f.app.codex.submit(f.input('third-task')), /acceptance_execution_job_limit/);
  assert.equal(f.store.read().jobs.length, 3); assert.equal(f.count('register'), 2);
  f.store.transact(s => { const d = structuredClone(s.discussions[0]); d.id = 'replacement-topic'; s.discussions.push(d); });
  await deny(() => f.app.codex.submit(f.input('write-task', { discussionId: 'replacement-topic' })), /acceptance_execution_topic_changed/);
  f.guard.close();
  assert.throws(() => executionGuard(f.app, { ...f.policy, maxRequests: 29 }), /idempotency_conflict/);
  f.policy.maxRequests = 29; assert.throws(() => f.install(), /idempotency_conflict/);
});

test('real Store listeners seal read evidence and pause synchronously before the next Core submission', async t => {
  const f = fixture(t), id = await f.startRead();
  f.completeRead(id);
  const observed = f.receipt('read-observed'); assert.equal(observed.found, true);
  assert.equal(observed.result.jobId, id); assert.equal(observed.result.evidenceTextDigest, hash('Observed boundary failure'));
  let nextIterationStatus;
  const unsubscribe = f.store.subscribe(event => { if (event.type === 'turn.finished') nextIterationStatus = f.store.read().discussions[0].status; });
  f.evaluateRead(id); unsubscribe();
  assert.equal(nextIterationStatus, 'paused'); assert.equal(f.receipt('read-paused').found, true);
  assert.equal(f.count('control'), 1); await deny(() => f.app.codex.submit(f.input('write-task')), /acceptance_execution_job_limit/);
  f.revoke(); await f.upgrade(); assert.equal(f.binding().authority.epoch, 2);
  assert.equal(f.binding().threadId, 'new-thread'); assert.equal(f.receipt('read-observed').result.authority.binding.epoch, 1);
  assert.equal(f.receipt('write-ready').found, true);
  const listeners = f.store.listeners.size; f.guard.close(); assert.equal(f.store.listeners.size, listeners - 1);
});

test('write transition requires checked capture, observed evidence, valid completed evaluation, pause and explicit revocation', async t => {
  const f = fixture(t), id = await f.startRead();
  f.revoke(); await deny(() => f.upgrade(), /acceptance_execution_transition_not_allowed/);
  f.completeRead(id); await deny(() => f.upgrade(), /acceptance_execution_transition_not_allowed/);
  f.evaluateRead(id, { error: 'format_invalid', reply: null });
  assert.equal(f.receipt('read-paused').found, false); await deny(() => f.upgrade(), /acceptance_execution_transition_not_allowed/);
  f.store.transact(s => { s.discussions[0].turns = []; }); f.evaluateRead(id);
  f.store.transact(s => { s.bindings[1].authority.revokedAt = null; });
  await deny(() => f.upgrade(), /acceptance_execution_transition_not_allowed/);
  f.revoke();
  for (const edit of [s => { s.jobs[1].capture.complete = false; }, s => { s.jobs[1].readCopy.status = 'blocked'; },
    s => { s.discussions[0].evidence = []; }, s => { s.discussions[0].tasks[0].status = 'running'; }, s => { s.discussions[0].status = 'running'; }]) {
    const saved = f.store.read(); f.store.transact(edit); await deny(() => f.upgrade(), /acceptance_execution_transition_not_allowed/);
    f.store.transact(s => Object.assign(s, saved));
  }
  await f.upgrade(); assert.equal(f.count('register'), 2);
  await deny(() => f.upgrade()); assert.equal(f.count('register'), 2);
});

test('command approval pins raw string, directory, profile, owner digest and one durable choice per job', async t => {
  const f = fixture(t), id = await f.startRead(), confirmation = f.approval(id), saved = f.store.read();
  const edits = [a => { a.scope.command += ' && echo extra'; }, a => { a.params.command = ['node', 'check-boundary.mjs']; },
    a => { a.params.command += ' '; }, a => { a.scope.cwd = f.directory; }, a => { a.scope.profileId = 'webjjoku_copy'; }, a => { delete a.scope; }];
  for (const edit of edits) {
    f.store.transact(s => { Object.assign(s, structuredClone(saved)); edit(s.jobs[1].approvals[0]); });
    await deny(() => f.app.codex.decide(id, 'approval', 'accept', confirmation), /acceptance_execution_command_not_allowed/);
  }
  f.store.transact(s => Object.assign(s, saved));
  for (const change of [{ ownerConfirmed: false }, { expectedScopeDigest: hash('wrong') }])
    await deny(() => f.app.codex.decide(id, 'approval', 'accept', { ...confirmation, ...change }), /acceptance_execution_command_not_allowed/);
  assert.equal(f.count('decide'), 0); f.admission.reason = 'acceptance_time_limit';
  await f.app.codex.decide(id, 'approval', 'accept', confirmation); assert.equal(f.count('decide'), 1);
  const second = f.approval(id, 'second'); f.restart();
  await deny(() => f.app.codex.decide(id, 'second', 'accept', second), /acceptance_execution_command_not_allowed/);
  await f.app.codex.decide(id, 'second', 'decline'); assert.equal(f.count('decide'), 2);
  const w = fixture(t), writeId = await w.startWrite(), writeConfirmation = w.approval(writeId);
  assert.equal(w.job(writeId).approvals[0].scope.command, w.policy.execution.commands.write);
  await w.app.codex.decide(writeId, 'approval', 'accept', writeConfirmation); assert.equal(w.count('decide'), 1);
});

test('apply requires the exact one-file diff and preserves the single receipt across replay and restart', async t => {
  const f = fixture(t), id = await f.startWrite(); f.pendingDraft(id); const valid = structuredClone(f.diff);
  for (const edit of [d => { d.files = []; }, d => { d.files.push({ ...d.files[0], path: 'extra.txt' }); },
    d => { d.files[0].path = '../allowance.mjs'; }, d => { d.files[0].beforeDigest = null; },
    d => { d.files[0].afterDigest = hash('unapproved'); }, d => { d.diffDigest = hash('changed'); }]) {
    f.diff = structuredClone(valid); edit(f.diff);
    await deny(() => f.app.codex.applyDraft(id, valid.diffDigest, 'apply'), /acceptance_execution_application_not_allowed/);
  }
  assert.equal(f.count('applyDraft'), 0); assert.equal(readFileSync(join(f.root, 'allowance.mjs'), 'utf8'), before);
  f.diff = valid; f.admission.reason = 'acceptance_time_limit';
  const receipt = await f.app.codex.applyDraft(id, valid.diffDigest, 'apply');
  assert.equal(readFileSync(join(f.root, 'allowance.mjs'), 'utf8'), afterText); assert.equal(receipt.path, 'allowance.mjs');
  assert.equal(f.count('workspaceApply'), 1); f.restart();
  assert.deepEqual(await f.app.codex.applyDraft(id, valid.diffDigest, 'apply'), receipt);
  await deny(() => f.app.codex.applyDraft(id, valid.diffDigest, 'another-command'), /acceptance_execution_application_not_allowed/);
  assert.equal(f.count('workspaceApply'), 1);
  assert.equal(f.store.events(0).filter(e => e.type === 'codex.application_completed').length, 1);
});

test('admission and stop fence new work while drain permits approval/result until the hard deadline', async t => {
  const f = fixture(t), id = await f.startRead(), confirmation = f.approval(id), j = f.job(id);
  f.admission.reason = 'acceptance_request_limit';
  await deny(() => f.register(), /acceptance_execution_admission_closed/);
  await deny(() => f.app.codex.submit(f.input('write-task')), /acceptance_execution_admission_closed/);
  assert.throws(() => f.app.codex.beforeDispatch(f.store.read(), j), error => error instanceof AppError && error.code === 'acceptance_execution_admission_closed');
  f.app.codex.workScopeGuard(f.store.read(), j, 'approval');
  f.admission.deadlineReached = true;
  await deny(() => f.app.codex.decide(id, 'approval', 'accept', confirmation), /acceptance_execution_admission_closed/);
  assert.equal(f.count('decide'), 0); f.guard.stop();
  assert.notEqual(f.app.codex.beforeDispatch, f.originals.beforeDispatch);
  f.admission = { reason: null, deadlineReached: false }; await deny(() => f.app.codex.submit(f.input()), /acceptance_execution_admission_closed/);
  f.guard.close(); for (const name of wrapped) assert.equal(f.app.codex[name], f.originals[name]);
  assert.equal(f.app.codex.workspaces.apply, f.originalApply);
});

test('observation counts unresolved drafts as active and detects missing baseline or outside jobs/bindings', async t => {
  const f = fixture(t), id = await f.startRead(), saved = f.store.read();
  for (const status of ['queued', 'running', 'blocked_approval', 'reconciling']) {
    const s = structuredClone(saved); s.jobs[1].status = status; assert.equal(f.guard.observe(s).active, true);
  }
  for (const status of ['pending', 'applying', 'unconfirmed']) {
    const s = structuredClone(saved); s.jobs[1].status = 'completed'; s.jobs[1].draft = { status }; assert.equal(f.guard.observe(s).active, true);
  }
  const terminal = structuredClone(saved); terminal.jobs[1].status = 'failed'; assert.equal(f.guard.observe(terminal).active, false);
  for (const edit of [s => { s.jobs.shift(); }, s => { s.bindings.shift(); }]) {
    const s = structuredClone(saved); edit(s); assert.equal(f.guard.observe(s).reason, 'acceptance_execution_baseline_changed');
  }
  for (const edit of [s => { s.jobs.push({ id: 'outside-job', bindingId: 'outside-binding', status: 'queued' }); },
    s => { s.bindings.push({ id: 'outside-binding' }); }]) {
    const s = structuredClone(saved); edit(s); assert.equal(f.guard.observe(s).reason, 'acceptance_execution_scope_changed');
  }
  assert.equal(f.job(id).status, 'queued');
});

test('combined acceptance guard drains running jobs/pending drafts and awaits repeated deadline cancellation', async t => {
  for (const pendingDraft of [false, true]) {
    const f = fixture(t, { install: false });
    f.guard = acceptanceGuard(f.app, f.policy, { clock: () => f.time, intervalMs: 0, ErrorType: AppError });
    f.store.transact(s => f.app.dispatch.reserve(s, { requestId: 'model-reservation', roomId: f.policy.roomId, participantId: 'reviewer', participant: f.policy.participants[0] }));
    const id = pendingDraft ? await f.startWrite() : await f.startRead();
    if (pendingDraft) f.pendingDraft(id); else f.store.transact(s => { s.jobs.find(j => j.id === id).status = 'running'; });
    f.time += 1_500_000; assert.equal(f.guard.tick().active, true);
    assert.equal(f.store.read().resident.rooms[0].desiredOn, true); assert.equal(f.count('cancel'), 0);
    await deny(() => f.app.codex.submit(f.input('third-task')), /acceptance_execution_admission_closed/);
    let release; f.cancelWait = new Promise(resolve => { release = resolve; });
    f.time += 300_000; assert.equal(f.guard.tick().deadlineReached, true);
    const stop1 = f.guard.stop(), stop2 = f.guard.stop(); let settled = false;
    const stopped = Promise.all([stop1, stop2]).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.store.read().resident.rooms[0].desiredOn, false);
    if (!pendingDraft) { assert.equal(settled, false); assert.deepEqual(f.calls.filter(c => c.method === 'cancel').map(c => c.args.jobId), [id]); }
    release(); await stopped;
    if (pendingDraft) await deny(() => f.app.codex.applyDraft(id, f.diff.diffDigest, 'late-apply'), /acceptance_execution_admission_closed/);
    assert.equal(readFileSync(join(f.root, 'allowance.mjs'), 'utf8'), before);
  }
  const f = fixture(t, { install: false }), policy = { ...f.policy }; delete policy.execution;
  f.app.config.workspaceRoots = []; f.guard = acceptanceGuard(f.app, policy, { intervalMs: 0 });
  assert.throws(() => f.app.codex.beforeDispatch({}, {}), /acceptance_codex_not_authorized/);
});

test('the final protected-copy callback rejects deadline crossing and preserves synchronous and async source checks', async t => {
  for (const failure of ['deadline', 'original', 'async', 'thenable']) {
    const f = fixture(t), id = await f.startWrite(); f.pendingDraft(id);
    const deadline = f.time + 100;
    f.guard.close();
    f.guard = executionGuard(f.app, f.policy, { clock: () => f.time,
      admission: () => ({ reason: null, deadlineReached: f.time >= deadline }), ErrorType: AppError });
    f.beforeWrite = failure === 'deadline' ? () => { f.time = deadline; }
      : failure === 'async' ? () => Promise.reject(new Error('original async source proof rejected'))
      : failure === 'thenable' ? () => ({ then() {} })
      : () => { throw new Error('original source proof rejected'); };
    const reason = failure === 'deadline' ? /acceptance_execution_admission_closed/
      : ['async', 'thenable'].includes(failure) ? /protected_workspace_synchronous_guard_required/ : /original source proof rejected/;
    await deny(() => f.app.codex.applyDraft(id, f.diff.diffDigest, 'boundary-apply'), reason);
    assert.equal(readFileSync(join(f.root, 'allowance.mjs'), 'utf8'), before);
    assert.equal(f.store.readCommand('codex:apply:boundary-apply', { jobId: id, expectedDiffDigest: f.diff.diffDigest }).found, false);
  }
});
