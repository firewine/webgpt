import { randomBytes } from 'node:crypto';
import type { Completion, CompletionInput } from './providers.js';
import type { Store } from '../workspace/store.js';
import type { Vault } from '../workspace/vault.js';
import type { DotMcp } from '../workspace/dot-mcp.js';
import type { DotGrant, DotRequest } from '../workspace/dot-mcp-model.js';
import { dotEventName } from '../workspace/dot-mcp-model.js';
import type { WorkspaceState, ModelChoice } from '../workspace/model.js';
import type { McpEvents } from '../http/mcp-events.js';
import { dotGrants, dotInputDigest, dotParticipantWait, dotRequestCurrent, dotTurn } from '../workspace/dot-mcp-policy.js';
import { participantIdentity } from '../workspace/wiki-policy.js';
import { onlyWork } from '../workspace/work-policy.js';
import { AppError, digest, id, now, object, string } from '../workspace/util.js';

type Emit = Parameters<Parameters<Store['transact']>[0]>[1];
export type DotInput = Pick<CompletionInput, 'requestId' | 'participant' | 'prompt' | 'history'>;
const field = { type: 'string' };
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  { name: 'dot_turn_get', description: 'Get the reserved request metadata. Frozen input is returned only with the winning attempt credential. Never invent request IDs.',
    inputSchema: schema({ requestId: field, attemptId: field, attemptToken: field }, []), annotations: { readOnlyHint: true } },
  { name: 'dot_turn_claim', description: 'Claim one reserved turn with a unique commandId. Retry the same commandId to recover the same attempt; another claimant is rejected.',
    inputSchema: schema({ requestId: field, commandId: field }, ['requestId', 'commandId']), annotations: { idempotentHint: true } },
  { name: 'dot_turn_submit', description: 'Submit the exact JSON reply requested by the frozen input. A receipt means stored, not published or independently verified. Reuse commandId for retries.',
    inputSchema: schema({ requestId: field, attemptId: field, attemptToken: field, commandId: field, text: field }, ['requestId', 'attemptId', 'attemptToken', 'commandId', 'text']), annotations: { idempotentHint: true } },
];
export class DotMcpAdapter {
  constructor(private readonly store: Store, private readonly vault: Vault, private readonly dot: DotMcp, private readonly events: McpEvents, private readonly enabled: boolean,
    private readonly guard: (s: WorkspaceState, requestId: string) => boolean) {
    if (enabled && !store.read().dotMcp?.requests) store.transact(s => { s.dotMcp!.requests = { version: 1, items: [] }; }, { id: 'migration:dot-requests-v1', input: { version: 1 } });
    const requests = store.read().dotMcp?.requests?.items ?? [];
    if (requests.some(r => !['consumed', 'quarantined'].includes(r.status))) store.transact((s, emit) => {
      for (const r of s.dotMcp!.requests!.items) if (!['consumed', 'quarantined'].includes(r.status)) {
        const { turn } = dotTurn(s, r.id);
        if (['completed', 'failed', 'stale'].includes(turn.status)) { this.settle(s, r.id); continue; }
        r.status = 'held';
        if (r.reply) { turn.text = r.reply.text; turn.receipt = r.reply.receipt; }
        // Preserve mailbox evidence, never parse/publish a recovered reply here.
        emit({ type: 'dot.request_held', discussionId: r.discussionId, data: { requestId: r.id, receipt: r.reply?.receipt ?? null } });
      }
    });
  }
  private current(s: WorkspaceState, r: DotRequest, g: DotGrant, reconcile = false): boolean {
    return dotRequestCurrent(s, r, g, reconcile) && this.guard(s, r.id);
  }
  list() { return tools; }
  models(connectionId: string): ModelChoice[] {
    if (!this.enabled) throw new AppError('dot_disabled', 409);
    const s = this.store.read(); const b = s.dotMcp?.bindings.find(b => b.connectionId === connectionId); const p = s.participants.find(p => p.id === b?.participantId); const room = s.resident?.rooms.find(r => r.id === b?.roomId);
    if (!b || !p || !room || dotParticipantWait(s, room, p)) throw new AppError('dot_transport_not_ready', 409);
    return [{ id: 'native-dot', label: 'dot · 공식 플러그인' }];
  }
  prepare(s: WorkspaceState, emit: Emit, input: DotInput): void {
    if (input.participant.kind !== 'dot-mcp') return;
    if (!this.enabled) throw new AppError('dot_disabled', 409);
    const { turn, lease, room, participant, discussion } = dotTurn(s, input.requestId);
    if (dotParticipantWait(s, room, participant) || !room.desiredOn || turn.status !== 'prepared' || lease.state !== 'reserved') throw new AppError('dot_transport_not_ready', 409);
    if (participantIdentity(participant) !== participantIdentity(input.participant) || turn.prompt !== input.prompt || turn.promptDigest !== digest(input.prompt)) throw new AppError('dot_input_mismatch', 409);
    const grants = dotGrants(s, room, participant);
    const g = grants.find(g => s.dotMcp!.events!.subscriptions.some(sub => sub.grantId === g.id && sub.status === 'active' && Date.parse(sub.expiresAt) > Date.now()));
    if (!g) throw new AppError('dot_subscription_required', 409); this.dot.checkAuthority(g, 'dot_turn_get', g, s);
    if (s.dotMcp!.requests!.items.some(r => r.id === turn.id)) throw new AppError('dot_request_already_reserved', 409);
    const r: DotRequest = { id: turn.id, grantId: g.id, grantVersion: g.version, roomId: room.id, participantId: participant.id, connectionId: g.connectionId,
      epoch: room.epoch, contextGeneration: room.contexts?.find(c => c.participantId === participant.id)?.generation ?? 1, generation: turn.generation,
      discussionId: discussion?.id ?? null, revision: discussion?.revision ?? null, identityDigest: participantIdentity(participant), prompt: input.prompt, history: structuredClone(input.history),
      inputDigest: dotInputDigest(input.prompt, input.history), status: 'prepared', createdAt: now(), claim: null, reply: null };
    s.dotMcp!.requests!.items.push(r); this.events.queueTurn(s, emit, g.id, r.id);
    emit({ type: 'dot.request_prepared', discussionId: r.discussionId, data: { requestId: r.id, inputDigest: r.inputDigest } });
  }
  private request(s: WorkspaceState, g: DotGrant, requestId: unknown): DotRequest {
    const r = s.dotMcp?.requests?.items.find(r => r.id === string(requestId, 200) && r.grantId === g.id);
    if (!r) throw new AppError('dot_request_not_in_scope', 403); return r;
  }
  private token(r: DotRequest): string | null {
    try { const token = r.claim && this.vault.get<{ token?: unknown }>(r.claim.id)?.token; return typeof token === 'string' && digest(token) === r.claim!.hash ? token : null; } catch { return null; }
  }
  private claimCredential(r: DotRequest, args: Record<string, unknown>): void {
    if (!r.claim || r.claim.status !== 'active' || args.attemptId !== r.claim.id || typeof args.attemptToken !== 'string' || digest(args.attemptToken) !== r.claim.hash || !this.token(r)) throw new AppError('dot_attempt_not_in_scope', 403);
  }
  call(name: string, raw: unknown, g: DotGrant): unknown {
    this.dot.checkAuthority(g, g.tools[0]!, g); if (!g.tools.includes(name)) throw new AppError('dot_tool_not_granted', 403); const a = object(raw);
    if (name === 'dot_turn_get') {
      onlyWork(a, ['requestId', 'attemptId', 'attemptToken']); const s = this.store.read();
      const r = a.requestId ? this.request(s, g, a.requestId) : s.dotMcp!.requests!.items.findLast(r => r.grantId === g.id && ['prepared', 'waiting', 'received'].includes(r.status));
      const event = { name: dotEventName, arguments: { roomId: g.roomId, participantId: g.participantId, connectionId: g.connectionId } };
      if (!r) return { event, request: null };
      const metadata = { requestId: r.id, status: r.status, receipt: r.reply?.receipt ?? null };
      if (a.attemptId === undefined && a.attemptToken === undefined) return { event, request: metadata };
      this.claimCredential(r, a);
      if (!this.current(s, r, g) || !['waiting', 'received'].includes(r.status)) throw new AppError('dot_request_stale', 409);
      return { event, request: { ...metadata, prompt: r.prompt, history: r.history, inputDigest: r.inputDigest, usage: null } };
    }
    if (name === 'dot_turn_claim') {
      onlyWork(a, ['requestId', 'commandId']); const requestId = string(a.requestId, 200), commandId = string(a.commandId, 200); const token = randomBytes(32).toString('base64url'); let prepared = false;
      const result = this.store.transact((s, emit) => {
        this.dot.checkAuthority(g, name, g, s); const r = this.request(s, g, requestId);
        if (!this.current(s, r, g) || r.status !== 'waiting') throw new AppError('dot_request_stale', 409);
        if (r.claim) { if (r.claim.commandId !== commandId) throw new AppError('dot_already_claimed', 409); return { attemptId: r.claim.id }; }
        r.claim = { id: id('dot_attempt'), commandId, hash: digest(token), status: 'prepared' }; prepared = true;
        emit({ type: 'dot.claim_prepared', discussionId: r.discussionId, data: { requestId, attemptId: r.claim.id } }); return { attemptId: r.claim.id };
      }, { id: `dot:claim:${g.id}:${requestId}:${commandId}`, input: { requestId, commandId } });
      if (prepared) {
        try { this.vault.put(result.attemptId, { token }); } catch { throw new AppError('dot_claim_storage_failed', 500); }
        this.store.transact((s, emit) => { this.dot.checkAuthority(g, name, g, s); const r = this.request(s, g, requestId);
          if (!this.current(s, r, g) || r.status !== 'waiting' || r.claim?.id !== result.attemptId || !this.token(r)) throw new AppError('dot_request_stale', 409);
          r.claim.status = 'active'; emit({ type: 'dot.claimed', discussionId: r.discussionId, data: { requestId, attemptId: r.claim.id } });
        });
      }
      const r = this.request(this.store.read(), g, requestId); const saved = this.token(r);
      if (!saved || r.claim?.status !== 'active' || !this.current(this.store.read(), r, g) || r.status !== 'waiting') throw new AppError('dot_claim_requires_reconciliation', 409);
      return { requestId, attemptId: result.attemptId, attemptToken: saved };
    }
    if (name === 'dot_turn_submit') {
      onlyWork(a, ['requestId', 'attemptId', 'attemptToken', 'commandId', 'text']); string(a.text, 100000);
      const text = a.text as string, commandId = string(a.commandId, 200); // Validate without trimming the original reply.
      const before = this.request(this.store.read(), g, a.requestId); this.claimCredential(before, a);
      return this.store.transact((s, emit) => {
        this.dot.checkAuthority(g, name, g, s); const r = this.request(s, g, a.requestId); this.claimCredential(r, a);
        if (r.reply) { if (r.reply.digest !== digest(text)) throw new AppError('dot_reply_conflict', 409); return { accepted: r.reply.disposition === 'received', receipt: r.reply.receipt, disposition: r.reply.disposition }; }
        const current = this.current(s, r, g, true) && ['waiting', 'held'].includes(r.status);
        r.reply = { text, digest: digest(text), receipt: id('dot_reply'), at: now(), disposition: current ? 'received' : 'quarantined' };
        const held = r.status === 'held';
        r.status = current ? held ? 'held' : 'received' : 'quarantined';
        if (held) { const { turn } = dotTurn(s, r.id); turn.text = text; turn.receipt = r.reply.receipt; }
        emit({ type: 'dot.reply_received', discussionId: r.discussionId, data: { requestId: r.id, receipt: r.reply.receipt, disposition: r.reply.disposition } });
        return { accepted: current, receipt: r.reply.receipt, disposition: r.reply.disposition };
      }, { id: `dot:submit:${g.id}:${before.id}:${commandId}`, input: { requestId: before.id, attemptId: a.attemptId, textDigest: digest(text) } });
    }
    throw new AppError('dot_tool_not_granted', 403);
  }
  async complete(input: CompletionInput): Promise<Completion> {
    if (!this.enabled) throw new AppError('dot_disabled', 409);
    const s = this.store.read(); const r = s.dotMcp?.requests?.items.find(r => r.id === input.requestId);
    if (!r) throw new AppError('dot_transport_not_ready', 409);
    const g = s.dotMcp!.grants.find(g => g.id === r.grantId)!;
    if (r.status !== 'prepared' || r.inputDigest !== dotInputDigest(input.prompt, input.history) || participantIdentity(input.participant) !== r.identityDigest || !this.current(s, r, g)) throw new AppError('dot_request_stale', 409);
    input.signal.throwIfAborted(); input.hooks.dispatched();
    this.store.transact((s, emit) => { const current = this.request(s, g, r.id);
      if (!this.current(s, current, g)) throw new AppError('dot_request_stale', 409, true);
      current.status = 'waiting'; emit({ type: 'dot.request_waiting', discussionId: r.discussionId, data: { requestId: r.id } });
    });
    const result = await new Promise<Completion>((resolve, reject) => {
      let done = false; let unsubscribe = () => {};
      const finish = (value: Completion | null) => { if (done) return; done = true; unsubscribe(); input.signal.removeEventListener('abort', abort);
        if (value) resolve(value); else reject(new AppError('dot_reply_unconfirmed', 409, true)); };
      const abort = () => finish(null);
      const inspect = () => { try { const state = this.store.read(); const current = this.request(state, g, r.id);
        if (!this.current(state, current, g) || ['held', 'quarantined'].includes(current.status)) return finish(null);
        if (current.reply) finish({ text: current.reply.text, receipt: current.reply.receipt, usage: null });
      } catch { finish(null); } };
      unsubscribe = this.store.subscribe(inspect); input.signal.addEventListener('abort', abort, { once: true }); if (input.signal.aborted) abort(); else inspect();
      void this.events.pump().catch(abort);
    });
    input.hooks.receipt(result.receipt!); return result;
  }
  settle(s: WorkspaceState, requestId: string): void {
    const r = s.dotMcp?.requests?.items.find(r => r.id === requestId); if (!r) return;
    const { turn } = dotTurn(s, requestId);
    r.status = turn.status === 'unconfirmed' ? 'held' : turn.status === 'stale' || r.reply?.disposition === 'quarantined' ? 'quarantined' : 'consumed';
    for (const e of s.dotMcp!.events!.outbox) if (e.requestId === requestId && e.status !== 'delivered') {
      e.status = r.status === 'held' ? 'held' : 'settled'; e.reason = r.status === 'held' ? 'request_requires_reconciliation' : 'original_turn_settled';
    }
  }
}
