export type WorkRole = 'manager' | 'assistant' | 'specialist' | 'executor' | 'monitor';
export type WorkAction = 'propose' | 'manage' | 'claim' | 'report' | 'review';
export type WorkKind = 'analysis' | 'codex';
export interface SeatAssignment {
  participantId: string; role: WorkRole; version: number; enabled: boolean;
  kinds: WorkKind[]; scopeRefs: string[]; policyVersion: 1;
}
export interface WorkAcceptance {
  id: string; text: string;
  check: { kind: 'manual' | 'text_includes' | 'execution'; value?: string };
}
export interface WorkTask {
  id: string; roomId: string; proposalKey: string; proposalDigest: string; proposedBy: string;
  title: string; description: string; sourceMessageIds: string[]; acceptance: WorkAcceptance[];
  kind: WorkKind; priority: number; requiredRole: WorkRole | null; allowedParticipantIds: string[];
  dependencies: string[]; authorizedScopeRef: string; version: number;
  status: 'backlog' | 'ready' | 'claimed' | 'running' | 'review' | 'rework' | 'done' | 'blocked' | 'failed' | 'cancelled';
  reason: string | null; claimantId: string | null; currentAttemptId: string | null; currentReportId: string | null;
  reports: WorkReportV1[]; reviews: WorkReviewV1[]; createdAt: string; updatedAt: string;
}
export interface WorkAttempt {
  id: string; taskId: string; roomId: string; taskVersion: number; participantId: string;
  purpose: 'work' | 'review'; seatVersion: number; contextGeneration: number; epoch: number;
  authorizedScopeRef: string; requestId: string; providerTurnId: string | null;
  input: Pick<WorkTask, 'title' | 'description' | 'kind' | 'sourceMessageIds' | 'acceptance' | 'dependencies' | 'authorizedScopeRef'>;
  inputDigest: string; providerPromptDigest: string | null; reportDigest: string | null;
  status: 'claimed' | 'running' | 'unconfirmed' | 'completed' | 'failed' | 'stale';
  startedAt: string; finishedAt: string | null; reported: boolean; error: string | null;
}
export interface WorkCheck {
  acceptanceId: string; outcome: 'observed_pass' | 'observed_fail' | 'reported' | 'not_run' | 'unknown';
  evidenceRefs: string[]; observation: string;
}
export interface WorkReportV1 {
  version: 1; id: string; taskId: string; taskVersion: number; attemptId: string; authorId: string;
  summary: string; text: string; digest: string;
  acceptance: WorkAcceptance[];
  outputs: { ref: string; digest: string; kind: 'text' }[]; checks: WorkCheck[]; blockers: string[];
  sourceMessageIds: string[]; executionRef: string | null; createdAt: string;
}
export interface WorkReviewV1 {
  version: 1; id: string; reportDigest: string; taskVersion: number; reviewerId: string;
  decision: 'accept' | 'rework' | 'blocked'; reason: string; checks: WorkCheck[]; createdAt: string;
}
