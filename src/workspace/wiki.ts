import type { Store } from './store.js';
import type { WorkspaceState } from './model.js';
import type { Room, ResidentTurn } from './resident-model.js';
import type { WorkReportV1 } from './work-model.js';
import type { ResidentActorScope, WikiVersion } from './wiki-model.js';
import { AppError, digest, id, integer, now, object, string } from './util.js';
import { workRoom } from './work-policy.js';
import { actorScope, assertActor, assertWikiScope, citationFor, contextWiki, participantIdentity, resolveWikiSources, wikiActorCanEdit, wikiVersionDigest, WIKI_LIMITS } from './wiki-policy.js';
type Emit = Parameters<Parameters<Store['transact']>[0]>[1];
type EditResult = { pageId: string; version: number | null; digest: string; status: 'published' | 'conflict'; conflictId: string | null };
const fields = ['pageId', 'slug', 'title', 'body', 'sourceRefs', 'scopeRef', 'expectedVersion', 'tombstone'];
const only = (b: Record<string, unknown>, keys: string[]) => { if (Object.keys(b).some(k => !keys.includes(k))) throw new AppError('invalid_wiki_fields'); };
export function validateWikiState(s: WorkspaceState): void {
  const r = s.resident; if (!r) return;
  if (r.wikiSchemaVersion === undefined) { if (r.wikiPages.length || r.wikiVersions.length || r.rooms.some(r => r.wikiPins?.length)) throw new AppError('wiki_migration_state_missing', 503); return; }
  if (r.wikiSchemaVersion !== 1) throw new AppError('unsupported_wiki_schema', 503);
  const versions = new Set<string>(); const edits = new Set<string>(); const pages = new Set<string>();
  for (const p of r.wikiPages) {
    if (!p || pages.has(p.id) || typeof p.slug !== 'string' || typeof p.title !== 'string' || !Number.isSafeInteger(p.headVersion) || p.headVersion < 1 || !r.rooms.some(r => r.id === p.roomId)) throw new AppError('invalid_wiki_state', 503);
    pages.add(p.id);
  }
  for (const v of r.wikiVersions) {
    if (!v || versions.has(v.id) || edits.has(v.editId) || !pages.has(v.pageId) || !['published', 'conflict'].includes(v.status) || v.epistemicStatus !== 'reported' || typeof v.body !== 'string' || v.body.length > WIKI_LIMITS.body || !Array.isArray(v.sourceRefs) || !v.sourceRefs.length ||
        v.status === 'published' && (!Number.isSafeInteger(v.version) || v.version! < 1 || v.conflictWith !== null) || v.status === 'conflict' && (v.version !== null || !Number.isSafeInteger(v.conflictWith)) ||
        v.digest !== wikiVersionDigest(v) || !r.wikiPages.some(p => p.id === v.pageId && p.roomId === v.roomId && p.scopeRef === v.scopeRef)) throw new AppError('invalid_wiki_state', 503);
    versions.add(v.id); edits.add(v.editId);
  }
  for (const p of r.wikiPages) {
    const vs = r.wikiVersions.filter(v => v.pageId === p.id && v.status === 'published');
    if (vs.length !== p.headVersion || new Set(vs.map(v => v.version)).size !== vs.length || !vs.some(v => v.version === p.headVersion)) throw new AppError('invalid_wiki_state', 503);
  }
  for (const room of r.rooms) if (room.wikiPins && (!Array.isArray(room.wikiPins) || room.wikiPins.length > WIKI_LIMITS.pins || room.wikiPins.some(p => !r.wikiVersions.some(v => v.pageId === p.pageId && v.roomId === room.id && v.version === p.version && v.digest === p.digest && v.scopeRef === p.scopeRef && v.status === 'published' && !v.tombstone)))) throw new AppError('invalid_wiki_state', 503);
  for (const g of r.residentGrants) {
    if (g?.contextGeneration === undefined && g?.revoked === true) continue;
    if (!g || g.kind !== 'resident' || !Number.isSafeInteger(g.contextGeneration) || g.contextGeneration < 1 || !Number.isSafeInteger(g.scopeVersion) || !Number.isSafeInteger(g.epoch) || typeof g.revoked !== 'boolean' || !/^[a-f0-9]{64}$/.test(g.hash) || !Array.isArray(g.tools) || !Number.isFinite(Date.parse(g.expiresAt))) throw new AppError('invalid_resident_grant_state', 503);
  }
}
export class Wiki {
  constructor(private readonly store: Store, readonly enabled: boolean) {
    validateWikiState(store.read());
    if (enabled && store.read().resident?.wikiSchemaVersion === undefined) store.transact(s => {
      s.resident!.wikiSchemaVersion = 1;
      for (const g of s.resident!.residentGrants) if (!g?.contextGeneration) { g.revoked = true; g.reason = 'legacy_generation_missing'; }
      return { version: 1 };
    }, { id: 'resident:wiki:migration:v1', input: { version: 1 } });
    if (enabled && store.read().resident?.wikiSchemaVersion !== 1) throw new AppError('wiki_migration_state_missing', 503);
    validateWikiState(store.read());
  }
  list(roomId: string, after = 0, limit = 50, actor?: ResidentActorScope) {
    const s = this.store.read(); const r = workRoom(s, roomId); if (actor) { assertActor(s, actor, this.enabled); if (actor.roomId !== roomId) throw new AppError('wiki_not_in_scope', 403); }
    integer(after, 0, 0, Number.MAX_SAFE_INTEGER); integer(limit, 50, 1, WIKI_LIMITS.page);
    const all = s.resident!.wikiPages.filter(p => p.roomId === roomId && (!actor || p.scopeRef === actor.scopeRef));
    const items = all.slice(after, after + limit).map(p => ({ ...p, tombstone: s.resident!.wikiVersions.find(v => v.pageId === p.id && v.version === p.headVersion)?.tombstone, conflictCount: s.resident!.wikiVersions.filter(v => v.pageId === p.id && v.status === 'conflict').length }));
    return { items, selection: r.wikiPins === undefined ? 'automatic' : 'pinned', pins: r.wikiPins?.filter(p => !actor || p.scopeRef === actor.scopeRef) ?? [], nextAfter: after + items.length, hasMore: after + items.length < all.length, cursor: this.store.cursor(), enabled: this.enabled };
  }
  get(roomId: string, pageId: string, version?: number, conflictId?: string, actor?: ResidentActorScope) {
    const s = this.store.read(); workRoom(s, roomId); if (actor) assertActor(s, actor, this.enabled);
    const page = s.resident!.wikiPages.find(p => p.roomId === roomId && p.id === pageId && (!actor || actor.roomId === roomId && actor.scopeRef === p.scopeRef));
    if (!page) throw new AppError('wiki_not_in_scope', 403);
    const selected = s.resident!.wikiVersions.find(v => v.pageId === pageId && (conflictId ? v.id === conflictId && v.status === 'conflict' : v.version === (version ?? page.headVersion) && v.status === 'published'));
    if (!selected) throw new AppError('wiki_version_not_found', 404);
    resolveWikiSources(s, workRoom(s, roomId), page.scopeRef, selected.sourceRefs);
    return { page, version: selected, cursor: this.store.cursor() };
  }
  history(roomId: string, pageId: string, after = 0, limit = 50) {
    this.get(roomId, pageId); integer(after, 0, 0, Number.MAX_SAFE_INTEGER); integer(limit, 50, 1, WIKI_LIMITS.page);
    const all = this.store.read().resident!.wikiVersions.filter(v => v.roomId === roomId && v.pageId === pageId);
    return { items: all.slice(after, after + limit).map(({ body: _body, ...v }) => v), nextAfter: after + Math.min(limit, Math.max(0, all.length - after)), hasMore: after + limit < all.length };
  }
  edit(roomId: string, input: unknown, requestId: string, actor?: ResidentActorScope): EditResult {
    if (!this.enabled) throw new AppError('resident_disabled', 409);
    if (actor) this.authorize(this.store.read(), roomId, input, actor);
    return this.store.transact((s, emit) => { if (actor) this.authorize(s, roomId, input, actor); return this.editState(s, workRoom(s, roomId), input, actor?.participantId ?? 'owner', actor?.contextGeneration ?? null, 'edit:' + requestId, emit); },
      { id: 'resident:wiki:edit:' + string(requestId, 200), input: { roomId, input, actor: actor ?? null } });
  }
  private authorize(s: WorkspaceState, roomId: string, input: unknown, actor: ResidentActorScope): void {
    assertActor(s, actor, this.enabled, true);
    if (actor.roomId !== roomId || object(input).scopeRef !== actor.scopeRef || !wikiActorCanEdit(s, actor)) throw new AppError('wiki_edit_not_authorized', 403);
  }
  editState(s: WorkspaceState, r: Room, input: unknown, author: string, generation: number | null, editId: string, emit: Emit): EditResult {
    if (!this.enabled) throw new AppError('resident_disabled', 409);
    const b = object(input); only(b, fields); const inputDigest = digest(JSON.stringify(b));
    const old = s.resident!.wikiVersions.find(v => v.editId === editId);
    if (old) { if (old.inputDigest !== inputDigest || old.roomId !== r.id || old.authoredBy !== author) throw new AppError('idempotency_conflict', 409); return this.result(old); }
    const scopeRef = string(b.scopeRef, 200); assertWikiScope(s, r, scopeRef);
    const expected = integer(b.expectedVersion, -1, 0, Number.MAX_SAFE_INTEGER); if (expected < 0) throw new AppError('wiki_base_version_required');
    const title = string(b.title, 200); if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > WIKI_LIMITS.body || b.tombstone !== undefined && typeof b.tombstone !== 'boolean') throw new AppError('invalid_wiki_body');
    const sourceRefs = resolveWikiSources(s, r, scopeRef, b.sourceRefs); const body = b.body;
    let p = b.pageId ? s.resident!.wikiPages.find(p => p.id === b.pageId && p.roomId === r.id && p.scopeRef === scopeRef) : undefined;
    if (b.pageId && !p) throw new AppError('wiki_not_in_scope', 403);
    const slug = p?.slug ?? string(b.slug, 100); if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) throw new AppError('invalid_wiki_slug');
    p ??= s.resident!.wikiPages.find(p => p.roomId === r.id && p.scopeRef === scopeRef && p.slug === slug);
    if (!p && expected !== 0) throw new AppError('wiki_page_not_found', 404);
    if (!p) { p = { id: id('wiki'), roomId: r.id, scopeRef, slug, title, headVersion: 0, createdAt: now(), updatedAt: now() }; s.resident!.wikiPages.push(p); }
    const conflict = p.headVersion !== expected;
    const v: WikiVersion = { id: id('wiki_version'), pageId: p.id, roomId: r.id, scopeRef, version: conflict ? null : p.headVersion + 1, baseVersion: expected, conflictWith: conflict ? p.headVersion : null,
      title, body, digest: '', sourceRefs, authoredBy: author, contextGeneration: generation, status: conflict ? 'conflict' : 'published', epistemicStatus: 'reported', tombstone: b.tombstone === true, createdAt: now(), editId, inputDigest };
    v.digest = wikiVersionDigest(v); s.resident!.wikiVersions.push(v);
    if (!conflict) { p.headVersion = v.version!; p.title = title; p.updatedAt = v.createdAt; this.notice(s, r, v, emit); }
    emit({ type: conflict ? 'resident.wiki_conflict' : 'resident.wiki_edited', discussionId: null, data: { roomId: r.id, pageId: p.id, version: v.version, versionId: v.id, digest: v.digest } });
    return this.result(v);
  }
  applyTurn(s: WorkspaceState, r: Room, turn: ResidentTurn, payload: unknown, editId: string, emit: Emit): EditResult {
    const a = actorScope(s, r.id, turn.participantId, string(object(payload).scopeRef, 200));
    if (turn.epoch !== a.epoch || turn.generation !== a.contextGeneration || turn.workSeatVersion !== a.scopeVersion || participantIdentity(turn.participant) !== a.identityDigest) throw new AppError('resident_scope_changed', 403);
    this.authorize(s, r.id, payload, a); return this.editState(s, r, payload, a.participantId, a.contextGeneration, editId, emit);
  }
  publishReport(s: WorkspaceState, r: Room, report: WorkReportV1, emit: Emit): void {
    if (!this.enabled || s.resident!.wikiVersions.some(v => v.editId === 'report:' + report.id)) return;
    const attempt = s.resident!.workAttempts.find(a => a.id === report.attemptId && a.roomId === r.id && a.taskId === report.taskId);
    if (!attempt) throw new AppError('wiki_source_not_public', 403);
    const slug = 'work-' + attempt.taskId.toLowerCase().replace(/_/g, '-');
    const p = s.resident!.wikiPages.find(p => p.roomId === r.id && p.scopeRef === attempt.authorizedScopeRef && p.slug === slug);
    const full = JSON.stringify({ summary: report.summary, text: report.text, reportId: report.id, reportDigest: report.digest, checks: report.checks, blockers: report.blockers });
    const body = full.length <= WIKI_LIMITS.body ? full : JSON.stringify({ summary: report.summary, reportId: report.id, reportDigest: report.digest, originalTextIncluded: false, textLength: report.text.length, note: '전체 원문과 검사는 원래 업무 보고에서 확인하세요.' });
    this.editState(s, r, { ...(p ? { pageId: p.id } : { slug }), scopeRef: attempt.authorizedScopeRef, title: attempt.input.title, body, sourceRefs: [{ kind: 'report', id: report.id, digest: report.digest }], expectedVersion: p?.headVersion ?? 0 }, report.authorId, attempt.contextGeneration, 'report:' + report.id, emit);
  }
  pin(roomId: string, input: unknown, requestId: string) {
    const b = object(input); only(b, ['expectedVersion', 'pins', 'automatic']);
    return this.store.transact((s, emit) => {
      if (!this.enabled) throw new AppError('resident_disabled', 409); const r = workRoom(s, roomId);
      if (b.expectedVersion !== r.version) throw new AppError('room_version_conflict', 409);
      if (b.automatic === true) { if (b.pins !== undefined) throw new AppError('invalid_wiki_pins'); delete r.wikiPins; r.version++; r.updatedAt = now(); emit({ type: 'resident.wiki_pinned', discussionId: null, data: { roomId, version: r.version, automatic: true } }); return { pins: [], automatic: true, version: r.version }; }
      if (!Array.isArray(b.pins) || b.pins.length > WIKI_LIMITS.pins) throw new AppError('invalid_wiki_pins');
      const pins = b.pins.map(raw => { const pin = object(raw); only(pin, ['pageId', 'version']); const v = s.resident!.wikiVersions.find(v => v.pageId === pin.pageId && v.version === pin.version && v.roomId === roomId && v.status === 'published' && !v.tombstone); if (!v) throw new AppError('wiki_version_not_found', 404); return citationFor(v); });
      if (new Set(pins.map(p => p.pageId)).size !== pins.length) throw new AppError('invalid_wiki_pins');
      contextWiki(s, r, [], pins); r.wikiPins = pins; r.version++; r.updatedAt = now();
      emit({ type: 'resident.wiki_pinned', discussionId: null, data: { roomId, version: r.version, pins } }); return { pins, version: r.version };
    }, { id: 'resident:wiki:pin:' + string(requestId, 200), input: { roomId, input } });
  }
  private result(v: WikiVersion): EditResult { return { pageId: v.pageId, version: v.version, digest: v.digest, status: v.status, conflictId: v.status === 'conflict' ? v.id : null }; }
  private notice(s: WorkspaceState, r: Room, v: WikiVersion, emit: Emit): void {
    const messageId = id('message'); s.resident!.messages.push({ id: messageId, roomId: r.id, sequence: ++r.lastMessageSequence, sourceKind: 'wiki', sourceId: v.id, authorId: v.authoredBy,
      text: `공유 Wiki ${v.tombstone ? '폐기' : '보고'} 버전 ${v.version}을 기록했습니다. 원문·출처·검토 상태는 Wiki에서 확인하세요.`, replyTo: null, mentions: [], visibility: 'room_public', createdAt: v.createdAt, wikiCitations: v.tombstone ? [] : [citationFor(v)] });
    emit({ type: 'resident.message_created', discussionId: null, data: { roomId: r.id, messageId, sequence: r.lastMessageSequence } });
  }
}
