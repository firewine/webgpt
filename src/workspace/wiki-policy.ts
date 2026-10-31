import type { Member, WorkspaceState } from './model.js';
import type { Room, RoomContext, RoomMessage } from './resident-model.js';
import type { ResidentActorScope, WikiSourceRef, WikiSnapshot, WikiVersion, WikiCitation } from './wiki-model.js';
import { AppError, digest, object, string } from './util.js';
import { seatAllows, workRoom } from './work-policy.js';

export const WIKI_LIMITS = { body: 20000, sourceRefs: 20, pins: 8, context: 60000, page: 50 } as const;
export function participantIdentity(p: Member): string { return digest(JSON.stringify({ id: p.id, kind: p.kind, connectionId: p.connectionId, modelId: p.modelId })); }
export function actorScope(s: WorkspaceState, roomId: string, participantId: string, scopeRef: string): ResidentActorScope {
  const r = workRoom(s, roomId); const p = s.participants.find(p => p.id === participantId); const seat = r.seats?.find(a => a.participantId === participantId);
  if (!p || !seat) throw new AppError('resident_actor_not_authorized', 403);
  return { roomId, participantId, scopeRef, scopeVersion: seat.version, contextGeneration: r.contexts?.find(c => c.participantId === participantId)?.generation ?? 1, epoch: r.epoch, identityDigest: participantIdentity(p) };
}
export function assertActor(s: WorkspaceState, a: ResidentActorScope, enabled: boolean, mutation = false): Room {
  if (!enabled) throw new AppError('resident_disabled', 409);
  const r = workRoom(s, a.roomId); const p = s.participants.find(p => p.id === a.participantId); const seat = r.seats?.find(v => v.participantId === a.participantId); const m = r.members.find(v => v.participantId === a.participantId);
  if (!p || !m?.enabled || m.blockedReason || !seat?.enabled || seat.policyVersion !== 1 || seat.version !== a.scopeVersion || !seat.scopeRefs.includes(a.scopeRef) ||
      a.contextGeneration !== (r.contexts?.find(c => c.participantId === a.participantId)?.generation ?? 1) || a.epoch !== r.epoch || participantIdentity(p) !== a.identityDigest ||
      p.kind !== 'fake' && !s.connections.some(c => c.id === p.connectionId && c.kind === p.kind && c.status === 'connected') || p.kind === 'browser' && s.browserPaused) throw new AppError('resident_scope_changed', 403);
  assertWikiScope(s, r, a.scopeRef);
  if (mutation && !r.desiredOn) throw new AppError('room_off', 409);
  return r;
}
export function assertWikiScope(s: WorkspaceState, r: Room, scopeRef: string): void {
  if (scopeRef !== 'room:' + r.id && !s.bindings.some(b => 'binding:' + b.id === scopeRef)) throw new AppError('wiki_scope_not_found', 403);
}
export function wikiActorCanEdit(s: WorkspaceState, a: ResidentActorScope): boolean {
  const r = workRoom(s, a.roomId);
  return (['propose', 'report', 'manage'] as const).some(action => (['analysis', 'codex'] as const).some(kind => !!seatAllows(s, r, a.participantId, action, kind, a.scopeRef)));
}
export function canReadWiki(s: WorkspaceState, r: Room, scopeRef: string, pid?: string): boolean {
  if (!pid) return true;
  const seat = r.seats?.find(a => a.participantId === pid);
  return s.participants.some(p => p.id === pid) && r.members.some(m => m.participantId === pid && m.enabled && !m.blockedReason) && (scopeRef === 'room:' + r.id || !!seat?.enabled && seat.policyVersion === 1 && seat.scopeRefs.includes(scopeRef));
}
export function visibleRoomMessages(s: WorkspaceState, r: Room, pids: string[] = [], scopeRef?: string): RoomMessage[] {
  return s.resident!.messages.filter(m => m.roomId === r.id && m.visibility === 'room_public' && (m.sourceKind !== 'wiki' || s.resident!.wikiVersions.some(v => v.id === m.sourceId && (!scopeRef || v.scopeRef === scopeRef) && pids.every(pid => canReadWiki(s, r, v.scopeRef, pid))))).map(m => ({ ...m, ...(m.wikiCitations ? { wikiCitations: m.wikiCitations.filter(ref => (!scopeRef || ref.scopeRef === scopeRef) && pids.every(pid => canReadWiki(s, r, ref.scopeRef, pid))) } : {}) }));
}
export function resolveWikiSources(s: WorkspaceState, r: Room, scopeRef: string, input: unknown, visited = new Set<string>()): WikiSourceRef[] {
  if (visited.size > 32) throw new AppError('wiki_source_chain_limit', 409);
  if (!Array.isArray(input) || !input.length || input.length > WIKI_LIMITS.sourceRefs) throw new AppError('wiki_sources_required');
  const result = input.map(value => {
    const b = object(value); if (Object.keys(b).some(k => !['kind', 'id', 'version', 'digest', 'status'].includes(k))) throw new AppError('invalid_wiki_source');
    const refId = string(b.id, 200); let ref: WikiSourceRef;
    if (b.kind === 'message') {
      const m = s.resident!.messages.find(m => m.id === refId && m.roomId === r.id && m.visibility === 'room_public');
      if (!m || m.sourceKind === 'wiki' && !s.resident!.wikiVersions.some(v => v.id === m.sourceId && (v.scopeRef === scopeRef || v.scopeRef === 'room:' + r.id))) throw new AppError('wiki_source_not_public', 403); ref = { kind: 'message', id: m.id, digest: digest(m.text), status: 'reported' };
    } else if (b.kind === 'report') {
      const task = s.resident!.workItems.find(t => t.roomId === r.id && t.reports.some(p => p.id === refId)); const report = task?.reports.find(p => p.id === refId);
      const attempt = report && s.resident!.workAttempts.find(a => a.id === report.attemptId);
      if (!report || attempt?.authorizedScopeRef !== scopeRef || !s.resident!.messages.some(m => m.sourceId === report.id && m.roomId === r.id && m.visibility === 'room_public')) throw new AppError('wiki_source_not_public', 403);
      ref = { kind: 'report', id: report.id, digest: report.digest, status: report.checks.some(c => c.outcome === 'observed_pass' || c.outcome === 'observed_fail') ? 'observed' : report.checks.some(c => c.outcome === 'not_run') ? 'not_run' : 'reported' };
    } else if (b.kind === 'wiki') {
      const v = s.resident!.wikiVersions.find(v => v.pageId === refId && v.version === b.version && v.roomId === r.id && v.status === 'published' && !v.tombstone && (v.scopeRef === scopeRef || v.scopeRef === 'room:' + r.id));
      if (!v) throw new AppError('wiki_source_not_public', 403); ref = { kind: 'wiki', id: refId, version: v.version!, digest: v.digest, status: 'reported' };
      if (visited.has(v.id)) throw new AppError('wiki_source_cycle', 409);
      resolveWikiSources(s, r, v.scopeRef, v.sourceRefs, new Set([...visited, v.id]));
    } else throw new AppError('invalid_wiki_source');
    if (b.digest !== undefined && b.digest !== ref.digest) throw new AppError('wiki_source_changed', 409);
    return ref;
  });
  if (new Set(result.map(v => v.kind + ':' + v.id + ':' + v.version)).size !== result.length) throw new AppError('invalid_wiki_source'); return result;
}
export function wikiVersionDigest(v: Pick<WikiVersion, 'pageId' | 'roomId' | 'scopeRef' | 'title' | 'body' | 'sourceRefs' | 'tombstone' | 'epistemicStatus'>): string {
  return digest(JSON.stringify({ pageId: v.pageId, roomId: v.roomId, scopeRef: v.scopeRef, title: v.title, body: v.body, sourceRefs: v.sourceRefs, tombstone: v.tombstone, epistemicStatus: v.epistemicStatus }));
}
export function citationFor(v: WikiVersion): WikiCitation { return { pageId: v.pageId, version: v.version!, digest: v.digest, scopeRef: v.scopeRef, sourceRefs: structuredClone(v.sourceRefs) }; }
export function contextWiki(s: WorkspaceState, r: Room, participantIds: string[] = [], pins?: WikiCitation[], scopeRef?: string): WikiSnapshot[] {
  const selected = pins ?? r.wikiPins ?? s.resident!.wikiPages.filter(p => p.roomId === r.id).flatMap(p => { const v = s.resident!.wikiVersions.find(v => v.pageId === p.id && v.version === p.headVersion && v.status === 'published' && !v.tombstone); return v ? [citationFor(v)] : []; });
  const result: WikiSnapshot[] = [];
  for (const pin of selected) {
    if (scopeRef && pin.scopeRef !== scopeRef) continue;
    if (!participantIds.every(pid => canReadWiki(s, r, pin.scopeRef, pid))) continue;
    const v = s.resident!.wikiVersions.find(v => v.pageId === pin.pageId && v.roomId === r.id && v.version === pin.version && v.status === 'published' && !v.tombstone && v.digest === pin.digest);
    if (!v || v.scopeRef !== pin.scopeRef || JSON.stringify(v.sourceRefs) !== JSON.stringify(pin.sourceRefs)) throw new AppError('wiki_pin_changed', 409);
    resolveWikiSources(s, r, v.scopeRef, v.sourceRefs);
    result.push({ ...citationFor(v), title: v.title, body: v.body, epistemicStatus: 'reported' });
  }
  if (result.length > WIKI_LIMITS.pins || JSON.stringify(result).length > WIKI_LIMITS.context) throw new AppError('wiki_context_requires_selection', 409); return structuredClone(result);
}
export function assertWikiSnapshots(s: WorkspaceState, roomId: string, pids: string[], snapshots: WikiSnapshot[] = []): boolean {
  try { return JSON.stringify(contextWiki(s, workRoom(s, roomId), pids, snapshots)) === JSON.stringify(snapshots); } catch { return false; }
}
export function wikiHistoryAllowed(s: WorkspaceState, r: Room, c: RoomContext): boolean {
  const p = s.participants.find(p => p.id === c.participantId);
  if (!c.wikiHistoryRefs?.length) return true;
  try { return !!p && c.wikiIdentityDigest === participantIdentity(p) && c.wikiHistoryRefs.every(ref => contextWiki(s, r, [p.id], [ref]).length === 1); } catch { return false; }
}
export function rememberWiki(s: WorkspaceState, c: RoomContext, snapshots: WikiSnapshot[] = []): void {
  if (!snapshots.length) return;
  c.wikiIdentityDigest = participantIdentity(s.participants.find(p => p.id === c.participantId)!);
  c.wikiHistoryRefs = [...new Map([...(c.wikiHistoryRefs ?? []), ...snapshots.map(({ title: _t, body: _b, epistemicStatus: _s, ...ref }) => ref)].map(ref => [ref.pageId + ':' + ref.version, ref])).values()];
}
