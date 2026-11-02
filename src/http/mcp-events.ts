import { randomBytes } from 'node:crypto';
import type { Store } from '../workspace/store.js';
import type { Vault } from '../workspace/vault.js';
import type { DotMcp } from '../workspace/dot-mcp.js';
import { dotEventName, type DotGrant, type DotSubscription, type DotEvent } from '../workspace/dot-mcp-model.js';
import type { WorkspaceState, DurableEvent } from '../workspace/model.js';
import { participantIdentity } from '../workspace/wiki-policy.js';
import { dotRequestCurrent } from '../workspace/dot-mcp-policy.js';
import { onlyWork } from '../workspace/work-policy.js';
import { AppError, digest, id, object, string } from '../workspace/util.js';
import { CallbackError, callbackUrl, challengeMatches, McpWebhook, signingKey, type WebhookTransport } from '../connections/mcp-webhook.js';

interface Credential { url: string; secret: string; previous?: { secret: string; until: number } }
type Emit = (event: Omit<DurableEvent, 'id' | 'at'>) => void;
const fields = { roomId: { type: 'string' }, participantId: { type: 'string' }, connectionId: { type: 'string' } };
const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const definition = { name: dotEventName, description: 'A reserved native dot turn is ready. Filters must match the connected grant. Delivery is not a completed answer.',
  delivery: ['webhook'],
  inputSchema: schema(fields), payloadSchema: schema({ ...fields, requestId: { type: 'string' }, status: { const: 'requested' } }) };
const iso = (clock: number) => new Date(clock).toISOString();

export class McpEvents {
  tools?: { list(): { name: string }[]; call(name: string, raw: unknown, grant: DotGrant): unknown };
  private readonly transport: WebhookTransport; private readonly clock: () => number;
  private readonly abort = new AbortController(); private readonly locks = new Map<string, Promise<unknown>>();
  private readonly unsubscribed = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>; private delivery: Promise<void> | undefined; private closed = false;
  constructor(private readonly store: Store, private readonly vault: Vault, private readonly dot: DotMcp, enabled: boolean,
    options: { transport?: WebhookTransport; clock?: () => number; guard?: (s: WorkspaceState, requestId: string) => boolean } = {}) {
    this.transport = options.transport ?? new McpWebhook(); this.clock = options.clock ?? Date.now; this.guard = options.guard;
    if (enabled && !store.read().dotMcp?.events) store.transact(s => { s.dotMcp!.events = { version: 1, subscriptions: [], outbox: [] }; },
      { id: 'migration:dot-events-v1', input: { version: 1 } });
    // Restart never completes a prepared subscription or replays a possibly sent turn.
    const events = store.read().dotMcp?.events;
    if (events && (events.subscriptions.some(s => s.status === 'prepared' || s.status === 'active' && !this.credential(s)) || events.outbox.some(e => ['pending', 'sending'].includes(e.status)))) {
      store.transact((s, emit) => {
        for (const sub of s.dotMcp!.events!.subscriptions) if (sub.status === 'prepared' || sub.status === 'active' && !this.credential(sub)) { sub.status = 'failed'; sub.version++; }
        for (const e of s.dotMcp!.events!.outbox) if (['pending', 'sending'].includes(e.status)) { e.status = 'held'; e.reason = 'restart_reconciliation_required'; }
        emit({ type: 'dot.events_reconciled', discussionId: null, data: { reason: 'restart_reconciliation_required' } });
      });
    }
  }
  private readonly guard: ((s: WorkspaceState, requestId: string) => boolean) | undefined;
  private check(g: DotGrant, state = this.store.read()): void {
    if (this.closed) throw new AppError('dot_events_closed', 409);
    this.dot.checkAuthority(g, 'dot_turn_get', g, state);
  }
  private credential(sub: DotSubscription): Credential | null {
    try { const c = this.vault.get<Credential>(sub.credentialRef);
      if (!c || digest(c.secret) !== sub.secretHash || digest(callbackUrl(c.url)) !== sub.callbackHash) return null;
      signingKey(c.secret); if (c.previous) { signingKey(c.previous.secret); if (!Number.isFinite(c.previous.until)) return null; } return c;
    } catch { return null; }
  }
  private parse(g: DotGrant, raw: unknown, subscribe: boolean) {
    this.check(g); const p = object(raw); onlyWork(p, subscribe ? ['name', 'arguments', 'delivery', 'ttlMs', 'cursor'] : ['name', 'arguments', 'delivery']);
    const a = object(p.arguments); onlyWork(a, Object.keys(fields)); const d = object(p.delivery); onlyWork(d, subscribe ? ['mode', 'url', 'secret'] : ['mode', 'url']);
    if (p.name !== dotEventName || d.mode !== 'webhook' || a.roomId !== g.roomId || a.participantId !== g.participantId || a.connectionId !== g.connectionId) throw new AppError('dot_event_not_in_scope', 403);
    const url = callbackUrl(d.url); const args = { roomId: g.roomId, participantId: g.participantId, connectionId: g.connectionId };
    const subId = 'dot_sub_' + digest(JSON.stringify([g.id, url, dotEventName, args]));
    return { p, d, url, subId };
  }
  async handle(method: string, raw: unknown, g: DotGrant): Promise<unknown> {
    this.check(g);
    if (method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {}, events: {} }, serverInfo: { name: 'webjjoku', version: '0.2.0' } };
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: this.tools?.list().filter(t => g.tools.includes(t.name)) ?? [] };
    if (method === 'tools/call') {
      if (!this.tools) throw new AppError('dot_transport_not_ready', 409);
      const p = object(raw); onlyWork(p, ['name', 'arguments']);
      const value = this.tools.call(string(p.name, 200), p.arguments ?? {}, g);
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
    }
    if (method === 'events/list') { const p = object(raw ?? {}); onlyWork(p, ['cursor']); if (p.cursor != null) throw new AppError('invalid_event_cursor'); return { events: [definition] }; }
    if (method === 'events/unsubscribe') {
      const { subId } = this.parse(g, raw, false);
      this.unsubscribed.set(subId, (this.unsubscribed.get(subId) ?? 0) + 1);
      this.store.transact((s, emit) => { this.check(g, s); const sub = s.dotMcp!.events!.subscriptions.find(v => v.id === subId);
        if (sub && sub.status !== 'revoked') { sub.status = 'revoked'; sub.version++; this.hold(s, sub.id, 'unsubscribed'); emit({ type: 'dot.unsubscribed', discussionId: null, data: { subscriptionId: sub.id } }); }
      }); return {};
    }
    if (method !== 'events/subscribe') throw new AppError('unknown_event_method', 404);
    const parsed = this.parse(g, raw, true); signingKey(parsed.d.secret);
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(10000)]);
    const ttl = parsed.p.ttlMs;
    if (ttl !== undefined && ttl !== null && (typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl <= 0)) throw new AppError('invalid_event_ttl');
    if (parsed.p.cursor != null) string(parsed.p.cursor, 200);
    // Serialize matching refreshes; unsubscribe and revocation can still fence a pending challenge.
    const previous = this.locks.get(parsed.subId) ?? Promise.resolve();
    const fence = this.unsubscribed.get(parsed.subId);
    const run = previous.catch(() => {}).then(() => {
      if (this.unsubscribed.get(parsed.subId) !== fence) throw new AppError('dot_subscription_changed', 409);
      if (signal.aborted) throw new CallbackError('timeout', true);
      return this.subscribe(g, parsed, typeof ttl === 'number' ? Math.min(ttl, 86400000) : 3600000, signal);
    });
    this.locks.set(parsed.subId, run);
    try { return await run; } finally { if (this.locks.get(parsed.subId) === run) this.locks.delete(parsed.subId); }
  }
  private async subscribe(g: DotGrant, input: ReturnType<McpEvents['parse']>, ttl: number, signal: AbortSignal) {
    this.check(g); const { subId, url, d, p } = input; const secret = d.secret as string;
    const old = this.store.read().dotMcp!.events!.subscriptions.find(s => s.id === subId); const oldCredential = old && this.credential(old);
    const cached = old?.status === 'active' && Date.parse(old.expiresAt) > this.clock() && Date.parse(old.verifiedUntil ?? '') > this.clock() && old.secretHash === digest(secret) && !!oldCredential;
    const ref = cached ? old.credentialRef : id('dot_callback'); const expiresAt = iso(Math.min(this.clock() + ttl, Date.parse(g.expiresAt)));
    const sub = this.store.transact((s, emit) => {
      this.check(g, s); const events = s.dotMcp!.events!; let current = events.subscriptions.find(v => v.id === subId);
      if (!current) { if (events.subscriptions.filter(v => v.grantId === g.id).length >= 100) throw new AppError('dot_subscription_limit', 409);
        current = { id: subId, grantId: g.id, callbackHash: digest(url), secretHash: digest(secret), credentialRef: ref, credentialRefs: [], version: 0, status: 'prepared', expiresAt, verifiedUntil: null, cursor: null }; events.subscriptions.push(current); }
      if (!cached) current.version++; current.status = cached ? 'active' : 'prepared'; current.expiresAt = expiresAt;
      current.credentialRef = ref; current.secretHash = digest(secret); if (!current.credentialRefs.includes(ref)) current.credentialRefs.push(ref);
      emit({ type: cached ? 'dot.subscription_refreshed' : 'dot.subscription_prepared', discussionId: null, data: { subscriptionId: subId, expiresAt } });
      return structuredClone(current);
    });
    if (!cached) {
      try {
        const c: Credential = { url, secret };
        if (old?.status === 'active' && oldCredential && oldCredential.secret !== secret) c.previous = { secret: oldCredential.secret, until: this.clock() + 300000 };
        this.vault.put(ref, c);
        const challenge = randomBytes(32).toString('base64url'); const body = JSON.stringify({ type: 'verification', challenge });
        const verify = () => { if (signal.aborted) throw new CallbackError('timeout', true); this.check(g); const current = this.store.read().dotMcp!.events!.subscriptions.find(s => s.id === subId)!;
          if (current.version !== sub.version || current.status !== 'prepared' || Date.parse(current.expiresAt) <= this.clock()) throw new AppError('dot_subscription_changed', 409); };
        verify(); const reply = await this.transport.post({ url, body, subscriptionId: subId, eventId: id('verification'), secrets: [secret], signal, beforeSend: verify });
        verify(); if (reply.status < 200 || reply.status >= 300 || !challengeMatches(reply.body, challenge)) throw new CallbackError('challenge_failed');
        this.store.transact((s, emit) => { this.check(g, s); const current = s.dotMcp!.events!.subscriptions.find(s => s.id === subId)!;
          if (current.version !== sub.version || current.status !== 'prepared') throw new AppError('dot_subscription_changed', 409);
          current.status = 'active'; current.verifiedUntil = iso(this.clock() + 600000);
          emit({ type: 'dot.subscribed', discussionId: null, data: { subscriptionId: subId, grantId: g.id } });
        });
      } catch (error) {
        this.store.transact((s, emit) => { const current = s.dotMcp!.events!.subscriptions.find(s => s.id === subId)!;
          if (current.version === sub.version) { current.status = 'failed'; emit({ type: 'dot.subscription_failed', discussionId: null, data: { subscriptionId: subId } }); }
        });
        if (error instanceof CallbackError || error instanceof AppError) throw error; throw new AppError('dot_callback_storage_failed', 500);
      }
    }
    const current = this.store.read().dotMcp!.events!.subscriptions.find(s => s.id === subId)!;
    return { id: subId, refreshBefore: current.expiresAt, cursor: current.cursor,
      truncated: p.cursor != null && p.cursor !== current.cursor || this.store.read().dotMcp!.events!.outbox.some(e => e.subscriptionId === subId && ['held', 'failed'].includes(e.status)) };
  }
  private assertTurn(s: WorkspaceState, g: DotGrant, requestId: string): void {
    this.check(g, s); const room = s.resident!.rooms.find(r => r.id === g.roomId)!;
    const request = s.dotMcp?.requests?.items.find(r => r.id === requestId);
    if (request) {
      if (!dotRequestCurrent(s, request, g) || !['prepared', 'waiting', 'received'].includes(request.status) || this.guard && !this.guard(s, requestId)) throw new AppError('dot_turn_not_reserved', 409);
      return;
    }
    // Legacy D2 reserved records keep their original, strict generation fence.
    this.dot.check(g, 'dot_turn_get', g, s);
    const lease = s.resident!.dispatchLeases.find(l => l.id === requestId);
    const discussion = s.discussions.find(d => d.turns.some(t => t.id === requestId));
    const turn = s.resident!.turns.find(t => t.id === requestId) ?? discussion?.turns.find(t => t.id === requestId);
    const participant = turn && ('participant' in turn ? turn.participant : discussion?.members.find(p => p.id === g.participantId));
    if (!room.desiredOn || !lease || !['reserved', 'running'].includes(lease.state) || lease.roomId !== g.roomId || lease.participantId !== g.participantId ||
      !turn || !['prepared', 'running'].includes(turn.status) || turn.participantId !== g.participantId || turn.generation !== lease.generation || !participant || participantIdentity(participant) !== g.identityDigest ||
      'epoch' in turn && (turn.epoch !== g.epoch || turn.generation !== g.contextGeneration) ||
      discussion && (discussion.roomId !== g.roomId || discussion.status !== 'running' || discussion.revision !== ('revision' in turn ? turn.revision : null) || discussion.contexts.find(c => c.participantId === g.participantId)?.generation !== turn.generation) ||
      this.guard && !this.guard(s, requestId)) throw new AppError('dot_turn_not_reserved', 409);
  }
  // D3 calls this inside its original turn transaction. No public enqueue RPC exists.
  queueTurn(s: WorkspaceState, emit: Emit, grantId: string, requestId: string): string[] {
    const g = s.dotMcp?.grants.find(g => g.id === grantId); if (!g) throw new AppError('dot_grant_not_found', 403); this.assertTurn(s, g, requestId);
    const events = s.dotMcp!.events!; const ids: string[] = [];
    for (const sub of events.subscriptions.filter(v => v.grantId === g.id && v.status === 'active' && Date.parse(v.expiresAt) > this.clock())) {
      const existing = events.outbox.find(e => e.subscriptionId === sub.id && e.requestId === requestId);
      if (existing) { ids.push(existing.id); continue; }
      const eventId = id('dot_event'); const body = JSON.stringify({ eventId, name: dotEventName, timestamp: iso(this.clock()),
        data: { roomId: g.roomId, participantId: g.participantId, connectionId: g.connectionId, requestId, status: 'requested' }, cursor: eventId });
      events.outbox.push({ id: eventId, subscriptionId: sub.id, requestId, body, digest: digest(body), status: 'pending', reason: null, nextAttemptAt: iso(this.clock()), attempts: [] }); ids.push(eventId);
      emit({ type: 'dot.event_queued', discussionId: null, data: { eventId, subscriptionId: sub.id, requestId } });
    }
    if (!ids.length) throw new AppError('dot_subscription_required', 409); return ids;
  }
  private hold(s: WorkspaceState, subId: string, reason: string): void {
    for (const e of s.dotMcp!.events!.outbox) if (e.subscriptionId === subId && ['pending', 'sending'].includes(e.status)) { e.status = 'held'; e.reason = reason; }
  }
  private deliveryScope(s: WorkspaceState, e: DotEvent) {
    const sub = s.dotMcp!.events!.subscriptions.find(v => v.id === e.subscriptionId)!; const g = s.dotMcp!.grants.find(g => g.id === sub.grantId)!;
    this.assertTurn(s, g, e.requestId);
    if (sub.status !== 'active' || Date.parse(sub.expiresAt) <= this.clock() || digest(e.body) !== e.digest) throw new AppError('dot_subscription_inactive', 409);
    const credential = this.credential(sub); if (!credential) throw new AppError('dot_callback_credential_missing', 409); return { sub, credential };
  }
  start(): void { if (!this.closed && !this.timer) { this.timer = setInterval(() => { void this.pump().catch(() => this.failClosed()); }, 1000); this.timer.unref(); } }
  private failClosed(): void {
    if (this.closed) return; this.closed = true; clearInterval(this.timer); this.abort.abort();
    try { this.store.transact((s, emit) => {
      for (const sub of s.dotMcp?.events?.subscriptions ?? []) this.hold(s, sub.id, 'delivery_worker_failed');
      emit({ type: 'dot.event_worker_failed', discussionId: null, data: { reason: 'delivery_worker_failed' } });
    }); } catch { /* Storage failure: stop sending; the persisted intent is reconciled on restart. */ }
  }
  pump(): Promise<void> { return this.delivery ??= Promise.resolve().then(() => this.deliver()).finally(() => { this.delivery = undefined; }); }
  private async deliver(): Promise<void> {
    if (this.closed || !this.store.read().dotMcp?.events) return;
    const state = this.store.read(); const inactive = state.dotMcp!.events!.subscriptions.filter(sub => {
      if (sub.status !== 'active') return false;
      try { this.check(state.dotMcp!.grants.find(g => g.id === sub.grantId)!, state); return Date.parse(sub.expiresAt) <= this.clock(); } catch { return true; }
    });
    if (inactive.length) this.store.transact((s, emit) => { for (const prior of inactive) { const sub = s.dotMcp!.events!.subscriptions.find(v => v.id === prior.id)!;
      sub.status = Date.parse(sub.expiresAt) <= this.clock() ? 'expired' : 'revoked'; this.hold(s, sub.id, 'subscription_inactive');
      emit({ type: 'dot.subscription_inactive', discussionId: null, data: { subscriptionId: sub.id, status: sub.status } });
    } });
    const events = this.store.read().dotMcp!.events!;
    const next = events.outbox.find((e, i, all) => e.status === 'pending' && Date.parse(e.nextAttemptAt) <= this.clock() &&
      this.store.read().dotMcp?.requests?.items.find(r => r.id === e.requestId)?.status !== 'prepared' &&
      !all.slice(0, i).some(p => p.subscriptionId === e.subscriptionId && !['delivered', 'settled'].includes(p.status)));
    if (!next) return;
    let scope: ReturnType<McpEvents['deliveryScope']>;
    try { scope = this.deliveryScope(this.store.read(), next); }
    catch { this.store.transact((s, emit) => { const e = s.dotMcp!.events!.outbox.find(e => e.id === next.id)!; e.status = 'held'; e.reason = 'delivery_scope_changed';
      emit({ type: 'dot.event_held', discussionId: null, data: { eventId: e.id, reason: e.reason } });
    }); return; }
    this.store.transact((s, emit) => { const e = s.dotMcp!.events!.outbox.find(e => e.id === next.id)!; this.deliveryScope(s, e);
      e.status = 'sending'; e.attempts.push({ at: iso(this.clock()), finishedAt: null, httpStatus: null, error: null });
      emit({ type: 'dot.event_attempted', discussionId: null, data: { eventId: e.id, attempt: e.attempts.length } });
    });
    let status: number | null = null; let error: string | null = null; let retry = false;
    const beforeSend = () => { const s = this.store.read(); const current = s.dotMcp!.events!.outbox.find(e => e.id === next.id)!;
      this.deliveryScope(s, current); if (current.status !== 'sending' || s.dotMcp!.events!.subscriptions.find(v => v.id === current.subscriptionId)!.version !== scope.sub.version) throw new AppError('dot_delivery_changed', 409); };
    try {
      const c = scope.credential; const secrets = [c.secret, ...(c.previous && c.previous.until > this.clock() ? [c.previous.secret] : [])]; beforeSend();
      const reply = await this.transport.post({ url: c.url, body: next.body, subscriptionId: scope.sub.id, eventId: next.id, secrets, signal: this.abort.signal, beforeSend });
      status = reply.status; if (status < 200 || status >= 300) { error = 'http_' + status; retry = [408, 425, 429].includes(status) || status >= 500 && status <= 599; }
    } catch (e) { error = e instanceof CallbackError ? e.reason : 'delivery_scope_changed'; retry = e instanceof CallbackError && e.retryable; }
    this.store.transact((s, emit) => { const e = s.dotMcp!.events!.outbox.find(e => e.id === next.id)!; const attempt = e.attempts.at(-1)!;
      attempt.finishedAt = iso(this.clock()); attempt.httpStatus = status; attempt.error = error;
      let valid = !this.closed && e.status === 'sending'; try { this.deliveryScope(s, e); } catch { valid = false; }
      if (e.status === 'settled') { /* Original turn already resolved; preserve the actual HTTP observation without replay. */ }
      else if (!valid) { e.status = 'held'; e.reason = 'delivery_scope_changed'; }
      else if (!error) { e.status = 'delivered'; e.reason = null; s.dotMcp!.events!.subscriptions.find(v => v.id === e.subscriptionId)!.cursor = e.id; }
      else if (retry && e.attempts.length < 5) { e.status = 'pending'; e.reason = error; e.nextAttemptAt = iso(this.clock() + 1000 * 2 ** (e.attempts.length - 1)); }
      else { e.status = 'failed'; e.reason = error; }
      emit({ type: 'dot.event_delivery', discussionId: null, data: { eventId: e.id, status: e.status, httpStatus: status, error } });
    });
  }
  async close(): Promise<void> { this.closed = true; clearInterval(this.timer); this.abort.abort(); await Promise.allSettled([...this.locks.values(), ...(this.delivery ? [this.delivery] : [])]); }
}
