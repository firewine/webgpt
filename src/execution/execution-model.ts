export interface ExecutionAuthority { version: 1; epoch: number; issuedAt: string; expiresAt: string; revokedAt: string | null }
export interface JobAuthority { version: 1; binding: { id: string; epoch: number; expiresAt: string; scopeDigest: string }; grant?: { id: string; epoch: number; expiresAt: string; scopeDigest: string }; discussion?: { scopeDigest: string } }
export interface ScopedCommandApproval {
  version: 1;
  state: 'checking' | 'ready' | 'blocked' | 'selected' | 'sent' | 'unconfirmed';
  digest: string; requestDigest: string; contextDigest: string;
  command: string; cwd: string; profileId: 'webjjoku_read' | 'webjjoku_copy';
  reason: string | null;
  choice?: { commandId: string; selectedAt: string; delivery: 'prepared' | 'sending' | 'sent' | 'unconfirmed' | 'cancelled' };
}
