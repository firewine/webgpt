import { isAbsolute } from 'node:path';
import { AppError, digest } from '../workspace/util.js';
import type { ScopedCommandApproval } from './execution-model.js';

type ApprovalInput = {
  jobId: string; threadId: string; turnId: string; rpcId: number | string;
  method: string; params: Record<string, unknown>; contextDigest: string;
  displayCommand: string; cwd: string; profileId: 'webjjoku_read' | 'webjjoku_copy';
};
const PARAM_KEYS = ['kind', 'threadId', 'turnId', 'itemId', 'startedAtMs', 'environmentId',
  'command', 'cwd', 'commandActions', 'proposedExecpolicyAmendment', 'availableDecisions',
  'reason', 'approvalId', 'networkApprovalContext', 'additionalPermissions', 'proposedNetworkPolicyAmendments'];
const SCOPE_KEYS = ['version', 'state', 'digest', 'requestDigest', 'contextDigest', 'command', 'cwd', 'profileId', 'reason', 'choice'];
const STATES = ['checking', 'ready', 'blocked', 'selected', 'sent', 'unconfirmed'];
const DELIVERIES: Record<ScopedCommandApproval['state'], readonly string[]> = {
  checking: [], ready: [], selected: ['prepared'], sent: ['sent'],
  unconfirmed: ['sending', 'unconfirmed'], blocked: ['prepared', 'cancelled', 'unconfirmed'],
};
// Tabs and newlines can format a command; terminal control sequences cannot.
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
const HASH = /^[a-f0-9]{64}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null &&
  typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key));
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !CONTROLS.test(value);
const command = (value: unknown): value is string => text(value) && value.length <= 30_000;
const hash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value);
const profile = (value: unknown): value is ApprovalInput['profileId'] => value === 'webjjoku_read' || value === 'webjjoku_copy';
const amendment = (value: unknown): boolean => Array.isArray(value) && Array.from(value).every(part => typeof part === 'string');
function invalid(): never { throw new AppError('invalid_scoped_approval_state', 503); }

function decision(value: unknown): boolean {
  // Offered alternatives are metadata; the caller may send only plain accept.
  if (value === 'accept' || value === 'acceptForSession' || value === 'decline' || value === 'cancel') return true;
  if (!record(value) || !keys(value, ['acceptWithExecpolicyAmendment'])) return false;
  const proposed = value.acceptWithExecpolicyAmendment;
  return record(proposed) && keys(proposed, ['execpolicy_amendment']) && amendment(proposed.execpolicy_amendment);
}

function blockedReason(input: ApprovalInput): string | null {
  const p = input.params;
  if (input.method !== 'item/commandExecution/requestApproval' || !record(p) || p.kind !== 'command') return 'scoped_approval_unsupported_request';
  if (!keys(p, PARAM_KEYS)) return 'scoped_approval_unknown_fields';
  if (p.threadId !== input.threadId || p.turnId !== input.turnId || !text(p.itemId) ||
      p.environmentId !== 'local' || p.cwd !== input.cwd) return 'scoped_approval_scope_mismatch';
  for (const key of ['networkApprovalContext', 'additionalPermissions', 'proposedNetworkPolicyAmendments']) {
    if (Object.hasOwn(p, key) && p[key] !== null) return 'scoped_approval_additional_permissions';
  }
  if (!command(p.command) || p.command !== input.displayCommand) return 'scoped_approval_command_unverifiable';
  if (!Array.isArray(p.availableDecisions) || !p.availableDecisions.includes('accept') ||
      !Array.from(p.availableDecisions).every(decision)) return 'scoped_approval_unsupported_decisions';
  if (Object.hasOwn(p, 'startedAtMs') && (typeof p.startedAtMs !== 'number' || !Number.isSafeInteger(p.startedAtMs) || p.startedAtMs < 0) ||
      Object.hasOwn(p, 'approvalId') && p.approvalId !== null && !text(p.approvalId) ||
      Object.hasOwn(p, 'reason') && p.reason !== null && typeof p.reason !== 'string' ||
      Object.hasOwn(p, 'proposedExecpolicyAmendment') && p.proposedExecpolicyAmendment !== null && !amendment(p.proposedExecpolicyAmendment) ||
      Object.hasOwn(p, 'commandActions') && p.commandActions !== null && !Array.isArray(p.commandActions)) return 'scoped_approval_invalid_request';
  return null;
}

export function scopedApprovalDigest(scope: Pick<ScopedCommandApproval,
  'version' | 'requestDigest' | 'contextDigest' | 'command' | 'cwd' | 'profileId'>): string {
  return digest(JSON.stringify({ version: scope.version, requestDigest: scope.requestDigest,
    contextDigest: scope.contextDigest, command: scope.command, cwd: scope.cwd, profileId: scope.profileId }));
}

export function createScopedApproval(input: ApprovalInput): ScopedCommandApproval {
  const { jobId, rpcId, method, params, contextDigest, displayCommand, cwd, profileId } = input;
  if (!text(jobId) || !text(input.threadId) || !text(input.turnId) ||
      !(typeof rpcId === 'number' && Number.isSafeInteger(rpcId) || text(rpcId))) invalid();
  let requestDigest: string;
  try { requestDigest = digest(JSON.stringify({ jobId, rpcId, method, params })); }
  catch { invalid(); }
  const reason = blockedReason(input);
  const fields = { version: 1 as const, requestDigest, contextDigest, command: displayCommand, cwd, profileId };
  const scope: ScopedCommandApproval = { ...fields, digest: scopedApprovalDigest(fields), state: reason ? 'blocked' : 'checking', reason };
  validateScopedApproval(scope);
  return scope;
}

/** Validates the persisted seal; the caller separately pins the raw RPC and live context. */
export function validateScopedApproval(value: unknown): void {
  if (!record(value) || !keys(value, SCOPE_KEYS) || value.version !== 1 ||
      typeof value.state !== 'string' || !STATES.includes(value.state) ||
      !hash(value.digest) || !hash(value.requestDigest) || !hash(value.contextDigest) ||
      typeof value.command !== 'string' || !['blocked', 'unconfirmed'].includes(value.state) && !command(value.command) ||
      !text(value.cwd) || !isAbsolute(value.cwd) || !profile(value.profileId) ||
      value.reason !== null && !text(value.reason) || value.state === 'blocked' && value.reason === null) invalid();
  const scope = value as unknown as ScopedCommandApproval;
  if (scope.digest !== scopedApprovalDigest(scope)) invalid();
  if (!Object.hasOwn(scope, 'choice')) {
    if (scope.state === 'selected' || scope.state === 'sent') invalid();
    return;
  }
  const choice: unknown = scope.choice;
  if (!record(choice) || !keys(choice, ['commandId', 'selectedAt', 'delivery']) || !text(choice.commandId) ||
      typeof choice.selectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(choice.selectedAt) ||
      !Number.isFinite(Date.parse(choice.selectedAt)) || new Date(choice.selectedAt).toISOString() !== choice.selectedAt ||
      typeof choice.delivery !== 'string' || !DELIVERIES[scope.state].includes(choice.delivery)) invalid();
}
