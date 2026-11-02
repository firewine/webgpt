// Opt-in, process-local acceptance control. No product quota or DB schema change.
// Counts durable reservations, conservatively including not-sent/failed turns.
export function acceptanceGuard(app, policy, { clock = Date.now, intervalMs = 250, log = () => {}, normalizeMember = p => p } = {}) {
  const positive = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;
  if (!policy || typeof policy.roomId !== 'string' || !Array.isArray(policy.baselineLeases) ||
      !policy.baselineLeases.every(x => typeof x === 'string') || new Set(policy.baselineLeases).size !== policy.baselineLeases.length ||
      !positive(policy.maxRequests, 40) || !positive(policy.maxApiRequests, 8) || !positive(policy.maxMs, 30 * 60_000) ||
      !positive(policy.drainMs, policy.maxMs - 1) || policy.drainMs < app.config.turnTimeoutMs || !Array.isArray(policy.participants) || !policy.participants.length ||
      new Set(policy.participants.map(p => p.id)).size !== policy.participants.length || policy.participants.some(p =>
        !p.id || !p.connectionId || !p.modelId || !['openai-oauth', 'codex-oauth', 'deepseek', 'browser', 'dot-mcp'].includes(p.kind) ||
        p.kind === 'deepseek' && p.reasoningEffort !== 'high')) throw new Error('invalid_acceptance_policy');
  const baseline = new Set(policy.baselineLeases);
  const original = app.dispatch.reserve.bind(app.dispatch);
  const originalCodex = app.codex.beforeDispatch;
  let timer, lastLog = '';
  const identity = member => { const p = member && normalizeMember(member); return JSON.stringify([p?.id, p?.connectionId, p?.kind, p?.modelId, p?.reasoningEffort ?? null, p?.maxOutputTokens ?? null]); };
  function observe(state) {
    const room = state.resident?.rooms.find(r => r.id === policy.roomId);
    const leases = state.resident?.dispatchLeases ?? [];
    if (!room || policy.baselineLeases.some(id => !leases.some(l => l.id === id))) return { reason: 'acceptance_baseline_changed', requests: 0, apiRequests: 0, active: false };
    const added = leases.filter(l => !baseline.has(l.id));
    const entries = added.map(l => room.ledger?.find(e => e.requestId === l.id));
    const invalid = added.some(l => l.roomId !== room.id || !policy.participants.some(p => p.id === l.participantId)) || entries.some(e => !Number.isFinite(Date.parse(e?.reservedAt)));
    const first = added.length && !invalid ? Math.min(...entries.map(e => Date.parse(e.reservedAt))) : null;
    const elapsed = first === null ? 0 : Math.max(0, clock() - first);
    const apiRequests = added.filter(l => policy.participants.find(p => p.id === l.participantId)?.kind === 'deepseek').length;
    const active = added.some(l => ['reserved', 'running'].includes(l.state));
    const reason = invalid ? 'acceptance_scope_changed' : elapsed >= policy.maxMs - policy.drainMs ? 'acceptance_time_limit' : added.length >= policy.maxRequests ? 'acceptance_request_limit' : null;
    return { reason, requests: added.length, apiRequests, active, elapsed, deadlineReached: first !== null && elapsed >= policy.maxMs };
  }
  // Called inside the existing state/event/idempotency transaction, BEFORE the
  // original reservation and native dot preparation. No extra dispatch path.
  const reserve = (state, input, now) => {
    const observation = observe(state);
    if (observation.reason) return observation.reason;
    const member = input.participant ?? state.participants.find(p => p.id === input.participantId);
    const allowed = policy.participants.find(p => p.id === input.participantId);
    if (input.roomId !== policy.roomId || !allowed || identity(member) !== identity(allowed)) return 'acceptance_participant_not_allowed';
    if (allowed.kind === 'deepseek' && observation.apiRequests >= policy.maxApiRequests) return 'acceptance_api_limit';
    return original(state, input, now);
  };
  function stop() {
    const state = app.store.read();
    const room = state.resident.rooms.find(r => r.id === policy.roomId);
    if (room?.desiredOn) app.resident.control(room.id, { action: 'off', expectedVersion: room.version }, crypto.randomUUID());
    for (const d of app.store.read().discussions) if (d.roomId === policy.roomId && d.status === 'running')
      app.engine.control(d.id, { action: 'pause', expectedRevision: d.revision }, crypto.randomUUID());
  }
  function tick() {
    const observation = observe(app.store.read());
    if (observation.reason && (!observation.active || observation.deadlineReached)) stop();
    const line = JSON.stringify({ reason: observation.reason, requests: observation.requests, apiRequests: observation.apiRequests, active: observation.active });
    if (line !== lastLog) { lastLog = line; log(JSON.parse(line)); }
    return observation;
  }
  // Validate before enabling, and keep the normal scheduler/engine/provider
  // adapters. Every Codex dispatch is denied for this acceptance process.
  if (observe(app.store.read()).reason === 'acceptance_baseline_changed') throw new Error('acceptance_baseline_changed');
  app.dispatch.reserve = reserve;
  app.codex.beforeDispatch = () => { throw new Error('acceptance_codex_not_authorized'); };
  if (intervalMs > 0) { timer = setInterval(() => { try { tick(); } catch { stop(); } }, intervalMs); timer.unref(); }
  return { observe, tick, stop, close() { clearInterval(timer); app.dispatch.reserve = original; app.codex.beforeDispatch = originalCodex; } };
}
