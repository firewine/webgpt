// Phase 1 stores room data only. No provider, worker or timer is started here.
export interface RoomMember { participantId: string; enabled: boolean }
export interface Room {
  id: string; title: string; version: number; epoch: number;
  desiredOn: boolean; observedStatus: 'off' | 'on' | 'sleeping' | 'blocked' | 'budget_exhausted';
  members: RoomMember[]; legacyDiscussionIds: string[]; topicLink: string | null;
  budgets: null; nextEligibleAt: null;
  lastMessageSequence: number; createdAt: string; updatedAt: string;
}
export interface RoomMessage {
  id: string; roomId: string; sequence: number;
  sourceKind: 'user' | 'room' | 'topic' | 'work' | 'wiki' | 'system'; sourceId: string | null;
  authorId: string; text: string; replyTo: string | null; mentions: string[];
  visibility: 'room_public' | 'owner_only' | 'topic_round'; createdAt: string;
}
export interface ResidentTurn {
  id: string; roomId: string; participantId: string; generation: number; epoch: number;
  status: 'prepared' | 'running' | 'completed' | 'failed' | 'unconfirmed' | 'stale';
}
export interface DispatchLease {
  id: string; ownerKind: 'topic' | 'resident'; ownerAttemptId: string;
  participantId: string; generation: number; state: 'reserved' | 'running' | 'unconfirmed';
}
export interface ResidentStateV1 {
  schemaVersion: 1;
  migration: { id: 'resident-v1'; at: string; basisCursor: number };
  rooms: Room[]; messages: RoomMessage[]; turns: ResidentTurn[]; dispatchLeases: DispatchLease[];
  // Reserved storage for phases 2–7. Phase 1 neither interprets nor exposes it.
  contextCheckpoints: unknown[]; workItems: unknown[]; workAttempts: unknown[];
  wikiPages: unknown[]; wikiVersions: unknown[]; jobLinks: unknown[]; residentGrants: unknown[];
}
export interface RoomSummary {
  id: string; title: string; version: number; epoch: number; desiredOn: boolean;
  observedStatus: Room['observedStatus']; members: RoomMember[]; legacyDiscussionIds: string[];
  topicLink: string | null; lastMessageSequence: number; createdAt: string; updatedAt: string;
}
