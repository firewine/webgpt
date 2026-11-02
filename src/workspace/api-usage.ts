import { dotParticipantWait } from './dot-mcp-policy.js';
import type { ApiDailySummary, ApiUsageEntry, ApiUsageState, Member, WorkspaceState } from './model.js';
import type { Room } from './resident-model.js';
import { AppError, integer, object } from './util.js';

type Usage = { input: number; output: number } | null;
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
export const apiDay = (clock = Date.now()): string => formatter.format(new Date(clock));
export const nextApiDay = (clock = Date.now()): number => Date.parse(apiDay(clock) + 'T00:00:00+09:00') + 86_400_000;
// All resident rooms use API-only chat quotas. The old mode is retained solely
// as readable history; it cannot re-enable a room-wide chat stop.
export const dailyRoom = (room: Room | undefined): boolean => !!room;
export const meteredApi = (member: Member | undefined): boolean => member?.kind === 'deepseek' || member?.kind === 'anthropic';
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): boolean => typeof v === 'string' && Number.isFinite(Date.parse(v));
const identifier = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
export function validateApiUsage(s: WorkspaceState): void {
  const a = s.apiUsage; if (a === undefined) return;
  if (!a || a.schemaVersion !== 1) throw new AppError('unsupported_api_usage_schema', 503);
  if (!count(a.version) || !date(a.importedAt) || !count(a.legacyUntracked) || a.policy !== null && (!a.policy || !count(a.policy.maxRequests) || !a.policy.maxRequests || a.policy.maxRequests > 10000 || !count(a.policy.maxTokens) || !a.policy.maxTokens || a.policy.maxTokens > 100000000) ||
      !Array.isArray(a.entries) || new Set(a.entries.map(e => e?.requestId)).size !== a.entries.length || a.entries.some(e => !e || !identifier(e.requestId) || !identifier(e.participantId) || !identifier(e.connectionId) || !['deepseek', 'anthropic'].includes(e.kind) ||
        typeof e.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.day) || !date(e.day + 'T00:00:00+09:00') || apiDay(Date.parse(e.day + 'T00:00:00+09:00')) !== e.day || !date(e.reservedAt) || !['reserved', 'running', 'unconfirmed', 'settled', 'not_sent'].includes(e.status) ||
        e.startedAt !== null && (!date(e.startedAt) || apiDay(Date.parse(e.startedAt)) !== e.day) || e.finishedAt !== null && !date(e.finishedAt) ||
        e.usage !== null && (!e.usage || !count(e.usage.input) || !count(e.usage.output)) || e.error !== null && typeof e.error !== 'string' ||
        ['reserved', 'not_sent'].includes(e.status) && e.startedAt !== null ||
        ['running', 'unconfirmed', 'settled'].includes(e.status) && e.startedAt === null)) throw new AppError('api_usage_state_invalid', 503);
}
export function ensureApiUsage(s: WorkspaceState, clock = Date.now()): ApiUsageState {
  validateApiUsage(s); if (s.apiUsage) return s.apiUsage;
  const a: ApiUsageState = { schemaVersion: 1, version: 0, importedAt: new Date(clock).toISOString(), legacyUntracked: 0, policy: null, entries: [] };
  const take = (t: { id: string; dispatchStartedAt?: string; startedAt: string; finishedAt: string | null; status: string; usage: Usage; receipt: string | null; error: string | null }, p: Member | undefined) => {
    if (!p || !meteredApi(p) || !p.connectionId) return;
    if (!t.dispatchStartedAt) { if (t.receipt) a.legacyUntracked++; return; }
    a.entries.push({ requestId: t.id, participantId: p.id, connectionId: p.connectionId, kind: p.kind as ApiUsageEntry['kind'], day: apiDay(Date.parse(t.dispatchStartedAt)),
      status: t.status === 'unconfirmed' || !t.finishedAt ? 'unconfirmed' : 'settled', reservedAt: t.startedAt, startedAt: t.dispatchStartedAt, finishedAt: t.finishedAt, usage: structuredClone(t.usage), error: t.error });
  };
  for (const d of s.discussions) for (const t of d.turns) take(t, d.members.find(p => p.id === t.participantId));
  for (const t of s.resident?.turns ?? []) take(t, t.participant);
  s.apiUsage = a; return a;
}
export function apiUsageSummary(s: WorkspaceState, clock = Date.now()): ApiDailySummary {
  const a = s.apiUsage, day = apiDay(clock), entries = (a?.entries ?? []).filter(e => e.day === day), sent = entries.filter(e => e.startedAt !== null);
  return { enabled: !!a, version: a?.version ?? 0, timeZone: 'Asia/Seoul' as const, day, nextResetAt: new Date(nextApiDay(clock)).toISOString(), policy: a?.policy ?? null,
    used: { requests: sent.length, reserved: entries.filter(e => e.status === 'reserved').length, inputTokens: sent.reduce((n, e) => n + (e.usage?.input ?? 0), 0), outputTokens: sent.reduce((n, e) => n + (e.usage?.output ?? 0), 0), unknownUsage: sent.filter(e => e.usage === null).length },
    importedAt: a?.importedAt ?? null, legacyUntracked: a?.legacyUntracked ?? 0 };
}
export function configureApiUsage(s: WorkspaceState, input: unknown, clock = Date.now()) {
  const b = object(input); if (Object.keys(b).some(k => !['expectedVersion', 'maxRequests', 'maxTokens'].includes(k)) || b.maxRequests === undefined || b.maxTokens === undefined) throw new AppError('invalid_api_daily_policy');
  if (b.expectedVersion !== (s.apiUsage?.version ?? 0)) throw new AppError('api_daily_version_conflict', 409);
  const policy = { maxRequests: integer(b.maxRequests, 24, 1, 10000), maxTokens: integer(b.maxTokens, 200000, 1, 100000000) };
  if (s.discussions.some(d => d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status) && meteredApi(d.members.find(p => p.id === t.participantId)!))) ||
      s.resident?.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status) && meteredApi(t.participant))) throw new AppError('api_daily_policy_requires_idle', 409);
  const a = ensureApiUsage(s, clock); a.policy = policy; a.version++; return apiUsageSummary(s, clock);
}
export function apiDailyReason(s: WorkspaceState, member: Member, clock = Date.now(), ownRequest?: string): string | null {
  if (!meteredApi(member)) return null;
  if (!s.apiUsage?.policy) return 'api_daily_not_configured';
  const v = apiUsageSummary(s, clock), own = s.apiUsage.entries.find(e => e.requestId === ownRequest && e.day === v.day && e.status === 'reserved');
  return v.used.requests + v.used.reserved - (own ? 1 : 0) >= v.policy!.maxRequests || v.used.inputTokens + v.used.outputTokens >= v.policy!.maxTokens ? 'api_daily_exhausted' : null;
}
export function participantWait(s: WorkspaceState, room: Room, member: Member, clock = Date.now()): string | null {
  if (!dailyRoom(room)) return null;
  if (member.kind === 'dot-mcp') return dotParticipantWait(s, room, member, clock);
  if (member.kind === 'browser' && s.browserPaused) return 'browser_manual_control';
  const connection = member.connectionId && s.connections.find(c => c.id === member.connectionId && c.kind === member.kind);
  if (member.kind !== 'fake' && (!connection || connection.status !== 'connected')) return 'participant_not_ready';
  return apiDailyReason(s, member, clock);
}
export function reserveApiUsage(s: WorkspaceState, member: Member, requestId: string, room: Room | undefined, clock: number): string | null {
  if (!meteredApi(member) || !s.apiUsage && !dailyRoom(room)) return null;
  const a = ensureApiUsage(s, clock), denied = a.policy || dailyRoom(room) ? apiDailyReason(s, member, clock) : null;
  if (denied) return denied;
  if (!member.connectionId) return 'api_connection_required';
  if (a.entries.some(e => e.requestId === requestId)) return 'api_request_already_reserved';
  a.entries.push({ requestId, participantId: member.id, connectionId: member.connectionId, kind: member.kind as ApiUsageEntry['kind'], day: apiDay(clock), status: 'reserved', reservedAt: new Date(clock).toISOString(), startedAt: null, finishedAt: null, usage: null, error: null });
  return null;
}
export function claimApiUsage(s: WorkspaceState, member: Member, requestId: string, room: Room | undefined, clock: number): string | null {
  if (!meteredApi(member) || !s.apiUsage && !dailyRoom(room)) return null;
  const entry = s.apiUsage?.entries.find(e => e.requestId === requestId);
  if (!entry || entry.status !== 'reserved' || entry.connectionId !== member.connectionId || entry.participantId !== member.id || entry.kind !== member.kind) return 'api_dispatch_not_reserved';
  const reason = s.apiUsage?.policy || dailyRoom(room) ? apiDailyReason(s, member, clock, requestId) : null;
  if (reason) return reason;
  entry.day = apiDay(clock); entry.startedAt = new Date(clock).toISOString(); entry.status = 'running'; return null;
}
export function settleApiUsage(s: WorkspaceState, requestId: string, usage: Usage, error: string | null, uncertain: boolean, clock = Date.now()): void {
  const e = s.apiUsage?.entries.find(e => e.requestId === requestId); if (!e) return;
  e.status = e.startedAt === null ? 'not_sent' : uncertain ? 'unconfirmed' : 'settled';
  if (usage !== null) e.usage = structuredClone(usage); e.error = error; e.finishedAt = uncertain ? null : new Date(clock).toISOString();
}
