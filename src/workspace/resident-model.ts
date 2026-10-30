import type { Context, Member, StructuredReply } from './model.js';
import type { SeatAssignment, WorkTask, WorkAttempt, WorkJobLink } from './work-model.js';
export type { SeatAssignment, WorkTask, WorkAttempt, WorkReportV1, WorkReviewV1, WorkJobLink } from './work-model.js';
export type ResidentUsage = { input: number; output: number } | null;

export interface RoomMember { participantId: string; enabled: boolean; blockedReason?: string | null }
export interface RoomBudget { maxRequests: number; maxTokens: number; maxToolJobs: number; deadlineAt: string }
export interface RoomPacing { minIntervalMs: number; idleNudgeMs: number; passBackoffMs: number; sleepAfterPasses: number }
export interface RoomContext { participantId: string; generation: number; history: Context['history']; checkpointId: string | null; lastSeenSequence: number }
export interface BudgetEntry { requestId: string; kind: 'topic' | 'resident' | 'work'; reservedAt: string; settledAt: string | null; usage: ResidentUsage; error: string | null }
export interface ResidentReply extends StructuredReply {
  version: 1; action: 'say' | 'pass'; replyTo: string | null; mentions: string[];
  proposals: { kind: 'work_propose' | 'work_report' | 'work_review' | 'wiki_edit'; payload: Record<string, unknown> }[];
}
export interface RoomClaim { id: string; roomId: string; turnId: string; participantId: string; text: string; assumptions: string[]; status: 'reported' }
export interface Room {
  id: string; title: string; version: number; epoch: number;
  desiredOn: boolean; observedStatus: 'off' | 'on' | 'sleeping' | 'blocked' | 'budget_exhausted';
  members: RoomMember[]; legacyDiscussionIds: string[]; topicLink: string | null;
  budgets: RoomBudget | null; nextEligibleAt: string | null;
  pacing?: RoomPacing | null; contexts?: RoomContext[]; ledger?: BudgetEntry[]; toolReservations?: string[];
  reason?: string | null; passCount?: number; nextMemberIndex?: number; lastCompletedAt?: string | null;
  seats?: SeatAssignment[];
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
  participant: Member; prompt: string; promptDigest: string; history: Context['history']; basisSequence: number;
  text: string; receipt: string | null; reply: ResidentReply | null; usage: ResidentUsage;
  startedAt: string; finishedAt: string | null; error: string | null; repairOf: string | null;
  messageId: string | null; proposalsStatus: 'none' | 'not_run' | 'stale' | 'applied';
  workAttemptId?: string;
  workSeatVersion?: number;
  proposalResults?: { index: number; status: 'applied' | 'not_run'; taskId?: string; reason?: string }[];
  dispatchStartedAt?: string;
}
export interface DispatchLease {
  id: string; ownerKind: 'topic' | 'resident' | 'work'; ownerAttemptId: string;
  participantId: string; generation: number; state: 'reserved' | 'running' | 'unconfirmed' | 'released';
  roomId?: string | null;
  invokedAt?: string;
}
export interface ResidentCheckpoint {
  id: string; roomId: string; participantId: string; fromGeneration: number; toGeneration: number;
  epoch: number; basisCursor: number; basisSequence: number; text: string; digest: string;
  createdAt: string; applied: true;
}
export interface ResidentStateV1 {
  schemaVersion: 1;
  migration: { id: 'resident-v1'; at: string; basisCursor: number };
  rooms: Room[]; messages: RoomMessage[]; turns: ResidentTurn[]; dispatchLeases: DispatchLease[];
  claims?: RoomClaim[];
  workSchemaVersion?: 1;
  workExecutionSchemaVersion?: 1;
  contextCheckpoints: ResidentCheckpoint[]; workItems: WorkTask[]; workAttempts: WorkAttempt[];
  wikiPages: unknown[]; wikiVersions: unknown[]; jobLinks: WorkJobLink[]; residentGrants: unknown[];
}
export interface RoomSummary {
  id: string; title: string; version: number; epoch: number; desiredOn: boolean;
  observedStatus: Room['observedStatus']; members: RoomMember[]; legacyDiscussionIds: string[];
  topicLink: string | null; lastMessageSequence: number; createdAt: string; updatedAt: string;
  budgets?: RoomBudget | null; pacing?: RoomPacing | null; reason?: string | null;
  nextEligibleAt?: string | null; used?: { requests: number; inputTokens: number; outputTokens: number; unknownUsage: number; toolJobs: number };
}
