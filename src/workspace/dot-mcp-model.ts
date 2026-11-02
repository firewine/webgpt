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
}
