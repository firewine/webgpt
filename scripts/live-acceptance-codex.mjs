// Temporary acceptance policy over the existing executor. No alternative RPC,
// approval, application, schema or authority path is introduced here.
import { realpathSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const ACTIVE = ['queued', 'running', 'blocked_approval', 'reconciling'];
const DRAFT_ACTIVE = ['preparing', 'running', 'pending', 'applying', 'unconfirmed'];
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ids = value => Array.isArray(value) && value.every(x => typeof x === 'string' && x.length) && new Set(value).size === value.length;
const fail = code => { throw Object.assign(new Error(code), { code, status: 409 }); };

export function validateExecutionPolicy(policy, config) {
  if (policy?.execution === undefined) {
    if (config.workspaceRoots.length) fail('acceptance_requires_no_codex_roots');
    return;
  }
  const p = policy.execution;
  const fields = ['version', 'runId', 'root', 'branch', 'head', 'baselineJobs', 'baselineBindings', 'commands', 'applyPath', 'applyBeforeDigest', 'applyAfterDigest'];
  if (!p || Object.keys(p).some(k => !fields.includes(k)) || p.version !== 1 ||
      typeof p.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.runId) ||
      typeof p.root !== 'string' || !isAbsolute(p.root) || normalize(p.root) !== p.root ||
      typeof p.branch !== 'string' || !p.branch || ['main', 'master'].includes(p.branch) ||
      typeof p.head !== 'string' || !/^[a-f0-9]{40}$/.test(p.head) ||
      !ids(p.baselineJobs) || !ids(p.baselineBindings) ||
      !p.commands || Object.keys(p.commands).sort().join(',') !== 'read,write' ||
      ['read', 'write'].some(k => typeof p.commands[k] !== 'string' || !p.commands[k].trim() || p.commands[k].length > 30_000) ||
      p.commands.read === p.commands.write || typeof p.applyPath !== 'string' ||
      !/^[a-zA-Z0-9_-]+\.(?:mjs|txt)$/.test(p.applyPath) ||
      !hash(p.applyBeforeDigest) || !hash(p.applyAfterDigest) || p.applyBeforeDigest === p.applyAfterDigest)
    fail('invalid_acceptance_execution_policy');
  let root;
  try { root = realpathSync(p.root); } catch { fail('acceptance_execution_root_missing'); }
  if (root !== p.root || config.workspaceRoots.length !== 1 || config.workspaceRoots[0] !== root)
    fail('acceptance_execution_root_mismatch');
}

export function executionGuard(app, policy, { clock = Date.now, admission = () => ({ reason: null, deadlineReached: false }), ErrorType = Error } = {}) {
  const fail = code => { throw Object.assign(new ErrorType(code, 409), { code, status: 409 }); };
  validateExecutionPolicy(policy, app.config);
  if (!policy.execution) fail('acceptance_execution_opt_in_required');
  const p = structuredClone(policy.execution), baselineJobs = new Set(p.baselineJobs), baselineBindings = new Set(p.baselineBindings);
  // The same run cannot be restarted with replenished counters, another roster
  // or a longer window: existing journal keys reject any changed policy input.
  const receiptInput = structuredClone(policy);
  const key = suffix => `acceptance:${p.runId}:${suffix}`;
  const receipt = suffix => app.store.readCommand(key(suffix), receiptInput);
  const record = (suffix, value) => app.store.transact((_s, emit) => {
    emit({ type: 'acceptance.execution_scope', discussionId: null, data: { runId: p.runId, step: suffix } });
    return value;
  }, { id: key(suffix), input: receiptInput });
  const originals = Object.fromEntries(['register', 'submit', 'decide', 'applyDraft', 'steer', 'beforeDispatch', 'workScopeGuard'].map(k => [k, app.codex[k]]));
  const originalWorkspaceApply = app.codex.workspaces?.apply;
  if (typeof originalWorkspaceApply !== 'function') fail('acceptance_execution_application_guard_required');
  let closed = false, registering = false, fault = null;
  const jobs = s => s.jobs.filter(j => !baselineJobs.has(j.id));
  const bindingPin = () => { const value = receipt('binding'); return value.found ? value.result : null; };
  const topicPin = () => { const value = receipt('topic'); return value.found ? value.result : null; };
  const initial = app.store.read();
  if (p.baselineJobs.some(id => !initial.jobs.some(j => j.id === id)) || p.baselineBindings.some(id => !initial.bindings.some(b => b.id === id)))
    fail('acceptance_execution_baseline_changed');
  if (receipt('register-intent').found && !bindingPin()) fail('acceptance_execution_registration_unconfirmed');

  function gate(drain = false) {
    const observed = admission();
    if (closed || fault || observed.deadlineReached || !drain && observed.reason) fail('acceptance_execution_admission_closed');
  }
  function binding(s, epoch) {
    const pin = bindingPin(), added = s.bindings.filter(b => !baselineBindings.has(b.id));
    const b = pin && s.bindings.find(b => b.id === pin.bindingId);
    if (!b || added.length !== 1 || added[0].id !== pin.bindingId || b.threadId !== pin.threadId ||
        b.cwd !== p.root || b.repoRoot !== p.root || b.branch !== p.branch || b.head !== p.head ||
        b.host !== pin.host || b.user !== pin.user ||
        ![1, 2].includes(b.authority?.epoch) || epoch !== undefined && b.authority.epoch !== epoch ||
        b.allowWrite !== (b.authority.epoch === 2) || b.protection?.status !== 'ready' ||
        !b.allowWrite && b.readProtection !== 1) fail('acceptance_execution_binding_changed');
    if (b.authority.epoch === 2 && !receipt('write-ready').found) fail('acceptance_execution_transition_unconfirmed');
    return b;
  }
  function topic(s, input, b, pinNow = false) {
    const d = s.discussions.find(d => d.id === input.discussionId), t = d?.tasks.find(t => t.id === input.taskId);
    if (!d || d.roomId !== policy.roomId || d.revision !== input.revision || d.executionBindingId !== b.id ||
        !t || t.phase !== 'verification' || t.method !== 'codex' || t.id !== input.requestId ||
        !policy.participants.some(p => p.id === t.participantId) || d.members.length !== policy.participants.length ||
        d.members.some(m => !policy.participants.some(p => p.id === m.id)) ||
        d.limits.maxRounds !== 1 || d.limits.maxVerificationTasks !== 2 || d.limits.maxToolJobs !== 2)
      fail('acceptance_execution_topic_mismatch');
    const pin = topicPin();
    if (pin && (pin.discussionId !== d.id || pin.revision !== d.revision)) fail('acceptance_execution_topic_changed');
    if (!pin && pinNow) record('topic', { discussionId: d.id, revision: d.revision });
    return d;
  }
  function check(s, j, { drain = false } = {}) {
    gate(drain);
    if (baselineJobs.has(j.id)) fail('acceptance_execution_job_not_allowed');
    const added = jobs(s), index = added.findIndex(x => x.id === j.id);
    if (index < 0 || index > 1 || added.length > 2 || added.some(x => x.bindingId !== j.bindingId)) fail('acceptance_execution_job_limit');
    const b = binding(s, index + 1), pin = topicPin();
    if (!pin || j.threadId !== b.threadId || j.authority?.binding?.epoch !== index + 1 ||
        j.discussionId !== pin.discussionId || j.revision !== pin.revision || j.maxDurationMs > app.config.turnTimeoutMs)
      fail('acceptance_execution_job_scope_changed');
    topic(s, j, b);
    if (index === 1 && (added[0].status !== 'completed' || !added[0].capture?.complete || added[0].readCopy?.status !== 'checked'))
      fail('acceptance_execution_read_incomplete');
    return { b, index };
  }
  function observe(s) {
    const added = jobs(s), pin = bindingPin(), newBindings = s.bindings.filter(b => !baselineBindings.has(b.id));
    let reason = fault;
    if (p.baselineJobs.some(id => !s.jobs.some(j => j.id === id)) || p.baselineBindings.some(id => !s.bindings.some(b => b.id === id))) reason = 'acceptance_execution_baseline_changed';
    else if (added.length > 2 || added.length && !pin || added.some(j => j.bindingId !== pin?.bindingId) ||
        newBindings.length > 1 || newBindings.some(b => pin && b.id !== pin.bindingId)) reason = 'acceptance_execution_scope_changed';
    else if (newBindings.length && !pin && !registering) reason = 'acceptance_execution_registration_unconfirmed';
    return { reason, jobs: added.length, active: registering || added.some(j => ACTIVE.includes(j.status) || DRAFT_ACTIVE.includes(j.draft?.status)) };
  }
  // Intent precedes thread/start. A crash between intent and pin blocks another
  // registration instead of replacing a thread whose creation is uncertain.
  app.codex.register = async function (input) {
    gate();
    if (!input || Object.keys(input).some(k => !['cwd', 'label', 'sessionMode', 'allowWrite', 'expiresInHours', 'threadId'].includes(k)) ||
        registering || realpathSync(input.cwd) !== p.root || input.cwd !== p.root || input.expiresInHours !== 1)
      fail('acceptance_execution_registration_not_allowed');
    const s = app.store.read(), pin = bindingPin();
    if (!pin) {
      if (input.sessionMode !== 'new' || input.threadId !== undefined || input.allowWrite !== false ||
          receipt('register-intent').found || s.bindings.some(b => !baselineBindings.has(b.id)) || jobs(s).length)
        fail('acceptance_execution_registration_not_allowed');
      record('register-intent', { startedAt: new Date(clock()).toISOString() });
    } else {
      const b = binding(s, 1), previous = jobs(s);
      const d = s.discussions.find(d => d.id === topicPin()?.discussionId);
      if (input.sessionMode !== 'existing' || input.threadId !== pin.threadId || input.allowWrite !== true ||
          !b.authority.revokedAt || previous.length !== 1 || previous[0].status !== 'completed' ||
          !previous[0].capture?.complete || previous[0].readCopy?.status !== 'checked' ||
          !receipt('read-observed').found || !receipt('read-paused').found || d?.status !== 'paused' ||
          !d?.evidence.some(e => e.source === `codex:${previous[0].id}`) ||
          !d.tasks.some(t => t.id === previous[0].taskId && t.status === 'completed') || receipt('write-intent').found)
        fail('acceptance_execution_transition_not_allowed');
      record('write-intent', { bindingId: b.id, threadId: b.threadId });
    }
    registering = true;
    try {
      const id = await originals.register.call(this, input), after = app.store.read(), b = after.bindings.find(b => b.id === id);
      if (!b || b.cwd !== p.root || b.repoRoot !== p.root || b.branch !== p.branch || b.head !== p.head ||
          b.allowWrite !== !!pin || b.authority?.epoch !== (pin ? 2 : 1) || !b.threadId ||
          pin && (b.id !== pin.bindingId || b.threadId !== pin.threadId)) fail('acceptance_execution_registration_changed');
      if (!pin) record('binding', { bindingId: b.id, threadId: b.threadId, host: b.host, user: b.user });
      else record('write-ready', { bindingId: b.id, threadId: b.threadId, authority: b.authority });
      return id;
    } finally { registering = false; }
  };
  app.codex.submit = function (input) {
    gate();
    const s = app.store.read(), added = jobs(s), b = binding(s), prior = added.find(j => j.requestId === input.requestId);
    if (input.bindingId !== b.id || input.grantId || !input.maxDurationMs || input.maxDurationMs > app.config.turnTimeoutMs)
      fail('acceptance_execution_job_scope_changed');
    topic(s, input, b, true);
    if (!prior && (added.length >= 2 || b.authority.epoch !== added.length + 1)) fail('acceptance_execution_job_limit');
    if (!prior && added.length && (added[0].status !== 'completed' || !added[0].capture?.complete || added[0].readCopy?.status !== 'checked'))
      fail('acceptance_execution_read_incomplete');
    return originals.submit.call(this, input);
  };
  app.codex.beforeDispatch = function (s, j) { check(s, j); originals.beforeDispatch?.call(this, s, j); };
  app.codex.workScopeGuard = function (s, j, phase) { check(s, j, { drain: ['approval', 'result'].includes(phase) }); originals.workScopeGuard?.call(this, s, j, phase); };
  app.codex.decide = function (jobId, approvalId, decision, confirmation) {
    if (decision === 'accept') {
      const s = app.store.read(), j = s.jobs.find(j => j.id === jobId);
      if (!j) fail('acceptance_execution_job_not_allowed');
      const { b } = check(s, j, { drain: true }), a = j.approvals.find(a => a.id === approvalId), scope = a?.scope;
      if (!scope || scope.command !== p.commands[b.allowWrite ? 'write' : 'read'] || a.params.command !== scope.command ||
          scope.cwd !== p.root || scope.profileId !== (b.allowWrite ? 'webjjoku_copy' : 'webjjoku_read') ||
          confirmation?.ownerConfirmed !== true || confirmation.expectedScopeDigest !== scope.digest ||
          j.approvals.some(a => a.scope?.choice)) fail('acceptance_execution_command_not_allowed');
    }
    return originals.decide.call(this, jobId, approvalId, decision, confirmation);
  };
  app.codex.applyDraft = async function (jobId, expectedDiffDigest, commandId) {
    const s = app.store.read(), j = s.jobs.find(j => j.id === jobId);
    if (!j) fail('acceptance_execution_job_not_allowed');
    const { index } = check(s, j, { drain: true });
    if (app.store.readCommand('codex:apply:' + commandId, { jobId, expectedDiffDigest }).found)
      return originals.applyDraft.call(this, jobId, expectedDiffDigest, commandId);
    if (index !== 1 || j.draft?.status !== 'pending' || s.jobs.some(j => !baselineJobs.has(j.id) && j.draft?.receipt))
      fail('acceptance_execution_application_not_allowed');
    const diff = await this.inspectDraft(jobId); gate(true);
    const f = diff.files?.[0];
    if (diff.diffDigest !== expectedDiffDigest || diff.files.length !== 1 || f.path !== p.applyPath ||
        f.beforeDigest !== p.applyBeforeDigest || f.afterDigest !== p.applyAfterDigest)
      fail('acceptance_execution_application_not_allowed');
    return originals.applyDraft.call(this, jobId, expectedDiffDigest, commandId);
  };
  // Topic jobs do not use WorkExecutionBridge's work-only hook. Compose the
  // acceptance gate with the protected workspace's existing synchronous final
  // callback, after repository/authority checks and immediately before write.
  app.codex.workspaces.apply = function (jobId, expectedDiffDigest, beforeWrite) {
    return originalWorkspaceApply.call(this, jobId, expectedDiffDigest, () => {
      const result = beforeWrite?.();
      const s = app.store.read(), j = s.jobs.find(j => j.id === jobId);
      if (!j || j.draft?.status !== 'applying' || j.draft.diffDigest !== expectedDiffDigest)
        fail('acceptance_execution_application_not_allowed');
      check(s, j, { drain: true });
      return result; // Preserve the workspace's rejection of async callbacks.
    });
  };
  app.codex.steer = function () { fail('acceptance_execution_steer_not_allowed'); };
  // Store listeners run synchronously AFTER commit and before Core's next
  // iteration. Pause after the first result evaluation, before job2 can acquire
  // readonly authority. The evidence was already validated by Core at capture;
  // its historical seal is never rewritten to the later write authority.
  const unsubscribe = app.store.subscribe(event => {
    if (closed || !['evidence.added', 'turn.finished'].includes(event.type)) return;
    try {
      const s = app.store.read(), first = jobs(s)[0], pin = topicPin();
      if (!first || !pin || event.discussionId !== pin.discussionId) return;
      const d = s.discussions.find(d => d.id === pin.discussionId);
      if (event.type === 'evidence.added' && event.data.jobId === first.id && !receipt('read-observed').found) {
        check(s, first, { drain: true });
        const e = d.evidence.find(e => e.source === `codex:${first.id}`);
        if (first.status !== 'completed' || !first.capture?.complete || first.readCopy?.status !== 'checked' || !e)
          fail('acceptance_execution_read_incomplete');
        record('read-observed', { bindingId: first.bindingId, threadId: first.threadId, jobId: first.id,
          discussionId: d.id, revision: d.revision, taskId: first.taskId, authority: first.authority,
          readCopy: first.readCopy, capture: first.capture, evidenceId: e.id, eventId: event.id,
          evidenceTextDigest: createHash('sha256').update(e.text).digest('hex') });
      }
      if (event.type === 'turn.finished' && receipt('read-observed').found && !receipt('read-paused').found) {
        const t = d.turns.find(t => t.id === event.data.turnId), task = d.tasks.find(t => t.id === first.taskId);
        if (t?.taskId === first.taskId && t.status === 'completed' && t.reply && !t.error && task.status === 'completed') {
          app.engine.control(d.id, { action: 'pause', expectedRevision: d.revision }, randomUUID());
          record('read-paused', { discussionId: d.id, revision: d.revision, taskId: task.id, turnId: t.id });
        }
      }
    } catch { fault = 'acceptance_execution_observation_requires_review'; }
  });
  const first = observe(initial);
  if (first.reason) { unsubscribe(); app.codex.workspaces.apply = originalWorkspaceApply; for (const [k, original] of Object.entries(originals)) app.codex[k] = original; fail(first.reason); }
  return {
    observe,
    stop() { closed = true; },
    close() { closed = true; unsubscribe(); app.codex.workspaces.apply = originalWorkspaceApply; for (const [k, original] of Object.entries(originals)) app.codex[k] = original; }
  };
}
