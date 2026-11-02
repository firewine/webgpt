import type { WorkspaceState, Member } from './model.js';
import type { Room } from './resident-model.js';
import type { DotGrant, DotRequest } from './dot-mcp-model.js';
import { participantIdentity, assertWikiSnapshots, wikiHistoryAllowed } from './wiki-policy.js';
import { AppError, digest } from './util.js';

export function dotGrants(s: WorkspaceState, room: Room, p: Member, clock = Date.now()): DotGrant[] {
  const d = s.dotMcp, b = d?.bindings.find(b => b.roomId === room.id && b.participantId === p.id && b.connectionId === p.connectionId);
  if (!b || b.status !== 'paired' || b.identity !== 'owner_confirmed' || !s.connections.some(c => c.id === p.connectionId && c.kind === 'dot-mcp')) return [];
  return d!.grants.filter(g => g.connectionId === b.connectionId && g.version === b.version && g.status === 'active' && Date.parse(g.expiresAt) > clock &&
    g.roomId === room.id && g.participantId === p.id && g.identityDigest === participantIdentity(p) &&
    ['dot_turn_get', 'dot_turn_claim', 'dot_turn_submit'].every(t => g.tools.includes(t)));
}
export function dotParticipantWait(s: WorkspaceState, room: Room, p: Member, clock = Date.now()): string | null {
  const d = s.dotMcp, grants = dotGrants(s, room, p, clock);
  if (!grants.length) return 'dot_grant_required';
  const subs = d!.events?.subscriptions.filter(v => grants.some(g => g.id === v.grantId) && v.status === 'active' && Date.parse(v.expiresAt) > clock) ?? [];
  if (!subs.length) return 'dot_subscription_required';
  if (subs.some(sub => d!.events!.outbox.some(e => e.subscriptionId === sub.id && !['delivered', 'settled'].includes(e.status)))) return 'dot_delivery_requires_reconciliation';
  return null;
}
export function dotTurn(s: WorkspaceState, requestId: string) {
  const resident = s.resident?.turns.find(t => t.id === requestId);
  const discussion = s.discussions.find(d => d.turns.some(t => t.id === requestId));
  const turn = resident ?? discussion?.turns.find(t => t.id === requestId);
  const lease = s.resident?.dispatchLeases.find(l => l.id === requestId); const room = s.resident?.rooms.find(r => r.id === lease?.roomId);
  if (!turn || !lease || !room) throw new AppError('dot_turn_not_reserved', 409);
  const participant = resident?.participant ?? discussion?.members.find(p => p.id === turn.participantId);
  if (!participant || participant.kind !== 'dot-mcp' || lease.participantId !== participant.id || lease.generation !== turn.generation ||
      !!discussion !== (lease.ownerKind === 'topic')) throw new AppError('dot_turn_not_reserved', 409);
  return { turn, lease, room, participant, discussion };
}
export function dotRequestCurrent(s: WorkspaceState, r: DotRequest, g: DotGrant, reconcile = false): boolean {
  try {
    const { turn, lease, room, participant, discussion } = dotTurn(s, r.id);
    const current = s.dotMcp?.grants.find(v => v.id === g.id);
    const context = room.contexts?.find(c => c.participantId === r.participantId);
    return !!current && JSON.stringify(current) === JSON.stringify(g) && g.id === r.grantId && g.version === r.grantVersion && g.status === 'active' && Date.parse(g.expiresAt) > Date.now() &&
      g.roomId === r.roomId && g.participantId === r.participantId && g.connectionId === r.connectionId && g.identityDigest === r.identityDigest &&
      ['dot_turn_get', 'dot_turn_claim', 'dot_turn_submit'].every(t => g.tools.includes(t)) &&
      s.connections.some(c => c.id === r.connectionId && c.kind === 'dot-mcp') &&
      s.dotMcp!.bindings.some(b => b.connectionId === r.connectionId && b.roomId === r.roomId && b.participantId === r.participantId && b.version === r.grantVersion && b.status === 'paired' && b.identity === 'owner_confirmed') &&
      room.id === r.roomId && room.desiredOn && room.epoch === r.epoch && room.members.some(m => m.participantId === r.participantId && m.enabled && !m.blockedReason) &&
      (context?.generation ?? 1) === r.contextGeneration && (!context || wikiHistoryAllowed(s, room, context)) &&
      participantIdentity(participant) === r.identityDigest && participant.connectionId === r.connectionId &&
      s.participants.some(p => p.id === r.participantId && participantIdentity(p) === r.identityDigest) &&
      turn.generation === r.generation && turn.prompt === r.prompt && turn.promptDigest === digest(r.prompt) &&
      (reconcile ? ['prepared', 'running', 'unconfirmed'].includes(turn.status) && ['reserved', 'running', 'unconfirmed'].includes(lease.state) : ['prepared', 'running'].includes(turn.status) && ['reserved', 'running'].includes(lease.state)) &&
      (discussion ? discussion.id === r.discussionId && discussion.revision === r.revision && 'revision' in turn && turn.revision === r.revision && !['cancelled', 'completed', 'partial'].includes(discussion.status) &&
        discussion.contexts.find(c => c.participantId === r.participantId)?.generation === r.generation : 'epoch' in turn && turn.epoch === r.epoch) &&
      assertWikiSnapshots(s, room.id, [r.participantId], turn.wikiCitations);
  } catch { return false; }
}
export const dotInputDigest = (prompt: string, history: DotRequest['history']) => digest(JSON.stringify({ prompt, history }));
export function dotCanApply(s: WorkspaceState, requestId: string): boolean {
  const r = s.dotMcp?.requests?.items.find(r => r.id === requestId); if (!r) return false;
  const g = s.dotMcp!.grants.find(g => g.id === r.grantId);
  return !!g && ['received', 'held'].includes(r.status) && r.reply?.disposition === 'received' && dotRequestCurrent(s, r, g, true);
}
export function reconcileDotReply(s: WorkspaceState, requestId: string, text: unknown, receipt: unknown) {
  const reply = s.dotMcp?.requests?.items.find(r => r.id === requestId)?.reply;
  if (!reply) throw new AppError('dot_reply_not_received', 409);
  if (text !== undefined && text !== reply.text || receipt !== undefined && receipt !== reply.receipt) throw new AppError('dot_reply_mismatch', 409);
  return { text: reply.text, receipt: reply.receipt, usage: null };
}
export function validateDotRequests(s: WorkspaceState): void {
  const requests = s.dotMcp?.requests; if (requests === undefined) return;
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
  const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (!requests || requests.version !== 1 || !Array.isArray(requests.items) || new Set(requests.items.map(r => r?.id)).size !== requests.items.length || requests.items.some(r =>
    !r || ![r.id, r.grantId, r.roomId, r.participantId, r.connectionId].every(text) || ![r.grantVersion, r.epoch, r.contextGeneration, r.generation].every(count) ||
    !hash(r.identityDigest) || !date(r.createdAt) || r.discussionId !== null && !text(r.discussionId) || r.revision !== null && !count(r.revision) ||
    typeof r.prompt !== 'string' || r.prompt.length > 180000 || !Array.isArray(r.history) || r.history.some(h => !h || !['user', 'assistant'].includes(h.role) || typeof h.content !== 'string') ||
    r.prompt.length + r.history.reduce((n, h) => n + h.content.length, 0) > 180000 || dotInputDigest(r.prompt, r.history) !== r.inputDigest || !['prepared', 'waiting', 'received', 'held', 'consumed', 'quarantined'].includes(r.status) ||
    !s.dotMcp!.grants.some(g => g.id === r.grantId && g.connectionId === r.connectionId && g.roomId === r.roomId && g.participantId === r.participantId) ||
    r.claim !== null && (!r.claim || ![r.claim.id, r.claim.commandId].every(text) || !hash(r.claim.hash) || !['prepared', 'active'].includes(r.claim.status)) ||
    r.reply !== null && (!r.reply || !r.claim || typeof r.reply.text !== 'string' || r.reply.text.length > 100000 || digest(r.reply.text) !== r.reply.digest || !text(r.reply.receipt) || !date(r.reply.at) || !['received', 'quarantined'].includes(r.reply.disposition)))) throw new AppError('dot_requests_state_invalid', 503);
}
