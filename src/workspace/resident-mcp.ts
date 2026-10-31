import { randomBytes } from 'node:crypto';
import type { Workspace } from './runtime.js';
import type { WorkspaceState } from './model.js';
import type { ResidentGrant } from './wiki-model.js';
import { actorScope, assertActor, contextWiki, wikiActorCanEdit, visibleRoomMessages } from './wiki-policy.js';
import { budgetReason } from './dispatch.js';
import { onlyWork, workRoom } from './work-policy.js';
import { AppError, digest, id, integer, now, object, string, strings } from './util.js';

export const residentTools = ['resident_context_get', 'resident_message_post', 'resident_work_list', 'resident_work_propose', 'resident_work_claim', 'resident_wiki_list', 'resident_wiki_get', 'resident_wiki_edit'] as const;
const readTools = new Set(['resident_context_get', 'resident_work_list', 'resident_wiki_list', 'resident_wiki_get']);
const str = { type: 'string' }; const num = { type: 'integer', minimum: 0 };
const sourceRef = { type: 'object', properties: { kind: { enum: ['message', 'report', 'wiki'] }, id: str, version: { ...num, minimum: 1 }, digest: str }, required: ['kind', 'id'], additionalProperties: false };
const criterion = { type: 'object', properties: { id: str, text: str, check: { type: 'object', properties: { kind: { enum: ['manual', 'text_includes', 'execution'] }, value: str }, required: ['kind'], additionalProperties: false } }, required: ['id', 'text'], additionalProperties: false };
const required: Record<string, string[]> = {
  resident_message_post: ['requestId', 'text'], resident_work_claim: ['requestId', 'taskId', 'expectedVersion'],
  resident_work_propose: ['requestId', 'proposalKey', 'title', 'kind', 'sourceMessageIds', 'acceptance', 'allowedParticipantIds', 'authorizedScopeRef'],
  resident_wiki_edit: ['requestId', 'title', 'body', 'scopeRef', 'expectedVersion', 'sourceRefs'], resident_wiki_get: ['pageId'],
};
export const residentDescriptions: Record<string, string> = {
  resident_context_get: 'Read this room grant’s public messages and permitted Wiki snapshots with exact versions/digests. Excludes private drafts, other actor histories and other scopes.',
  resident_message_post: 'Post one reported public message as the granted participant. Reuse requestId on retries; cannot approve tools or change roles.',
  resident_work_list: 'List in-scope work metadata (up to 50); task status belongs to the existing queue, not to Wiki assertions.',
  resident_work_propose: 'Propose work from public source messages and acceptance criteria within the existing role policy. Does not start an external job or grant execution approval.',
  resident_work_claim: 'Claim one ready in-scope task at expectedVersion using the existing slot/lease policy. Reuse requestId on retries.',
  resident_wiki_list: 'List this grant’s Wiki metadata (up to 50). Published Wiki is reported knowledge, not independently verified fact.',
  resident_wiki_get: 'Read one allowed published page version with immutable digest and public provenance. No URL fetching or private history access.',
  resident_wiki_edit: 'Publish reported knowledge with public sourceRefs and expectedVersion (0 for creation with slug). Use pageId for edits. Conflicts preserve the proposal; never blindly retry with a newer base. Reuse requestId on delivery retries.',
};
export const residentSchemas: Record<string, unknown> = Object.fromEntries(residentTools.map(name => {
  const properties = name === 'resident_message_post' ? { requestId: str, text: str, replyTo: str, mentions: { type: 'array', items: str } }
    : name === 'resident_work_claim' ? { requestId: str, taskId: str, expectedVersion: num }
    : name === 'resident_work_propose' ? { requestId: str, proposalKey: str, title: str, description: str, kind: { enum: ['analysis', 'codex'] }, sourceMessageIds: { type: 'array', items: str, maxItems: 20 }, acceptance: { type: 'array', items: criterion, maxItems: 20 }, allowedParticipantIds: { type: 'array', items: str, maxItems: 20 }, dependencies: { type: 'array', items: str, maxItems: 20 }, authorizedScopeRef: str, requiredRole: str, priority: num }
    : name === 'resident_wiki_edit' ? { requestId: str, pageId: str, slug: str, title: str, body: { ...str, maxLength: 20000 }, scopeRef: str, expectedVersion: num, tombstone: { type: 'boolean' }, sourceRefs: { type: 'array', items: sourceRef, minItems: 1, maxItems: 20 } }
    : name === 'resident_wiki_get' ? { pageId: str, version: { ...num, minimum: 1 } }
    : name === 'resident_wiki_list' || name === 'resident_work_list' ? { after: num, limit: { ...num, maximum: 50 } } : {};
  return [name, { type: 'object', properties, required: required[name] ?? [], additionalProperties: false, ...(name === 'resident_wiki_edit' ? { anyOf: [{ required: ['pageId'] }, { required: ['slug'] }] } : {}) }];
}));
export class ResidentMcp {
  constructor(private readonly app: Workspace) {}
  createGrant(input: unknown) {
    const b = object(input); onlyWork(b, ['roomId', 'participantId', 'scopeRef', 'scopeVersion', 'contextGeneration', 'expectedEpoch', 'tools', 'expiresAt']);
    const s = this.app.store.read(); const a = actorScope(s, string(b.roomId, 200), string(b.participantId, 200), string(b.scopeRef, 200));
    if (b.scopeVersion !== a.scopeVersion || b.contextGeneration !== a.contextGeneration || b.expectedEpoch !== a.epoch) throw new AppError('resident_scope_changed', 409);
    const tools = [...new Set(strings(b.tools, residentTools.length))]; if (!tools.length || tools.some(t => !(residentTools as readonly string[]).includes(t))) throw new AppError('invalid_tools');
    const expiresAt = string(b.expiresAt, 100); const expires = Date.parse(expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 7 * 86400000) throw new AppError('invalid_grant_expiry');
    const token = randomBytes(32).toString('base64url'); const g: ResidentGrant = { ...a, kind: 'resident', id: id('resident_grant'), hash: digest(token), tools, expiresAt, revoked: false, reason: null, createdAt: now() };
    this.app.store.transact((state, emit) => { assertActor(state, g, this.app.config.residentEnabled);
      if (tools.some(t => !readTools.has(t)) && !wikiActorCanEdit(state, g)) throw new AppError('resident_actor_not_authorized', 403);
      state.resident!.residentGrants.push(g); emit({ type: 'resident.mcp_granted', discussionId: null, data: { roomId: g.roomId, grantId: g.id, participantId: g.participantId, tools } });
    }); return { id: g.id, token };
  }
  list(roomId: string) {
    workRoom(this.app.store.read(), roomId);
    return this.app.store.read().resident!.residentGrants.filter(g => g.roomId === roomId).map(g => {
      let active = false; try { this.check(g); active = true; } catch { /* Display invalid/expired scope as inactive. */ }
      const { hash: _hash, ...metadata } = g; return { ...metadata, active };
    });
  }
  revoke(roomId: string, grantId: string): void {
    this.app.store.transact((s, emit) => { const g = s.resident?.residentGrants.find(g => g.roomId === roomId && g.id === grantId); if (!g) throw new AppError('grant_not_found', 404);
      if (g.revoked) return; g.revoked = true; g.reason = 'owner_revoked'; emit({ type: 'resident.mcp_revoked', discussionId: null, data: { roomId, grantId } }); });
  }
  authenticate(token: string): ResidentGrant {
    const g = this.app.store.read().resident?.residentGrants.find(g => g.kind === 'resident' && g.hash === digest(token));
    if (!g) throw new AppError('mcp_authentication_required', 401); this.check(g); return g;
  }
  check(g: ResidentGrant, state: WorkspaceState = this.app.store.read(), mutation = false): void {
    const current = state.resident?.residentGrants.find(v => v.id === g.id && v.hash === g.hash);
    if (!current || current.revoked || !current.contextGeneration || Date.parse(current.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(current.expiresAt)) || JSON.stringify(current) !== JSON.stringify(g)) throw new AppError('mcp_authentication_required', 401);
    assertActor(state, current, this.app.config.residentEnabled, mutation);
  }
  call(name: string, args: Record<string, unknown>, g: ResidentGrant): unknown {
    this.check(g, this.app.store.read(), !readTools.has(name)); if (!g.tools.includes(name)) throw new AppError('tool_not_granted', 403);
    const guard = (s: WorkspaceState) => this.check(g, s, true); const s = this.app.store.read(); const r = workRoom(s, g.roomId);
    if (name === 'resident_wiki_list') { onlyWork(args, ['after', 'limit']); return this.app.wiki.list(r.id, integer(args.after, 0, 0, Number.MAX_SAFE_INTEGER), integer(args.limit, 50, 1, 50), g); }
    if (name === 'resident_wiki_get') { onlyWork(args, ['pageId', 'version']); return this.app.wiki.get(r.id, string(args.pageId, 200), args.version === undefined ? undefined : integer(args.version, -1, 1, Number.MAX_SAFE_INTEGER), undefined, g); }
    if (name === 'resident_work_list') {
      onlyWork(args, ['after', 'limit']); const page = this.app.workQueue.list(r.id, integer(args.after, 0, 0, Number.MAX_SAFE_INTEGER), integer(args.limit, 50, 1, 50));
      const all = s.resident!.workItems.filter(t => t.roomId === r.id && t.authorizedScopeRef === g.scopeRef); const start = integer(args.after, 0, 0, Number.MAX_SAFE_INTEGER); const end = start + integer(args.limit, 50, 1, 50);
      return { items: all.slice(start, end).map(({ reports: _reports, reviews: _reviews, ...t }) => t), nextAfter: Math.min(end, all.length), hasMore: end < all.length, cursor: page.cursor };
    }
    if (name === 'resident_context_get') {
      onlyWork(args, []); const value = { roomId: r.id, participantId: g.participantId, contextGeneration: g.contextGeneration, epoch: g.epoch, scopeRef: g.scopeRef,
        messages: visibleRoomMessages(s, r, [g.participantId], g.scopeRef).slice(-50), wiki: contextWiki(s, r, [g.participantId], undefined, g.scopeRef), budgets: r.budgets };
      if (JSON.stringify(value).length > 180000) throw new AppError('context_limit_requires_selection', 409); return value;
    }
    const { requestId: rawId, ...input } = args; const requestId = g.id + ':' + string(rawId, 100);
    if (name === 'resident_wiki_edit') { guard(s); return this.app.wiki.edit(r.id, input, requestId, g); }
    if (name === 'resident_work_propose' || name === 'resident_work_claim') {
      if (name === 'resident_work_propose' ? input.authorizedScopeRef !== g.scopeRef : !s.resident!.workItems.some(t => t.id === input.taskId && t.roomId === r.id && t.authorizedScopeRef === g.scopeRef)) throw new AppError('work_action_not_authorized', 403);
      return this.app.workQueue.actorCommand(r.id, g.participantId, name === 'resident_work_propose' ? 'propose' : 'claim', input, requestId, guard);
    }
    if (name === 'resident_message_post') {
      onlyWork(input, ['text', 'replyTo', 'mentions']); if (g.scopeRef !== 'room:' + r.id || !wikiActorCanEdit(s, g)) throw new AppError('resident_action_not_authorized', 403);
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) throw new AppError('invalid_room_message');
      const text = input.text; const mentions = [...new Set(strings(input.mentions ?? [], 8))]; const replyTo = input.replyTo ? string(input.replyTo, 200) : null;
      return this.app.store.transact((state, emit) => { guard(state); const room = workRoom(state, r.id); if (budgetReason(room)) throw new AppError('budget_exhausted', 409);
        if (replyTo && !state.resident!.messages.some(m => m.id === replyTo && m.roomId === r.id && m.visibility === 'room_public') || mentions.some(pid => !room.members.some(m => m.participantId === pid))) throw new AppError('reply_not_in_room', 403);
        const messageId = id('message'); state.resident!.messages.push({ id: messageId, roomId: r.id, sequence: ++room.lastMessageSequence, authorId: g.participantId, text, replyTo, mentions, visibility: 'room_public', sourceKind: 'room', sourceId: 'mcp:' + requestId, createdAt: now() });
        emit({ type: 'resident.message_created', discussionId: null, data: { roomId: r.id, messageId, sequence: room.lastMessageSequence } }); return { messageId, status: 'reported' };
      }, { id: 'resident:mcp:' + requestId, input: { name, input } });
    }
    throw new AppError('unknown_tool');
  }
}
