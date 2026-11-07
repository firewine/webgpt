export interface ExecutionAuthority { version: 1; epoch: number; issuedAt: string; expiresAt: string; revokedAt: string | null }
export interface JobAuthority { version: 1; binding: { id: string; epoch: number; expiresAt: string; scopeDigest: string }; grant?: { id: string; epoch: number; expiresAt: string; scopeDigest: string }; discussion?: { scopeDigest: string } }
