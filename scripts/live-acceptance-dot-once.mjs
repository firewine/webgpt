// Operator-only composition over the existing transaction, dispatch and journal.
// This fences one task/request, not the identity of the remote execution actor.
import { acceptanceGuard } from './live-acceptance-guard.mjs';

export function dotOnceGuard(app, policy, options = {}) {
  const { promptFor, dotInputDigest, participantIdentity, ErrorType = Error } = options;
  const fail = code => { throw Object.assign(new ErrorType(code, 409), { code, status: 409 }); };
  const fields = ['version', 'discussionId', 'revision', 'taskId', 'phase', 'round', 'participantId', 'identityDigest',
    'roomEpoch', 'roomContextGeneration', 'topicContextGeneration', 'inputDigest'];
  const p = policy?.dotOnce;
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  if (!p || Object.keys(p).sort().join() !== fields.sort().join() || p.version !== 1 || p.phase !== 'cross_review' ||
      ![p.discussionId, p.taskId, p.participantId, policy.roomId].every(s => typeof s === 'string' && s.length > 0) ||
      ![p.revision, p.round, p.roomEpoch, p.roomContextGeneration, p.topicContextGeneration].every(positive) ||
      !hash(p.identityDigest) || !hash(p.inputDigest) || policy.maxRequests !== 1 || policy.execution !== undefined || policy.setup !== undefined ||
      policy.participants?.length !== 1 || policy.participants[0]?.kind !== 'dot-mcp' || policy.participants[0].id !== p.participantId ||
      !Array.isArray(policy.baselineLeases) || !Array.isArray(app.config.workspaceRoots) || app.config.workspaceRoots.length ||
      !positive(app.config.turnTimeoutMs) || app.config.turnTimeoutMs > 300000 ||
      ![promptFor, dotInputDigest, participantIdentity, app.start, app.engine.turn, app.engine.verify,
        app.dispatch.perform, app.dispatch.reserveTool, app.codex.register, app.codex.submit].every(f => typeof f === 'function'))
    fail('invalid_acceptance_dot_once_policy');
  // Capture, never replenish, even when the caller mutates its policy object.
  const frozen = structuredClone(policy), pin = frozen.dotOnce, baseline = new Set(frozen.baselineLeases);
  const timeout = app.config.turnTimeoutMs, participant = frozen.participants[0];
  if (participantIdentity(participant) !== pin.identityDigest) fail('invalid_acceptance_dot_once_identity');
  const command = { id: 'acceptance:dot-once:' + JSON.stringify([frozen.roomId, pin.discussionId, pin.taskId]), input: frozen };
  const previous = app.store.readCommand(command.id, command.input);
  const added = s => s.resident.dispatchLeases.filter(l => !baseline.has(l.id));
  let stopped = false, admitting = false;
  function scope(s, preparing = false, performing = false) {
    const room = s.resident.rooms.find(r => r.id === frozen.roomId);
    const d = s.discussions.find(d => d.id === pin.discussionId), task = d?.tasks.find(t => t.id === pin.taskId);
    const context = d?.contexts.find(c => c.participantId === pin.participantId);
    if (app.config.turnTimeoutMs !== timeout || app.config.workspaceRoots.length ||
        !room || !d || !task || !context || d.roomId !== room.id || room.topicLink !== d.id ||
        !(room.desiredOn ? room.epoch === pin.roomEpoch : preparing && room.epoch + 1 === pin.roomEpoch) ||
        (room.contexts?.find(c => c.participantId === pin.participantId)?.generation ?? 1) !== pin.roomContextGeneration ||
        context.generation !== pin.topicContextGeneration || d.revision !== pin.revision || task.revision !== pin.revision ||
        d.phase !== pin.phase || task.phase !== pin.phase || d.round !== pin.round || task.round !== pin.round ||
        task.participantId !== pin.participantId || task.status !== (performing ? 'running' : 'pending') ||
        task.reason === 'format_retry' || task.method === 'codex' || task.jobId || d.excludedIds.includes(pin.participantId) ||
        !(preparing ? ['running', 'paused', 'blocked'].includes(d.status) : d.status === 'running') ||
        !room.members.some(m => m.participantId === pin.participantId && m.enabled && !m.blockedReason) ||
        ![d.members.find(m => m.id === pin.participantId), s.participants.find(m => m.id === pin.participantId)]
          .every(m => m && participantIdentity(m) === pin.identityDigest) ||
        !s.connections.some(c => c.id === participant.connectionId && c.kind === 'dot-mcp')) fail('acceptance_dot_once_scope_changed');
    if (dotInputDigest(promptFor(d, task), context.history) !== pin.inputDigest) fail('acceptance_dot_once_input_changed');
    return { room, d, task };
  }
  const initial = app.store.read();
  if (!previous.found && added(initial).length) fail('acceptance_dot_once_unrecorded_request');
  if (!added(initial).length) scope(initial, true);
  const originals = { start: app.start, turn: app.engine.turn, verify: app.engine.verify,
    reserve: app.dispatch.reserve, perform: app.dispatch.perform, reserveTool: app.dispatch.reserveTool,
    register: app.codex.register, submit: app.codex.submit };
  const guard = acceptanceGuard(app, frozen, options), reserve = app.dispatch.reserve;
  try {
    app.store.transact((_s, emit) => {
      emit({ type: 'acceptance.dot_once_scope', discussionId: pin.discussionId, data: { taskId: pin.taskId } });
      return { taskId: pin.taskId };
    }, command);
  } catch (error) { guard.close(); throw error; }
  function admission(s) {
    if (stopped) fail('acceptance_stopped');
    const observed = guard.observe(s);
    if (observed.reason) fail(observed.reason);
  }
  app.start = function (...args) {
    const s = app.store.read(); admission(s); scope(s, true);
    // Recovery can connect existing Codex jobs before beforeDispatch runs.
    if (s.jobs.some(j => ['queued', 'running', 'blocked_approval', 'reconciling'].includes(j.status)))
      fail('acceptance_dot_once_existing_codex_work');
    return originals.start.apply(this, args);
  };
  // The engine verifies sources and reserves tools before calling turn.
  // This cross_review-only policy admits neither operation, for any task.
  const denyVerification = () => fail('acceptance_dot_once_verification_not_allowed');
  app.engine.verify = async () => denyVerification(); app.dispatch.reserveTool = denyVerification;
  // TypeScript-private turn is accessible in the compiled operator process;
  // this temporary wrapper is deliberately not a product API.
  app.engine.turn = async function (discussionId, taskId) {
    const s = app.store.read(); admission(s);
    if (admitting || discussionId !== pin.discussionId || taskId !== pin.taskId) fail('acceptance_dot_once_task_not_allowed');
    scope(s); admitting = true;
    try { return originals.turn.call(this, discussionId, taskId); }
    finally { admitting = false; }
  };
  app.dispatch.reserve = (s, input, now) => {
    try {
      admission(s);
      if (!admitting || input.kind !== 'topic' || input.roomId !== frozen.roomId || input.participantId !== pin.participantId ||
          input.generation !== pin.topicContextGeneration || !input.participant || participantIdentity(input.participant) !== pin.identityDigest)
        fail('acceptance_dot_once_reservation_not_allowed');
      scope(s);
      return reserve(s, input, now);
    } catch (error) { return error.code ?? 'acceptance_dot_once_reservation_not_allowed'; }
  };
  app.dispatch.perform = async function (store, provider, input) {
    try {
      const s = app.store.read(), leases = added(s), lease = leases[0];
      const observed = guard.observe(s);
      if (stopped || observed.reason !== 'acceptance_request_limit' || observed.deadlineReached ||
          store !== app.store || provider !== app.providers || leases.length !== 1 || lease.id !== input.requestId ||
          lease.ownerKind !== 'topic' || lease.ownerAttemptId !== lease.id || lease.roomId !== frozen.roomId ||
          lease.participantId !== pin.participantId || lease.generation !== pin.topicContextGeneration || lease.state !== 'reserved' || lease.invokedAt)
        fail('acceptance_dot_once_dispatch_not_allowed');
      const { d, task } = scope(s, false, true), turn = d.turns.find(t => t.id === lease.id);
      const request = s.dotMcp?.requests?.items.find(r => r.id === lease.id);
      if (!turn || task.turnId !== turn.id || turn.taskId !== pin.taskId || turn.participantId !== pin.participantId ||
          turn.revision !== pin.revision || turn.phase !== pin.phase || turn.round !== pin.round || turn.generation !== pin.topicContextGeneration ||
          turn.status !== 'prepared' || turn.dispatchStartedAt || !request || request.status !== 'prepared' ||
          request.discussionId !== pin.discussionId || request.revision !== pin.revision || request.roomId !== frozen.roomId ||
          request.participantId !== pin.participantId || request.connectionId !== participant.connectionId || request.identityDigest !== pin.identityDigest ||
          request.epoch !== pin.roomEpoch || request.contextGeneration !== pin.roomContextGeneration || request.generation !== pin.topicContextGeneration ||
          !input.participant || participantIdentity(input.participant) !== pin.identityDigest || input.prompt !== turn.prompt ||
          request.prompt !== turn.prompt || request.inputDigest !== pin.inputDigest ||
          dotInputDigest(request.prompt, request.history) !== pin.inputDigest || dotInputDigest(input.prompt, input.history) !== pin.inputDigest)
        fail('acceptance_dot_once_dispatch_input_changed');
    } catch (failure) { return { result: null, failure, uncertain: false }; }
    return originals.perform.call(this, store, provider, input);
  };
  const denyCodex = () => fail('acceptance_codex_not_authorized');
  app.codex.register = async () => denyCodex(); app.codex.submit = denyCodex;
  function stop() { stopped = true; return guard.stop(); }
  const unsubscribe = app.store.subscribe(event => {
    if (event.type !== 'turn.finished' || event.discussionId !== pin.discussionId) return;
    const s = app.store.read(), leases = added(s), turn = s.discussions.find(d => d.id === pin.discussionId)?.turns.find(t => t.id === event.data.turnId);
    // Store listeners run synchronously after COMMIT: parsing and settle have
    // completed. A mailbox reply or receipt must never switch the room off.
    if (leases.length === 1 && leases[0].id === turn?.id && turn.taskId === pin.taskId && turn.finishedAt &&
        ['completed', 'failed', 'unconfirmed', 'stale'].includes(turn.status) && ['released', 'unconfirmed'].includes(leases[0].state)) void stop();
  });
  return { observe: guard.observe, tick: guard.tick, stop,
    // Caller ordering: await guard.stop(); await app.close(); guard.close().
    close() {
      stopped = true; unsubscribe(); guard.close();
      app.start = originals.start; app.engine.turn = originals.turn; app.dispatch.reserve = originals.reserve; app.dispatch.perform = originals.perform;
      app.engine.verify = originals.verify; app.dispatch.reserveTool = originals.reserveTool;
      app.codex.register = originals.register; app.codex.submit = originals.submit;
    } };
}
