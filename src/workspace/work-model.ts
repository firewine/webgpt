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
  input: Pick<WorkTask, 'title' | 'description' | 'kind' | 'sourceMessageIds' | 'acceptance' | 'dependencies' | 'authorizedScopeRef'> & { previousReportId: string | null; feedbackReviewIds: string[] };
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
  outputs: { ref: string; digest: string; kind: 'text' | 'command' | 'file_change' }[]; checks: WorkCheck[]; blockers: string[];
  sourceMessageIds: string[]; executionRef: string | null; createdAt: string;
  execution?: WorkExecutionEvidence;
}
export interface WorkReviewV1 {
  version: 1; id: string; reportDigest: string; taskVersion: number; reviewerId: string;
  decision: 'accept' | 'rework' | 'blocked'; reason: string; checks: WorkCheck[]; createdAt: string;
}
export interface WorkExecutionEvidence {
  jobId: string; bindingId: string; threadId: string; turnId: string | null;
  status: string; observedAt: string; promptDigest: string;
  commands: { activityId: string; command: string | null; status: string; exitCode: number | null; output: string | null; observedAt: string }[];
  fileChanges: { activityId: string; status: string; text: string; observedAt: string }[];
}
export interface WorkJobLink {
  version: 1; id: string; roomId: string; taskId: string; attemptId: string; participantId: string;
  scope: { taskVersion: number; seatVersion: number; contextGeneration: number; epoch: number; authorizedScopeRef: string; inputDigest: string; deadlineAt: string };
  binding: import('./model.js').ExecutionBinding;
  input: { bindingId: string; prompt: string; requestId: string; discussionId: null; taskId: null; revision: null; maxDurationMs: number };
  intentDigest: string; codexJobId: string | null; status: 'intent' | 'linked' | 'reported' | 'blocked' | 'not_sent';
  reported: boolean; error: string | null; createdAt: string;
  resultScopeReason: string | null;
  result: { report: WorkReportV1; scopeReason: string | null; capturedAt: string } | null;
}
