import type { WorkspaceState } from './model.js';
import type { ResidentStateV1, Room, RoomMessage, RoomSummary } from './resident-model.js';
import type { Store } from './store.js';
import { AppError, digest, id, integer, now, object, string, strings } from './util.js';
import { budgetReason, toolBudget, usageFor, unresolvedProvider, validBudget, validPacing, validToolBudget } from './dispatch.js';
import { projectResidentStatus } from './resident-status.js';
import { ensureApiUsage } from './api-usage.js';

const MIGRATION = 'resident:migration:v1';
const STANDARD_PACING = { minIntervalMs: 30000, idleNudgeMs: 300000, passBackoffMs: 120000, sleepAfterPasses: 3 };
const COLLECTIONS = ['rooms', 'messages', 'turns', 'dispatchLeases', 'contextCheckpoints', 'workItems', 'workAttempts', 'wikiPages', 'wikiVersions', 'jobLinks', 'residentGrants'] as const;

export function readResident(state: WorkspaceState): ResidentStateV1 | null {
  const raw: unknown = state.resident;
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('resident_state_invalid', 503);
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) throw new AppError('unsupported_resident_schema', 503);
  if (COLLECTIONS.some(key => !Array.isArray(value[key]))) throw new AppError('resident_state_invalid', 503);
  const resident = raw as ResidentStateV1;
  if (!resident.migration || resident.migration.id !== 'resident-v1' || !isText(resident.migration.at) || !isCount(resident.migration.basisCursor) ||
      resident.rooms.some(room => !room || !isText(room.id) || !isText(room.title) || !isCount(room.version, 1) || !isCount(room.epoch, 1) ||
        typeof room.desiredOn !== 'boolean' || room.budgetMode !== undefined && !['legacy', 'api-daily'].includes(room.budgetMode) || room.autoTopic !== undefined && typeof room.autoTopic !== 'boolean' || !['off', 'on', 'sleeping', 'blocked', 'budget_exhausted'].includes(room.observedStatus) ||
        !Array.isArray(room.members) || room.members.some(m => !m || !isText(m.participantId) || typeof m.enabled !== 'boolean') ||
        !Array.isArray(room.legacyDiscussionIds) || !room.legacyDiscussionIds.every(isText) ||
        !(room.topicLink === null || isText(room.topicLink)) || !isCount(room.lastMessageSequence) || !isText(room.createdAt) || !isText(room.updatedAt) ||
        room.budgets !== null && !validBudget(room.budgets) || room.toolBudget !== undefined && room.toolBudget !== null && !validToolBudget(room.toolBudget) || room.pacing !== undefined && room.pacing !== null && !validPacing(room.pacing) ||
        room.ledger !== undefined && (!Array.isArray(room.ledger) || room.ledger.some(e => !e || !isText(e.requestId) || !['topic', 'resident', 'work'].includes(e.kind) || !isText(e.reservedAt) || !(e.settledAt === null || isText(e.settledAt)) ||
          !(e.usage === null || e.usage && isCount(e.usage.input) && isCount(e.usage.output)))) ||
        room.contexts !== undefined && (!Array.isArray(room.contexts) || room.contexts.some(c => !c || !isText(c.participantId) || !isCount(c.generation, 1) || !isCount(c.lastSeenSequence) || !Array.isArray(c.history) || c.history.some(h => !h || !['user', 'assistant'].includes(h.role) || typeof h.content !== 'string')))) ||
      resident.messages.some(m => !m || !isText(m.id) || !isText(m.roomId) || !isCount(m.sequence, 1) || typeof m.text !== 'string' ||
        !['user', 'room', 'topic', 'work', 'wiki', 'system'].includes(m.sourceKind) || !(m.sourceId === null || isText(m.sourceId)) ||
        !isText(m.authorId) || !(m.replyTo === null || isText(m.replyTo)) || !Array.isArray(m.mentions) || !m.mentions.every(isText) ||
        !['room_public', 'owner_only', 'topic_round'].includes(m.visibility) || !isText(m.createdAt))) throw new AppError('resident_state_invalid', 503);
  return raw as ResidentStateV1;
}

export function migrateResident(store: Store): void {
  if (readResident(store.read())) return;
  const basisCursor = store.cursor();
  store.transact(state => {
    const at = now();
    const room: Room = { id: id('room'), title: '상주 작업실', version: 1, epoch: 1,
      desiredOn: false, observedStatus: 'off', members: state.participants.map(p => ({ participantId: p.id, enabled: false })),
      legacyDiscussionIds: state.discussions.map(d => d.id), topicLink: null, budgets: null, nextEligibleAt: null,
      budgetMode: 'api-daily', pacing: { ...STANDARD_PACING },
      lastMessageSequence: 0, createdAt: at, updatedAt: at };
    state.resident = { schemaVersion: 1, migration: { id: 'resident-v1', at, basisCursor }, rooms: [room],
      messages: [], turns: [], dispatchLeases: [], contextCheckpoints: [], workItems: [], workAttempts: [],
      wikiPages: [], wikiVersions: [], jobLinks: [], residentGrants: [] };
    // The migration receipt is durable, but no legacy cursor or user activity is
    // replayed. User commands below always commit state, event and receipt together.
    return { roomId: room.id };
  }, { id: MIGRATION, input: { action: 'resident.migrate', schemaVersion: 1 } });
  if (!readResident(store.read())) throw new AppError('resident_migration_state_missing', 503);
}

export class ResidentStore {
  dispatchAvailable = false;
  constructor(private readonly store: Store, readonly enabled: boolean) {
    // Refuse unknown schema before any new lifecycle/connection can start.
    readResident(store.read());
    if (enabled) migrateResident(store);
  }
  snapshot() {
    const state = readResident(this.store.read());
    return { enabled: this.enabled, schemaVersion: state?.schemaVersion ?? null, dispatchAvailable: this.enabled && this.dispatchAvailable,
      rooms: (state?.rooms ?? []).map(summary) };
  }
  room(roomId: string) {
    const room = findRoom(this.required(), roomId); const cursor = this.store.cursor();
    return { room: summary(room), contexts: (room.contexts ?? []).map(c => ({ participantId: c.participantId, generation: c.generation, checkpointId: c.checkpointId })),
      status: projectResidentStatus(this.store.read(), roomId, this.store.events(Math.max(0, cursor - 250), 250)),
      dispatchAvailable: this.enabled && this.dispatchAvailable, enabled: this.enabled, cursor };
  }
  messages(roomId: string, after: number, limit: number) {
    integer(after, 0, 0, Number.MAX_SAFE_INTEGER); integer(limit, 50, 1, 100);
    const state = this.required(); const room = findRoom(state, roomId);
    if (after > room.lastMessageSequence) throw new AppError('invalid_cursor', 409);
    const page = state.messages.filter(m => m.roomId === roomId && m.visibility === 'room_public' && m.sequence > after)
      .sort((a, b) => a.sequence - b.sequence).slice(0, limit + 1);
    const messages = page.slice(0, limit).map(m => ({ ...messageMetadata(m), preview: m.text.slice(0, 500), truncated: m.text.length > 500, textLength: m.text.length, digest: digest(m.text) }));
    return { roomId, messages, after, nextAfter: messages.at(-1)?.sequence ?? after, hasMore: page.length > limit, cursor: this.store.cursor() };
  }
  message(roomId: string, messageId: string) {
    const state = this.required(); findRoom(state, roomId);
    const message = state.messages.find(m => m.id === messageId && m.roomId === roomId && m.visibility === 'room_public');
    if (!message) throw new AppError('room_message_not_found', 404);
    return { message: { ...messageMetadata(message), text: message.text }, digest: digest(message.text), cursor: this.store.cursor() };
  }
  control(roomId: string, input: unknown, requestId: string) {
    const body = object(input); const action = string(body.action, 40); const key = string(requestId, 200);
    const fields = action === 'rename' ? ['title'] : action === 'set_member' ? ['participantId', 'enabled'] : action === 'configure' ? ['budgets', 'pacing', 'autoTopic', 'budgetMode', 'toolBudget'] : [];
    only(body, ['action', 'expectedVersion', ...fields]);
    readResident(this.store.read());
    return this.store.transact((state, emit) => {
      this.assertEnabled(); const resident = readResident(state); if (!resident) throw new AppError('resident_not_initialized', 409);
      const room = findRoom(resident, roomId);
      if (integer(body.expectedVersion, -1, 1, Number.MAX_SAFE_INTEGER) !== room.version) throw new AppError('room_version_conflict', 409);
      let changed = false;
      if (action === 'rename') { const title = string(body.title, 100); changed = title !== room.title; room.title = title; }
      else if (action === 'set_member') {
        const pid = string(body.participantId, 200);
        if (typeof body.enabled !== 'boolean') throw new AppError('invalid_input');
        if (!state.participants.some(p => p.id === pid)) throw new AppError('participant_not_found', 404);
        const member = room.members.find(m => m.participantId === pid);
        if (member) { changed = member.enabled !== body.enabled || !!member.blockedReason; member.enabled = body.enabled; member.blockedReason = null; }
        else { room.members.push({ participantId: pid, enabled: body.enabled }); changed = true; }
      } else if (action === 'configure') {
        if (room.desiredOn || state.resident!.turns.some(t => t.roomId === roomId && ['prepared', 'running', 'unconfirmed'].includes(t.status)) || state.resident!.dispatchLeases.some(l => l.roomId === roomId && l.state !== 'released')) throw new AppError('room_configuration_requires_off', 409);
        if (body.autoTopic !== undefined && typeof body.autoTopic !== 'boolean') throw new AppError('invalid_input');
        if (body.autoTopic !== undefined) room.autoTopic = body.autoTopic;
        if (body.budgetMode !== undefined && !['legacy', 'api-daily'].includes(String(body.budgetMode))) throw new AppError('invalid_budget_mode');
        // Old clients may still send a mode/budgets payload. It never restores
        // a room-wide chat limit. Original values remain readable history.
        if (room.budgetMode !== 'api-daily') { room.epoch++; room.budgetMode = 'api-daily'; }
        ensureApiUsage(state);
        const pacing = object(body.pacing ?? room.pacing ?? STANDARD_PACING);
        if (body.budgets !== undefined) {
          const budget = object(body.budgets); only(budget, ['maxRequests', 'maxTokens', 'maxToolJobs', 'deadlineAt']);
          const deadlineAt = string(budget.deadlineAt, 100);
          if (!Number.isFinite(Date.parse(deadlineAt)) || new Date(deadlineAt).toISOString() !== deadlineAt) throw new AppError('invalid_room_deadline');
          room.budgets = { maxRequests: requiredInteger(budget.maxRequests, 1, 10_000), maxTokens: requiredInteger(budget.maxTokens, 1, 100_000_000), maxToolJobs: requiredInteger(budget.maxToolJobs, 0, 100), deadlineAt };
        }
        if (body.toolBudget === null) room.toolBudget = null;
        else if (body.toolBudget !== undefined) {
          const b = object(body.toolBudget); only(b, ['maxToolJobs', 'deadlineAt']); const deadlineAt = string(b.deadlineAt, 100);
          if (!Number.isFinite(Date.parse(deadlineAt)) || Date.parse(deadlineAt) <= Date.now() || new Date(deadlineAt).toISOString() !== deadlineAt) throw new AppError('invalid_tool_deadline');
          room.toolBudget = { maxToolJobs: requiredInteger(b.maxToolJobs, 0, 100), deadlineAt };
        }
        only(pacing, ['minIntervalMs', 'idleNudgeMs', 'passBackoffMs', 'sleepAfterPasses']);
        room.pacing = { minIntervalMs: requiredInteger(pacing.minIntervalMs, 1, 3_600_000), idleNudgeMs: requiredInteger(pacing.idleNudgeMs, 1, 86_400_000), passBackoffMs: requiredInteger(pacing.passBackoffMs, 1, 86_400_000), sleepAfterPasses: requiredInteger(pacing.sleepAfterPasses, 1, 100) };
        // Counts and immutable request IDs survive every explicit budget update.
        changed = true; room.reason = null;
      } else if (action === 'off') {
        changed = room.desiredOn || room.observedStatus !== 'off';
        if (changed) room.epoch++;
        room.desiredOn = false; room.observedStatus = 'off'; room.nextEligibleAt = null;
      } else if (action === 'on' || action === 'wake') {
        if (!this.dispatchAvailable) throw new AppError('resident_dispatch_not_available', 409);
        if (unresolvedProvider(state) || state.resident!.dispatchLeases.some(l => l.state !== 'released')) throw new AppError('reconciliation_required', 409);
        if (room.budgetMode !== 'api-daily' && state.jobs.some(j => ['queued', 'running', 'blocked_approval', 'reconciling'].includes(j.status))) throw new AppError('reconciliation_required', 409);
        if (!room.members.some(m => m.enabled && !m.blockedReason)) throw new AppError('room_members_required', 409);
        if (action === 'on' && room.desiredOn && room.observedStatus === 'on' && room.budgetMode === 'api-daily' && room.pacing) return { roomId, version: room.version, changed: false };
        room.pacing ??= { ...STANDARD_PACING }; ensureApiUsage(state); room.budgetMode = 'api-daily';
        if (!room.desiredOn) room.epoch++;
        changed = true; room.desiredOn = true; room.observedStatus = 'on'; room.reason = null; room.passCount = 0;
        room.nextEligibleAt = room.lastCompletedAt && room.pacing ? new Date(Math.max(Date.now(), Date.parse(room.lastCompletedAt) + room.pacing.minIntervalMs)).toISOString() : now();
      }
      else throw new AppError('unknown_room_control');
      if (changed) {
        room.version++; room.updatedAt = now();
        emit({ type: 'resident.room_changed', discussionId: null, data: { roomId, action, version: room.version } });
      }
      return { roomId, version: room.version, changed };
    }, { id: 'resident:command:' + key, input: { roomId, operation: 'control', body } });
  }
  postMessage(roomId: string, input: unknown, requestId: string) {
    const body = object(input); only(body, ['text', 'replyTo', 'mentions']); const key = string(requestId, 200);
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20_000) throw new AppError('invalid_room_message');
    const text = body.text; const replyTo = body.replyTo === undefined || body.replyTo === null ? null : string(body.replyTo, 200);
    const mentions = [...new Set(strings(body.mentions ?? [], 8))];
    readResident(this.store.read());
    return this.store.transact((state, emit) => {
      this.assertEnabled(); const resident = readResident(state); if (!resident) throw new AppError('resident_not_initialized', 409);
      const room = findRoom(resident, roomId);
      if (replyTo && !resident.messages.some(m => m.id === replyTo && m.roomId === roomId && m.visibility === 'room_public')) throw new AppError('reply_not_in_room', 403);
      if (mentions.some(pid => !room.members.some(m => m.participantId === pid) || !state.participants.some(p => p.id === pid))) throw new AppError('mention_not_in_room', 403);
      const message: RoomMessage = { id: id('message'), roomId, sequence: ++room.lastMessageSequence,
        sourceKind: 'user', sourceId: null, authorId: 'owner', text, replyTo, mentions,
        visibility: 'room_public', createdAt: now() };
      resident.messages.push(message); room.updatedAt = message.createdAt;
      if (room.desiredOn && room.observedStatus === 'sleeping' && !budgetReason(room)) { room.observedStatus = 'on'; room.reason = null; room.passCount = 0;
        room.nextEligibleAt = new Date(Math.max(Date.now(), room.lastCompletedAt && room.pacing ? Date.parse(room.lastCompletedAt) + room.pacing.minIntervalMs : 0)).toISOString(); }
      emit({ type: 'resident.message_created', discussionId: null, data: { roomId, messageId: message.id, sequence: message.sequence } });
      return { roomId, messageId: message.id, sequence: message.sequence };
    }, { id: 'resident:command:' + key, input: { roomId, operation: 'message', body } });
  }
  private assertEnabled(): void { if (!this.enabled) throw new AppError('resident_disabled', 409); }
  private required(): ResidentStateV1 { const state = readResident(this.store.read()); if (!state) throw new AppError('resident_not_initialized', 404); return state; }
}

function findRoom(state: ResidentStateV1, roomId: string): Room {
  const room = state.rooms.find(r => r.id === roomId); if (!room) throw new AppError('room_not_found', 404); return room;
}
function summary(room: Room): RoomSummary {
  return { id: room.id, title: room.title, version: room.version, epoch: room.epoch, desiredOn: room.desiredOn,
    observedStatus: room.observedStatus, members: room.members.map(m => ({ participantId: m.participantId, enabled: m.enabled, ...(m.blockedReason ? { blockedReason: m.blockedReason } : {}) })),
    legacyDiscussionIds: [...room.legacyDiscussionIds], topicLink: room.topicLink, lastMessageSequence: room.lastMessageSequence,
    createdAt: room.createdAt, updatedAt: room.updatedAt, budgets: room.budgets, toolBudget: toolBudget(room), budgetMode: 'api-daily', pacing: room.pacing ?? null, autoTopic: room.autoTopic === true, reason: room.reason ?? null, nextEligibleAt: room.nextEligibleAt, used: usageFor(room) };
}
function only(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AppError('invalid_room_fields');
}
function isText(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function isCount(value: unknown, min = 0): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min; }
function requiredInteger(value: unknown, min: number, max: number): number { if (value === undefined) throw new AppError('room_settings_required'); return integer(value, min, min, max); }
function messageMetadata(m: RoomMessage): Omit<RoomMessage, 'text'> {
  return { id: m.id, roomId: m.roomId, sequence: m.sequence, sourceKind: m.sourceKind, sourceId: m.sourceId,
    authorId: m.authorId, replyTo: m.replyTo, mentions: [...m.mentions], visibility: m.visibility, createdAt: m.createdAt, ...(m.wikiCitations ? { wikiCitations: structuredClone(m.wikiCitations) } : {}) };
}
