export type ProviderKind = 'fake' | 'openai-oauth' | 'deepseek' | 'browser';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type Phase = 'independent' | 'cross_review' | 'verification' | 'revision' | 'synthesis' | 'summary_review';
export type RunStatus = 'running' | 'paused' | 'blocked' | 'completed' | 'partial' | 'cancelled';
export interface ModelChoice { id: string; label: string }
export interface BrowserBinding {
  pageId: number; url: string; accountLabel: string; agentLabel: string;
  identitySelector: string; identityText: string; inputSelector: string; sendSelector: string;
  userSelector: string; assistantSelector: string; busySelector: string; readySelector: string;
  thread?: { selector: string; attribute: string; value: string; jsonKey?: string };
  sendAppearsAfterInput?: boolean;
}
export interface Connection {
  id: string; kind: Exclude<ProviderKind, 'fake'>; label: string;
  status: 'connected' | 'auth_required' | 'unverified' | 'error';
  models: ModelChoice[]; clientId?: string; subject?: string; email?: string; expectedEmail?: string;
  browser?: BrowserBinding; lastCheckedAt?: string; error?: string;
}
export interface Member {
  id: string; label: string; kind: ProviderKind; connectionId: string | null; modelId: string; role: string;
  reasoningEffort?: ReasoningEffort;
}
export interface Observation {
  connection: string; response: string; tool: string; work: string;
  observedAt: string; lastProgressAt: string | null; source: string; reason: string | null;
}
export interface Context {
  participantId: string; generation: number; checkpointId: string | null;
  history: { role: 'user' | 'assistant'; content: string }[];
  observation: Observation;
}
export interface Claim { id: string; participantId: string; turnId: string; revision: number; text: string; assumptions: string[] }
export interface Evidence {
  id: string; revision: number; claimIds: string[]; participantId: string | null; taskId: string | null;
  kind: 'source' | 'user_material' | 'provider_report' | 'execution';
  source: string; text: string; observedAt: string; digest: string;
  status: 'observed' | 'reported' | 'not_run' | 'failed'; reason: string | null;
  material?: Omit<MaterialFile, 'text' | 'identity'> & { packageId: string };
}
export interface MaterialFile {
  path: string; digest: string; size: number; observedAt: string; excerpt: false; text: string;
  identity: string;
}
export interface MaterialPackage { id: string; label: string; createdAt: string; files: MaterialFile[] }
export interface Review { claimId: string; stance: 'support' | 'challenge' | 'uncertain'; reason: string }
export interface VerificationProposal { claimId: string; method: 'source' | 'codex' | 'review'; url: string; question: string }
export interface StructuredReply {
  text: string; claims: { text: string; assumptions: string[] }[]; reviews: Review[];
  verifications: VerificationProposal[]; uncertainty: string[];
}
export interface Task {
  id: string; phase: Phase; round: number; revision: number; participantId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unconfirmed' | 'cancelled';
  dependencyIds: string[]; claimIds: string[]; method: 'source' | 'codex' | 'review' | null;
  url: string; question: string; reason: string | null; turnId: string | null; jobId: string | null;
}
export interface DiscussionTurn {
  id: string; taskId: string; participantId: string; revision: number; generation: number;
  phase: Phase; round: number; status: 'prepared' | 'running' | 'completed' | 'failed' | 'unconfirmed' | 'stale';
  prompt: string; promptDigest: string; text: string; reply: StructuredReply | null;
  startedAt: string; finishedAt: string | null; receipt: string | null; error: string | null;
  usage: { input: number; output: number } | null; evidenceIds: string[];
  reasoningEffort?: ReasoningEffort;
}
export interface Checkpoint {
  id: string; participantId: string; revision: number; generation: number; basisCursor: number;
  createdAt: string; reason: string; text: string; turnIds: string[]; evidenceIds: string[];
  pendingTaskIds: string[]; unresolvedTurnIds: string[]; requestsUsed: number; applied: boolean;
}
export interface Discussion {
  id: string; topic: string; materials: string; criteria: string; revision: number;
  members: Member[]; excludedIds: string[]; contexts: Context[];
  phase: Phase; round: number; status: RunStatus; reason: string | null;
  createdAt: string; updatedAt: string;
  limits: { maxRequests: number; maxActiveMs: number; maxRounds: number; maxVerificationTasks: number; maxTokens: number; maxToolJobs: number };
  used: { requests: number; activeMs: number; inputTokens: number; outputTokens: number; unknownUsage: number; toolJobs: number };
  tasks: Task[]; turns: DiscussionTurn[]; claims: Claim[]; evidence: Evidence[]; checkpoints: Checkpoint[];
  interventions: { revision: number; text: string; createdAt: string }[];
  executionBindingId: string | null;
  materialPackageIds?: string[];
}
export interface ExecutionBinding {
  id: string; label: string; host: string; user: string; cwd: string; threadId: string;
  allowWrite: boolean; status: 'unverified' | 'ready' | 'blocked';
  repoRoot: string; branch: string; head: string; sessionTreeId: string | null;
}
export interface CodexJob {
  id: string; bindingId: string; discussionId: string | null; taskId: string | null; revision: number | null;
  requestId: string; prompt: string; promptDigest: string;
  status: 'queued' | 'running' | 'blocked_approval' | 'reconciling' | 'completed' | 'failed' | 'interrupted';
  threadId: string; turnId: string | null; createdAt: string; finishedAt: string | null;
  maxDurationMs: number; deadlineAt: string | null;
  text: string; error: string | null;
  activities: { id: string; type: string; status: string; text: string; observedAt: string }[];
  approvals: { id: string; rpcId: number | string; method: string; params: Record<string, unknown>; status: 'pending' | 'resolved' }[];
}
export interface WorkspaceState {
  version: 1; hostId: string; connections: Connection[]; participants: Member[]; discussions: Discussion[];
  bindings: ExecutionBinding[]; jobs: CodexJob[];
  sessions: { hash: string; expiresAt: number }[];
  grants: { id: string; hash: string; discussionId: string; participantId: string; tools: string[]; revoked: boolean }[];
  browserPaused: boolean;
  materialPackages?: MaterialPackage[];
}
export interface DurableEvent { id: number; type: string; discussionId: string | null; at: string; data: unknown }
export function initialState(hostId: string): WorkspaceState {
  return { version: 1, hostId, connections: [], participants: [
    { id: 'fake-a', label: '모의 참여자 A', kind: 'fake', connectionId: null, modelId: 'fixture-v1', role: '제안과 근거 정리' },
    { id: 'fake-b', label: '모의 참여자 B', kind: 'fake', connectionId: null, modelId: 'fixture-v1', role: '반례와 불확실성 검토' },
  ], discussions: [], bindings: [], jobs: [], sessions: [], grants: [], browserPaused: false };
}
