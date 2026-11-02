export const dotTools = ['dot_turn_get', 'dot_turn_claim', 'dot_turn_submit'] as const;
export interface DotBinding {
  connectionId: string; participantId: string; roomId: string; version: number;
  status: 'pending' | 'paired' | 'revoked'; identity: 'unverified' | 'owner_confirmed';
  nativeActorVerified: false; createdAt: string;
}
export interface DotGrant {
  id: string; connectionId: string; roomId: string; participantId: string; version: number;
  epoch: number; contextGeneration: number; identityDigest: string;
  hash: string; tools: string[]; status: 'prepared' | 'active' | 'revoked';
  expiresAt: string; createdAt: string;
}
export interface DotMcpState {
  schemaVersion: 1; migration: { at: string; basisCursor: number };
  bindings: DotBinding[]; grants: DotGrant[];
  events?: { version: 1; subscriptions: DotSubscription[]; outbox: DotEvent[] };
}
export const dotEventName = 'webjjoku.turn_requested';
export interface DotSubscription {
  id: string; grantId: string; callbackHash: string; secretHash: string; credentialRef: string; credentialRefs: string[];
  version: number; status: 'prepared' | 'active' | 'revoked' | 'expired' | 'failed';
  expiresAt: string; verifiedUntil: string | null; cursor: string | null;
}
export interface DotEvent {
  id: string; subscriptionId: string; requestId: string; body: string; digest: string;
  status: 'pending' | 'sending' | 'delivered' | 'held' | 'failed'; reason: string | null;
  nextAttemptAt: string; attempts: { at: string; finishedAt: string | null; httpStatus: number | null; error: string | null }[];
}
