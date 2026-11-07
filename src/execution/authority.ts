import type { WorkspaceState, CodexJob, ExecutionBinding } from '../workspace/model.js';
import { AppError, integer, digest } from '../workspace/util.js';
import type { ExecutionAuthority } from './execution-model.js';
export type { ExecutionAuthority, JobAuthority } from './execution-model.js';
export function issueAuthority(hours: unknown, epoch = 1, clock = Date.now()): ExecutionAuthority {
  const duration = integer(hours, 24, 1, 168);
  return { version: 1, epoch, issuedAt: new Date(clock).toISOString(), expiresAt: new Date(clock + duration * 3_600_000).toISOString(), revokedAt: null };
}
export function authorityReason(a: ExecutionAuthority | undefined, clock = Date.now()): string | null {
  if (!a) return 'execution_authority_legacy';
  if (a.version !== 1 || typeof a.issuedAt !== 'string' || typeof a.expiresAt !== 'string' || a.revokedAt !== null && typeof a.revokedAt !== 'string' || !Number.isSafeInteger(a.epoch) || a.epoch < 1 || !Number.isFinite(Date.parse(a.issuedAt)) || !Number.isFinite(Date.parse(a.expiresAt)) ||
      Date.parse(a.expiresAt) <= Date.parse(a.issuedAt) || Date.parse(a.expiresAt) - Date.parse(a.issuedAt) > 168 * 3_600_000 || a.revokedAt !== null && !Number.isFinite(Date.parse(a.revokedAt))) return 'execution_authority_invalid';
  if (a.revokedAt) return 'execution_authority_revoked';
  if (Date.parse(a.expiresAt) <= clock || Date.parse(a.issuedAt) > clock) return 'execution_authority_expired';
  return null;
}
export function bindingReason(b: ExecutionBinding | undefined, clock = Date.now()): string | null {
  if (b?.managedSession?.state === 'lost') return 'managed_session_lost';
  if (!b || b.status !== 'ready') return 'execution_binding_not_ready';
  return authorityReason(b.authority, clock);
}
export function bindingDigest(b: ExecutionBinding): string { return digest(JSON.stringify({ id: b.id, host: b.host, user: b.user, cwd: b.cwd, threadId: b.threadId, repoRoot: b.repoRoot, branch: b.branch, head: b.head, allowWrite: b.allowWrite, authority: b.authority, readProtection: b.readProtection, managedSessionVersion: b.managedSession?.version })); }
export function grantDigest(g: WorkspaceState['grants'][number]): string { return digest(JSON.stringify({ id: g.id, hash: g.hash, discussionId: g.discussionId, participantId: g.participantId, tools: g.tools, authority: g.authority })); }
export function discussionDigest(s: WorkspaceState, j: Pick<CodexJob, 'discussionId' | 'taskId' | 'revision'>): string {
  const d = s.discussions.find(d => d.id === j.discussionId); const task = d?.tasks.find(t => t.id === j.taskId);
  return digest(JSON.stringify({ discussionId: d?.id, revision: d?.revision, bindingId: d?.executionBindingId, taskId: task?.id, participantId: task?.participantId, turnId: task?.turnId, generation: d?.contexts?.find(c => c.participantId === task?.participantId)?.generation ?? 1 }));
}
export function assertJobAuthority(s: WorkspaceState, j: CodexJob, clock = Date.now()): void {
  const b = s.bindings.find(b => b.id === j.bindingId); const reason = bindingReason(b, clock);
  if (reason) throw new AppError(reason, 409);
  const a = j.authority;
  if (!a || a.version !== 1 || !b || a.binding.id !== b.id || a.binding.epoch !== b.authority!.epoch || a.binding.expiresAt !== b.authority!.expiresAt || a.binding.scopeDigest !== bindingDigest(b)) throw new AppError('execution_authority_changed', 409);
  if (j.discussionId) { const d = s.discussions.find(d => d.id === j.discussionId);
    if (!d || d.status !== 'running' || d.revision !== j.revision || d.executionBindingId !== b.id || !d.tasks.some(t => t.id === j.taskId) || !a.discussion || a.discussion.scopeDigest !== discussionDigest(s, j)) throw new AppError('execution_discussion_scope_changed', 409);
  }
  if (a.grant) {
    const g = s.grants.find(g => g.id === a.grant!.id); const reason = authorityReason(g?.authority, clock);
    if (!g || g.revoked || reason || g.authority!.epoch !== a.grant.epoch || g.authority!.expiresAt !== a.grant.expiresAt || a.grant.scopeDigest !== grantDigest(g) || g.discussionId !== j.discussionId || !g.tools.includes('codex_send') ||
        !s.discussions.find(d => d.id === j.discussionId)?.tasks.some(t => t.id === j.taskId && t.participantId === g.participantId)) throw new AppError('execution_grant_revoked_or_changed', 409);
  }
}
export function initializeExecutionProtection(s: WorkspaceState): void {
  if (s.executionProtectionVersion !== undefined && s.executionProtectionVersion !== 1) throw new AppError('unsupported_execution_protection_schema', 503);
  if (s.executionProtectionVersion === undefined && (s.bindings.some(b => b.authority || b.readProtection !== undefined || b.managedSession !== undefined) || s.jobs.some(j => j.authority || j.readCopy !== undefined) || s.grants.some(g => g.authority))) throw new AppError('execution_protection_state_missing', 503);
  for (const a of [...s.bindings.map(b => b.authority), ...s.grants.map(g => g.authority)]) if (a !== undefined && (!a || authorityReason(a) === 'execution_authority_invalid')) throw new AppError('invalid_execution_authority_state', 503);
  for (const j of s.jobs) if (j.authority && (j.authority.version !== 1 || !j.authority.binding || !Number.isSafeInteger(j.authority.binding.epoch))) throw new AppError('invalid_job_authority_state', 503);
  for (const j of s.jobs) if (j.capture && (j.capture.version !== 1 || j.capture.jobId !== j.id || typeof j.capture.complete !== 'boolean' || !Number.isSafeInteger(j.capture.byteLength) || j.capture.byteLength < 0) || j.draft && j.draft.version !== 1) throw new AppError('invalid_execution_protection_state', 503);
  for (const b of s.bindings) {
    const m = b.managedSession;
    if (b.readProtection !== undefined && b.readProtection !== 1 || m !== undefined && (!m || m.version !== 1 || !['initial', 'dispatched', 'lost'].includes(m.state) ||
        m.firstRequestId !== null && (typeof m.firstRequestId !== 'string' || !m.firstRequestId) || m.state !== 'dispatched' && m.firstRequestId !== null || m.state === 'dispatched' && !m.firstRequestId || !b.allowWrite && b.readProtection !== 1)) throw new AppError('invalid_managed_session_state', 503);
  }
  for (const j of s.jobs) if (j.readCopy !== undefined && (!j.readCopy || j.readCopy.version !== 1 || !['preparing', 'running', 'checked', 'blocked'].includes(j.readCopy.status) ||
    j.draft || ['running', 'checked'].includes(j.readCopy.status) && !/^[a-f0-9]{64}$/.test(j.readCopy.manifestDigest ?? '') || j.readCopy.reason !== null && typeof j.readCopy.reason !== 'string')) throw new AppError('invalid_read_copy_state', 503);
  s.executionProtectionVersion = 1;
}
