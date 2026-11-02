import type { WorkspaceState } from './model.js';
import type { DotBinding, DotConnectionStatus } from './dot-mcp-model.js';
import { dotGrants, dotParticipantWait } from './dot-mcp-policy.js';

// Explicit metadata projection: no input, reply text, credentials, callback URL
// or caller-provided error prose. Reading status never changes transport state.
export function projectDotConnection(s: WorkspaceState, binding: DotBinding, enabled: boolean, activeGrants?: ReadonlySet<string>, clock = Date.now()): DotConnectionStatus {
  const room = s.resident?.rooms.find(r => r.id === binding.roomId), participant = s.participants.find(p => p.id === binding.participantId);
  const connection = s.connections.find(c => c.id === binding.connectionId);
  const grant = s.dotMcp?.grants.filter(g => g.connectionId === binding.connectionId && g.version === binding.version).at(-1);
  const active = !!grant && (activeGrants ? activeGrants.has(grant.id) : !!room && !!participant && dotGrants(s, room, participant, clock).some(g => g.id === grant.id));
  const authority = !enabled ? 'disabled' : !connection ? 'removed' : binding.status === 'revoked' ? 'revoked' : grant && Date.parse(grant.expiresAt) <= clock ? 'expired' : active ? 'active' : binding.status === 'pending' ? 'confirmation_required' : 'unavailable';
  const subs = s.dotMcp?.events?.subscriptions.filter(v => v.grantId === grant?.id) ?? [];
  const live = subs.filter(v => v.status === 'active' && Date.parse(v.expiresAt) > clock);
  const latestSub = subs.at(-1);
  const subscription = live.length ? 'active' : latestSub ? Date.parse(latestSub.expiresAt) <= clock ? 'expired' : latestSub.status : 'none';
  const request = s.dotMcp?.requests?.items.filter(r => r.connectionId === binding.connectionId).at(-1);
  const turn = request && (s.resident?.turns.find(t => t.id === request.id) ?? s.discussions.flatMap(d => d.turns).find(t => t.id === request.id));
  const delivery = request && s.dotMcp?.events?.outbox.filter(e => e.requestId === request.id).at(-1);
  const response = !request ? 'not_run' : turn?.status === 'unconfirmed' || request.status === 'held' ? 'unconfirmed' : request.status === 'quarantined' || turn?.status === 'stale' ? 'quarantined' : turn?.status === 'completed' ? 'completed' : turn?.status === 'failed' ? 'failed' : request.reply ? 'received' : request.claim?.status === 'active' ? 'claimed' : 'waiting';
  return { connectionId: binding.connectionId, participantId: binding.participantId, roomId: binding.roomId, version: binding.version,
    authority, identity: binding.identity, nativeActorVerified: false as const, subscription, activeSubscriptions: live.length,
    grantExpiresAt: grant?.expiresAt ?? null, subscriptionExpiresAt: live[0]?.expiresAt ?? latestSub?.expiresAt ?? null,
    delivery: delivery?.status ?? 'not_sent', deliveryHttpStatus: delivery?.attempts.at(-1)?.httpStatus ?? null, response,
    requestId: request?.id ?? null, discussionId: request?.discussionId ?? null, receipt: request?.reply?.receipt ?? null,
    memberEnabled: !!room?.members.find(m => m.participantId === binding.participantId)?.enabled, roomOn: !!room?.desiredOn,
    ready: enabled && authority === 'active' && !!room && !!participant && !dotParticipantWait(s, room, participant, clock) };
}
