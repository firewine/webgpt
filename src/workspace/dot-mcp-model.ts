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
  requests?: { version: 1; items: DotRequest[] };
}
export interface DotRequest {
  id: string; grantId: string; grantVersion: number; roomId: string; participantId: string; connectionId: string;
  epoch: number; contextGeneration: number; generation: number; discussionId: string | null; revision: number | null;
  identityDigest: string; prompt: string; history: { role: 'user' | 'assistant'; content: string }[]; inputDigest: string;
  status: 'prepared' | 'waiting' | 'received' | 'held' | 'consumed' | 'quarantined'; createdAt: string;
  claim: { id: string; commandId: string; hash: string; status: 'prepared' | 'active' } | null;
  reply: { text: string; digest: string; receipt: string; at: string; disposition: 'received' | 'quarantined' } | null;
}
export const dotEventName = 'webjjoku.turn_requested';
export interface DotConnectionStatus {
  connectionId: string; participantId: string; roomId: string; version: number;
  authority: string; identity: DotBinding['identity']; nativeActorVerified: false;
  subscription: string; activeSubscriptions: number; grantExpiresAt: string | null; subscriptionExpiresAt: string | null;
  delivery: string; deliveryHttpStatus: number | null; response: string;
  requestId: string | null; discussionId: string | null; receipt: string | null;
  memberEnabled: boolean; roomOn: boolean; ready: boolean;
}
export interface DotSubscription {
  id: string; grantId: string; callbackHash: string; secretHash: string; credentialRef: string; credentialRefs: string[];
  version: number; status: 'prepared' | 'active' | 'revoked' | 'expired' | 'failed';
  expiresAt: string; verifiedUntil: string | null; cursor: string | null;
}
export interface DotEvent {
  id: string; subscriptionId: string; requestId: string; body: string; digest: string;
  status: 'pending' | 'sending' | 'delivered' | 'settled' | 'held' | 'failed'; reason: string | null;
  nextAttemptAt: string; attempts: { at: string; finishedAt: string | null; httpStatus: number | null; error: string | null }[];
}
