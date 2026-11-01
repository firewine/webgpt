import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// This inspects recorded local metadata. It never probes a provider, resumes a
// discussion, changes a room, creates an owner key or starts an execution.
export async function readReadiness(config, { port = process.env.WJ_PORT ?? '3000', request = fetch } = {}) {
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) return unavailable('invalid_local_port');
  let token;
  try { token = config.accessToken ?? (await readFile(join(config.stateDir, 'access-token'), 'utf8')).trim(); }
  catch { return unavailable('owner_key_unavailable'); }
  if (typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token)) return unavailable('owner_key_unavailable');
  const origin = `http://127.0.0.1:${number}`;
  // The default application port may belong to another service on this host.
  // Check its public identity before sending any owner authorization header.
  try {
    const health = await request(origin + '/health', { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!health.ok) { await health.body?.cancel().catch(() => {}); return unavailable('unexpected_local_service'); }
    const value = await boundedJson(health);
    if (value?.status !== 'ok' || value.service !== 'webjjoku' || value.mode !== 'workspace' || value.persistence !== 'sqlite') return unavailable('unexpected_local_service');
  } catch { return unavailable('local_state_unavailable'); }
  let response;
  try { response = await request(origin + '/api/state', { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(3000) }); }
  catch { return unavailable('local_state_unavailable'); }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); return { ...unavailable([401, 403].includes(response.status) ? 'owner_auth_required' : 'local_state_unavailable'), httpStatus: response.status }; }
  try { return projectReadiness(await boundedJson(response), config); }
  catch { return unavailable('invalid_local_state'); }
}

function unavailable(reason) { return { status: 'unavailable', reason, modelCalls: 0 }; }
async function boundedJson(response) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('missing_body');
  let size = 0; const chunks = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1_000_000) throw new Error('state_too_large'); chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export function projectReadiness(state, config) {
  for (const key of ['connections', 'participants', 'discussions', 'bindings', 'jobs']) if (!Array.isArray(state?.[key])) throw new Error('invalid_state');
  if (typeof state.resident?.enabled !== 'boolean' || !Array.isArray(state.resident.rooms)) throw new Error('invalid_state');
  const gpt = kind => ['openai-oauth', 'codex-oauth'].includes(kind);
  const connected = state.connections.filter(c => c && typeof c.id === 'string' && c.status === 'connected' && Array.isArray(c.models) && c.models.some(m => typeof m?.id === 'string'));
  const participants = state.participants.filter(p => p && p.kind !== 'fake' && connected.some(c => c.id === p.connectionId && c.kind === p.kind && c.models.some(m => m?.id === p.modelId)));
  const gptParticipants = participants.filter(p => gpt(p.kind));
  const distinctEmails = new Set(gptParticipants.map(p => connected.find(c => c.id === p.connectionId)?.email).filter(e => typeof e === 'string' && e.includes('@')).map(e => e.trim().toLowerCase())).size;
  const activeDiscussions = state.discussions.filter(d => ['running', 'paused', 'blocked'].includes(d?.status)).length;
  const activeJobs = state.jobs.filter(j => ['queued', 'running', 'blocked_approval', 'reconciling'].includes(j?.status)).length;
  const enabledRooms = state.resident.rooms.filter(r => r?.desiredOn === true).length;
  const topicIssues = [];
  if (gptParticipants.length < 2) topicIssues.push('two_gpt_participants_required');
  if (gptParticipants.length >= 2 && distinctEmails < 2) topicIssues.push('distinct_gpt_identities_require_confirmation');
  if (!participants.some(p => p.kind === 'deepseek')) topicIssues.push('deepseek_participant_required');
  if (activeDiscussions) topicIssues.push('existing_discussion_requires_owner_action');
  if (activeJobs) topicIssues.push('existing_execution_requires_reconciliation');
  if (enabledRooms) topicIssues.push('resident_room_is_on');
  const roomIssues = [];
  if (!state.resident.enabled) roomIssues.push('resident_feature_disabled');
  if (!state.resident.rooms.some(r => (r?.budgetMode === 'api-daily' || r?.budgets) && r?.pacing && Array.isArray(r.members) && r.members.some(m => m?.enabled === true && participants.some(p => p.id === m.participantId)))) roomIssues.push('room_members_budget_and_pacing_required');
  const browserCount = connected.filter(c => c.kind === 'browser').length;
  const browserIssues = [];
  if (browserCount < 2) browserIssues.push('dot_and_muse_connections_required');
  if (state.browserPaused) browserIssues.push('browser_manual_control_active');
  const codexIssues = [];
  if (!state.capabilities?.codexConfigured) codexIssues.push('workspace_roots_required');
  if (!state.bindings.some(b => b?.status === 'ready' && b.allowWrite === false)) codexIssues.push('ready_read_only_binding_required');
  if (activeJobs) codexIssues.push('existing_execution_requires_reconciliation');
  return { status: 'observed', evidence: 'stored_metadata_only', modelCalls: 0,
    connections: { gptWithModels: connected.filter(c => gpt(c.kind)).length, deepseekWithModels: connected.filter(c => c.kind === 'deepseek').length, browserWithModels: browserCount, anthropicWithModels: connected.filter(c => c.kind === 'anthropic').length },
    participants: { readyGpt: gptParticipants.length, recordedDistinctGptEmails: distinctEmails, readyDeepseek: participants.filter(p => p.kind === 'deepseek').length, readyBrowser: participants.filter(p => p.kind === 'browser').length, fake: state.participants.filter(p => p?.kind === 'fake').length },
    topic: { recordedPrerequisitesMet: topicIssues.length === 0, issues: topicIssues, activeOrBlockedDiscussions: activeDiscussions, unconfirmedTurnAcceptance: 'UNVERIFIED_BY_DOCTOR' },
    resident: { enabled: state.resident.enabled, rooms: state.resident.rooms.length, desiredOn: enabledRooms, issues: roomIssues },
    browser: { issues: browserIssues, liveThreadAcceptance: 'UNVERIFIED_BY_DOCTOR' },
    codex: { issues: codexIssues, activeOrUnconfirmedJobs: activeJobs, executionAcceptance: 'UNVERIFIED_BY_DOCTOR' },
    configMatchesService: { residentEnabled: config.residentEnabled === state.resident.enabled, codexConfigured: !!config.workspaceRoots?.length === !!state.capabilities?.codexConfigured },
    realModelAcceptance: 'UNVERIFIED_BY_DOCTOR' };
}
