export interface WikiSourceRef {
  kind: 'message' | 'report' | 'wiki'; id: string; digest: string; version?: number;
  status: 'reported' | 'observed' | 'not_run';
}
export interface WikiPage {
  id: string; roomId: string; scopeRef: string; slug: string; title: string; headVersion: number;
  createdAt: string; updatedAt: string;
}
export interface WikiVersion {
  id: string; pageId: string; roomId: string; scopeRef: string;
  version: number | null; baseVersion: number; conflictWith: number | null;
  title: string; body: string; digest: string; sourceRefs: WikiSourceRef[];
  authoredBy: string; contextGeneration: number | null; status: 'published' | 'conflict';
  epistemicStatus: 'reported'; tombstone: boolean; createdAt: string;
  editId: string; inputDigest: string;
}
export interface WikiCitation {
  pageId: string; version: number; digest: string; scopeRef: string; sourceRefs: WikiSourceRef[];
}
export interface WikiSnapshot extends WikiCitation { title: string; body: string; epistemicStatus: 'reported' }
export interface ResidentActorScope {
  roomId: string; participantId: string; scopeRef: string; scopeVersion: number;
  contextGeneration: number; epoch: number; identityDigest: string;
}
export interface ResidentGrant extends ResidentActorScope {
  kind: 'resident'; id: string; hash: string; tools: string[]; expiresAt: string;
  revoked: boolean; reason: string | null; createdAt: string;
}
