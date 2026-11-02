import { randomBytes } from 'node:crypto';
import type { WorkspaceState } from './model.js';
import type { Store } from './store.js';
import type { Vault } from './vault.js';
import { dotTools, dotEventName, type DotGrant, type DotMcpState } from './dot-mcp-model.js';
import { participantIdentity } from './wiki-policy.js';
import { onlyWork, workRoom } from './work-policy.js';
import { AppError, digest, id, integer, now, object, string, strings } from './util.js';

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const count = (v: unknown, min = 1) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
export function readDotState(s: WorkspaceState): DotMcpState | undefined {
  const d = s.dotMcp;
  if (d === undefined) { if (s.connections.some(c => c.kind === 'dot-mcp')) throw new AppError('dot_state_missing', 503); return; }
  if (!d || d.schemaVersion !== 1) throw new AppError('unsupported_dot_schema', 503);
  if (!d.migration || !date(d.migration.at) || !count(d.migration.basisCursor, 0) || !Array.isArray(d.bindings) || !Array.isArray(d.grants) ||
      d.bindings.some(b => !b || ![b.connectionId, b.participantId, b.roomId].every(text) || !count(b.version) || !date(b.createdAt) ||
        !['pending', 'paired', 'revoked'].includes(b.status) || !['unverified', 'owner_confirmed'].includes(b.identity) || b.nativeActorVerified !== false || b.status === 'paired' && b.identity !== 'owner_confirmed') ||
      d.grants.some(g => !g || ![g.id, g.connectionId, g.participantId, g.roomId].every(text) || ![g.version, g.epoch, g.contextGeneration].every(v => count(v)) ||
        !hash(g.hash) || !hash(g.identityDigest) || !date(g.expiresAt) || !date(g.createdAt) || !['prepared', 'active', 'revoked'].includes(g.status) ||
        !Array.isArray(g.tools) || !g.tools.length || new Set(g.tools).size !== g.tools.length || g.tools.some(t => !(dotTools as readonly string[]).includes(t))) ||
      new Set(d.bindings.map(b => b.connectionId)).size !== d.bindings.length || new Set(d.bindings.map(b => b.participantId)).size !== d.bindings.length ||
      new Set(d.grants.map(g => g.id)).size !== d.grants.length || new Set(d.grants.map(g => g.hash)).size !== d.grants.length ||
      d.grants.some(g => !d.bindings.some(b => b.connectionId === g.connectionId && b.participantId === g.participantId && b.roomId === g.roomId))) throw new AppError('dot_state_invalid', 503);
  if (d.events !== undefined) {
    const e = d.events; const invalid = () => { throw new AppError('dot_events_state_invalid', 503); };
    if (!e || e.version !== 1 || !Array.isArray(e.subscriptions) || !Array.isArray(e.outbox)) invalid();
    for (const sub of e.subscriptions) {
      if (!sub || ![sub.id, sub.grantId, sub.credentialRef].every(text) || !count(sub.version) || !hash(sub.callbackHash) || !hash(sub.secretHash) ||
          !['prepared', 'active', 'revoked', 'expired', 'failed'].includes(sub.status) || !date(sub.expiresAt) || sub.verifiedUntil !== null && !date(sub.verifiedUntil) ||
          !Array.isArray(sub.credentialRefs) || !sub.credentialRefs.every(text) || !sub.credentialRefs.includes(sub.credentialRef) ||
          !d.grants.some(g => g.id === sub.grantId) || sub.cursor !== null && !text(sub.cursor)) invalid();
    }
    for (const row of e.outbox) {
      if (!row || ![row.id, row.subscriptionId, row.requestId].every(text) || typeof row.body !== 'string' || Buffer.byteLength(row.body) > 262144 || digest(row.body) !== row.digest ||
          !['pending', 'sending', 'delivered', 'held', 'failed'].includes(row.status) || !date(row.nextAttemptAt) || row.reason !== null && !text(row.reason) ||
          !Array.isArray(row.attempts) || row.attempts.length > 5 || row.attempts.some(a => !a || !date(a.at) || a.finishedAt !== null && !date(a.finishedAt) ||
            a.httpStatus !== null && !count(a.httpStatus, 0) || a.error !== null && !text(a.error))) invalid();
      const sub = e.subscriptions.find(v => v.id === row.subscriptionId); const g = d.grants.find(v => v.id === sub?.grantId);
      try { const body = object(JSON.parse(row.body));
        if (!g || !date(body.timestamp) || row.body !== JSON.stringify({ eventId: row.id, name: dotEventName, timestamp: body.timestamp,
          data: { roomId: g.roomId, participantId: g.participantId, connectionId: g.connectionId, requestId: row.requestId, status: 'requested' }, cursor: row.id })) invalid();
      } catch { invalid(); }
    }
    if (new Set(e.subscriptions.map(s => s.id)).size !== e.subscriptions.length || new Set(e.outbox.map(r => r.id)).size !== e.outbox.length ||
        new Set(e.outbox.map(r => JSON.stringify([r.subscriptionId, r.requestId]))).size !== e.outbox.length ||
        e.subscriptions.some(s => s.cursor !== null && !e.outbox.some(r => r.subscriptionId === s.id && r.id === s.cursor && r.status === 'delivered'))) invalid();
  }
  return d;
}

// Owner-facing lifecycle only. D2/D3 provide the authenticated MCP transport and
// completion adapter; a confirmed binding is not a native actor attestation.
export class DotMcp {
  constructor(private readonly store: Store, private readonly vault: Vault, private readonly enabled: boolean) {
    if (!readDotState(store.read()) && enabled) {
      const basisCursor = store.cursor();
      store.transact(s => { s.dotMcp = { schemaVersion: 1, migration: { at: now(), basisCursor }, bindings: [], grants: [] }; },
        { id: 'migration:dot-mcp-v1', input: { schemaVersion: 1 } });
      if (!readDotState(store.read())) throw new AppError('dot_state_missing', 503);
    }
    // Prepared grants never become active by recovery. A missing/mismatched
    // encrypted credential also revokes the binding before any dispatch starts.
    const invalid = store.read().dotMcp?.grants.filter(g => g.status === 'prepared' || g.status === 'active' && !this.credential(g)).map(g => g.id) ?? [];
    if (invalid.length) store.transact((s, emit) => {
      for (const g of s.dotMcp!.grants.filter(g => invalid.includes(g.id))) {
        g.status = 'revoked'; const b = s.dotMcp!.bindings.find(b => b.connectionId === g.connectionId)!;
        if (b.version === g.version) this.revokeInState(s, b.connectionId);
        emit({ type: 'dot.credential_reconciled', discussionId: null, data: { grantId: g.id, connectionId: g.connectionId } });
      }
    });
  }
  private available(): void { if (!this.enabled) throw new AppError('dot_disabled', 409); }
  private credential(g: DotGrant): string | null {
    try { const v = this.vault.get<{ token?: unknown }>(g.id); return typeof v?.token === 'string' && digest(v.token) === g.hash ? v.token : null; }
    catch { return null; }
  }
  register(input: unknown, requestId: string): { connectionId: string; participantId: string } {
    this.available(); const b = object(input); onlyWork(b, ['roomId', 'label', 'role']);
    const roomId = string(b.roomId, 200); const label = string(b.label, 80); const role = string(b.role ?? '', 500, true);
    return this.store.transact((s, emit) => {
      const room = workRoom(s, roomId); const connectionId = id('connection'); const participantId = id('participant');
      s.connections.push({ id: connectionId, kind: 'dot-mcp', label, models: [], status: 'unverified', error: 'dot_transport_not_ready' });
      s.participants.push({ id: participantId, connectionId, kind: 'dot-mcp', label, role, modelId: 'native-dot' });
      s.dotMcp!.bindings.push({ connectionId, participantId, roomId, version: 1, status: 'pending', identity: 'unverified', nativeActorVerified: false, createdAt: now() });
      room.members.push({ participantId, enabled: false }); room.version++; room.updatedAt = now();
      emit({ type: 'dot.registered', discussionId: null, data: { connectionId, participantId, roomId } }); return { connectionId, participantId };
    }, { id: 'dot:register:' + string(requestId, 200), input: b });
  }
  confirm(input: unknown, requestId: string): { id: string; token: string } {
    this.available(); const b = object(input); onlyWork(b, ['connectionId', 'expectedVersion', 'ownerConfirmed', 'tools', 'expiresAt']);
    if (b.ownerConfirmed !== true) throw new AppError('dot_owner_confirmation_required', 409);
    const connectionId = string(b.connectionId, 200); const version = integer(b.expectedVersion, -1, 1, Number.MAX_SAFE_INTEGER);
    const tools = strings(b.tools, dotTools.length); if (!tools.length || new Set(tools).size !== tools.length || tools.some(t => !(dotTools as readonly string[]).includes(t))) throw new AppError('invalid_tools');
    const expiresAt = string(b.expiresAt, 100); const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 7 * 86400000) throw new AppError('invalid_grant_expiry');
    const token = randomBytes(32).toString('base64url'); let prepared = false;
    const result = this.store.transact((s, emit) => {
      const binding = s.dotMcp!.bindings.find(v => v.connectionId === connectionId);
      const c = s.connections.find(c => c.id === connectionId && c.kind === 'dot-mcp');
      const p = s.participants.find(p => p.id === binding?.participantId && p.kind === 'dot-mcp' && p.connectionId === connectionId);
      if (!binding || !c || !p) throw new AppError('dot_connection_not_found', 404);
      if (binding.version !== version) throw new AppError('dot_version_conflict', 409);
      const room = workRoom(s, binding.roomId);
      this.revokeInState(s, connectionId); binding.status = 'pending'; binding.identity = 'unverified';
      const g: DotGrant = { id: id('dot_grant'), connectionId, roomId: room.id, participantId: p.id, version: binding.version,
        epoch: room.epoch, contextGeneration: room.contexts?.find(c => c.participantId === p.id)?.generation ?? 1, identityDigest: participantIdentity(p),
        hash: digest(token), tools, expiresAt, status: 'prepared', createdAt: now() };
      s.dotMcp!.grants.push(g); prepared = true;
      emit({ type: 'dot.grant_prepared', discussionId: null, data: { connectionId, grantId: g.id, version: g.version } }); return { id: g.id };
    }, { id: 'dot:confirm:' + string(requestId, 200), input: b });
    if (prepared) {
      try { this.vault.put(result.id, { token }); } catch { throw new AppError('dot_credential_write_failed', 500); }
      this.store.transact((s, emit) => {
        const g = s.dotMcp!.grants.find(g => g.id === result.id)!; const binding = s.dotMcp!.bindings.find(v => v.connectionId === connectionId)!;
        if (g.status !== 'prepared' || binding.version !== g.version || !this.credential(g)) throw new AppError('dot_grant_not_ready', 409);
        g.status = 'active'; binding.status = 'paired'; binding.identity = 'owner_confirmed';
        emit({ type: 'dot.owner_confirmed', discussionId: null, data: { connectionId, grantId: g.id, version: g.version } });
      });
    }
    const g = this.store.read().dotMcp!.grants.find(g => g.id === result.id)!; const secret = this.credential(g);
    if (g.status !== 'active' || !secret) throw new AppError('dot_grant_not_ready', 409);
    // The command journal contains the grant ID only, never the raw credential.
    return { id: g.id, token: secret };
  }
  authenticate(token: string): DotGrant {
    this.available(); const g = this.store.read().dotMcp?.grants.find(g => g.hash === digest(token));
    if (!g) throw new AppError('mcp_authentication_required', 401);
    this.check(g, g.tools[0]!, { roomId: g.roomId, participantId: g.participantId }); return g;
  }
  check(g: DotGrant, tool: string, scope: { roomId: string; participantId: string }, state = this.store.read()): void {
    this.available(); const d = readDotState(state); const current = d?.grants.find(v => v.id === g.id);
    const binding = d?.bindings.find(v => v.connectionId === g.connectionId);
    if (!current || JSON.stringify(current) !== JSON.stringify(g) || g.status !== 'active' || Date.parse(g.expiresAt) <= Date.now() ||
        !binding || binding.status !== 'paired' || binding.version !== g.version || binding.identity !== 'owner_confirmed' ||
        binding.roomId !== g.roomId || binding.participantId !== g.participantId || !this.credential(g)) throw new AppError('mcp_authentication_required', 401);
    const room = state.resident?.rooms.find(r => r.id === g.roomId); const p = state.participants.find(p => p.id === g.participantId);
    if (!g.tools.includes(tool) || scope.roomId !== g.roomId || scope.participantId !== g.participantId || !room || !p || p.kind !== 'dot-mcp' ||
        p.connectionId !== g.connectionId || !state.connections.some(c => c.id === g.connectionId && c.kind === 'dot-mcp') || participantIdentity(p) !== g.identityDigest ||
        !room.members.some(m => m.participantId === p.id && m.enabled && !m.blockedReason) || room.epoch !== g.epoch ||
        (room.contexts?.find(c => c.participantId === p.id)?.generation ?? 1) !== g.contextGeneration) throw new AppError('dot_scope_changed', 403);
  }
  revoke(connectionId: string, expectedVersion: number, requestId: string): void {
    this.available(); this.store.transact((s, emit) => {
      const b = s.dotMcp?.bindings.find(b => b.connectionId === connectionId);
      if (!b) throw new AppError('dot_connection_not_found', 404);
      if (b.version !== expectedVersion) throw new AppError('dot_version_conflict', 409);
      this.revokeInState(s, connectionId); emit({ type: 'dot.revoked', discussionId: null, data: { connectionId, version: b.version } });
    }, { id: 'dot:revoke:' + string(requestId, 200), input: { connectionId, expectedVersion } });
  }
  revokeInState(s: WorkspaceState, connectionId: string): void {
    const b = s.dotMcp?.bindings.find(v => v.connectionId === connectionId); if (!b) return;
    b.version++; b.status = 'revoked';
    for (const g of s.dotMcp!.grants) if (g.connectionId === connectionId) g.status = 'revoked';
    for (const sub of s.dotMcp!.events?.subscriptions ?? []) if (s.dotMcp!.grants.some(g => g.id === sub.grantId && g.connectionId === connectionId)) {
      sub.status = 'revoked'; sub.version++;
      for (const e of s.dotMcp!.events!.outbox) if (e.subscriptionId === sub.id && ['pending', 'sending'].includes(e.status)) { e.status = 'held'; e.reason = 'grant_revoked'; }
    }
    const c = s.connections.find(c => c.id === connectionId); if (c) { c.status = 'unverified'; c.error = 'dot_transport_not_ready'; }
  }
  cleanup(connectionId: string): void {
    const d = this.store.read().dotMcp;
    for (const g of d?.grants ?? []) if (g.connectionId === connectionId) {
      this.vault.remove(g.id);
      for (const sub of d?.events?.subscriptions ?? []) if (sub.grantId === g.id) for (const ref of sub.credentialRefs) this.vault.remove(ref);
    }
  }
  snapshot() {
    const d = this.store.read().dotMcp;
    return { enabled: this.enabled, transportReady: false, bindings: (d?.bindings ?? []).map(b => ({ ...b })),
      grants: (d?.grants ?? []).map(g => { let active = false; try { this.check(g, g.tools[0]!, g); active = true; } catch { /* Display stale scopes as inactive. */ }
        const { hash: _hash, identityDigest: _identityDigest, ...metadata } = g; return { ...metadata, active }; }) };
  }
}
