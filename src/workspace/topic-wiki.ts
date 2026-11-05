import type { Discussion, DiscussionTurn, TopicWikiPublication, WorkspaceState } from './model.js';
import type { Room, RoomMessage } from './resident-model.js';
import type { Store } from './store.js';
import type { Wiki } from './wiki.js';
import { AppError, code, digest, now } from './util.js';
import { topicPolicy } from './resident-focus.js';
import { contextWiki, WIKI_LIMITS } from './wiki-policy.js';
import { dotGrants } from './dot-mcp-policy.js';

type Emit = Parameters<Parameters<Store['transact']>[0]>[1];
const live = ['prepared', 'running', 'unconfirmed'];
const scope = (s: WorkspaceState, r: Room, d: Discussion) => digest(JSON.stringify({ policy: topicPolicy(s, r), generations: d.contexts.map(c => ({ id: c.participantId, generation: c.generation })),
  dotAuthority: d.members.filter(m => m.kind === 'dot-mcp').map(m => ({ participantId: m.id, grants: dotGrants(s, r, m).map(g => ({ id: g.id, version: g.version })).sort((a, b) => a.id.localeCompare(b.id)) })) }));

export function prepareTopicWiki(s: WorkspaceState, r: Room, d: Discussion): void {
  d.wikiPublication = { revision: d.revision, roomEpoch: r.epoch, scopeDigest: scope(s, r, d), status: 'pending', reason: null, pageId: null, version: null, digest: null, inputDigest: null };
}

function publicResults(s: WorkspaceState, r: Room, d: Discussion): { turn: DiscussionTurn; message: RoomMessage }[] {
  const results: { turn: DiscussionTurn; message: RoomMessage }[] = [];
  for (const group of new Set(d.turns.filter(t => t.revision === d.revision).map(t => t.phase + ':' + t.round))) {
    const tasks = d.tasks.filter(t => t.revision === d.revision && t.phase + ':' + t.round === group);
    const participants = [...new Set(tasks.map(t => t.participantId))];
    if (!participants.length || tasks.some(t => ['pending', 'running', 'unconfirmed'].includes(t.status))) continue;
    const turns = participants.map(pid => d.turns.findLast(t => t.revision === d.revision && t.phase + ':' + t.round === group && t.participantId === pid && t.status === 'completed' && t.reply));
    if (turns.some(t => !t)) continue;
    for (const turn of turns) {
      if (!turn || turn.generation !== d.contexts.find(c => c.participantId === turn.participantId)?.generation) throw new AppError('topic_wiki_scope_changed', 409);
      const messages = s.resident!.messages.filter(m => m.roomId === r.id && m.sourceKind === 'topic' && m.sourceId === turn.id && m.authorId === turn.participantId && m.visibility === 'room_public' && m.text === turn.reply!.text);
      if (messages.length !== 1) throw new AppError('topic_wiki_sources_required', 409);
      results.push({ turn, message: messages[0]! });
    }
  }
  return results;
}

function publicationInput(s: WorkspaceState, r: Room, d: Discussion) {
  const results = publicResults(s, r, d);
  if (!results.length) throw new AppError('topic_wiki_no_public_result', 409);
  // Final synthesis/review is the outcome; earlier public rounds stay available
  // through an immutable index rather than copying every long reply again.
  let selected = results.filter(v => ['synthesis', 'summary_review'].includes(v.turn.phase));
  if (!selected.length) {
    const last = results.at(-1)!.turn;
    selected = results.filter(v => v.turn.phase === last.phase && v.turn.round === last.round);
  }
  if (selected.length > WIKI_LIMITS.sourceRefs) throw new AppError('topic_wiki_sources_limit', 409);
  const publicClaims = new Set(d.claims.filter(c => results.some(v => v.turn.id === c.turnId)).map(c => c.id));
  const publicEvidence = new Set(results.flatMap(v => v.turn.evidenceIds));
  if (selected.some(v => [...v.turn.reply!.reviews, ...v.turn.reply!.verifications].some(ref => !publicClaims.has(ref.claimId)))) throw new AppError('topic_wiki_sources_required', 409);
  const body = JSON.stringify({ topic: d.topic, discussionId: d.id, revision: d.revision, status: d.status, reason: d.reason,
    epistemicStatus: 'reported', conclusionAvailable: selected.some(v => v.turn.phase === 'synthesis'),
    note: '공개된 종합·검토의 보고입니다. 합의와 사실 검증은 다릅니다. 이전 라운드의 반론·미확인·전체 원문은 publicHistory의 원래 주제 기록에 보존됩니다. 부분 결과를 완료로 해석하지 마세요.',
    results: selected.map(({ turn, message }) => ({ messageId: message.id, turnId: turn.id, participantId: turn.participantId, phase: turn.phase, round: turn.round, ...turn.reply! })),
    publicHistory: results.map(({ turn, message }) => ({ messageId: message.id, turnId: turn.id, phase: turn.phase, round: turn.round, digest: digest(message.text), replyDigest: digest(JSON.stringify(turn.reply)) })),
    evidence: d.evidence.filter(e => e.revision === d.revision && publicEvidence.has(e.id) && e.claimIds.length && e.claimIds.every(id => publicClaims.has(id))).map(e => ({ id: e.id, claimIds: e.claimIds, kind: e.kind, status: e.status })) });
  if (body.length > WIKI_LIMITS.body) throw new AppError('topic_wiki_body_limit', 409);
  return { slug: `topic-${digest(d.id).slice(0, 32)}-r${d.revision}`, title: `주제 결과 · ${d.topic}`.slice(0, 200), body, scopeRef: 'room:' + r.id, expectedVersion: 0,
    sourceRefs: selected.map(({ message }) => ({ kind: 'message', id: message.id, digest: digest(message.text) })) };
}

export function publishTopicWiki(s: WorkspaceState, r: Room, d: Discussion, wiki: Wiki, emit: Emit): void {
  const p = d.wikiPublication;
  if (!p || p.status !== 'pending' || !['completed', 'partial', 'cancelled'].includes(d.status)) return;
  if (d.turns.some(t => live.includes(t.status)) || s.jobs.some(j => j.discussionId === d.id && ['queued', 'running', 'blocked_approval', 'reconciling'].includes(j.status))) return;
  const finish = (status: TopicWikiPublication['status'], reason: string | null) => {
    p.status = status; p.reason = reason; d.updatedAt = now();
    emit({ type: 'resident.topic_wiki_changed', discussionId: d.id, data: { roomId: r.id, discussionId: d.id, revision: p.revision, status, reason, pageId: p.pageId, version: p.version } });
  };
  if (d.status === 'cancelled') { finish('skipped', 'topic_wiki_cancelled'); return; }
  if (!wiki.enabled || !r.desiredOn || d.roomId !== r.id || r.topicLink !== d.id || p.revision !== d.revision || p.roomEpoch !== r.epoch || p.scopeDigest !== scope(s, r, d) ||
      d.members.some(m => m.kind === 'dot-mcp' && !dotGrants(s, r, m).length)) { finish('skipped', 'topic_wiki_scope_changed'); return; }
  try {
    const input = publicationInput(s, r, d); const editId = `topic:${d.id}:${d.revision}`;
    p.inputDigest = digest(JSON.stringify(input));
    // Reuse validation on an isolated candidate so context overflow cannot leave
    // a half-published page or notification in the surrounding transaction.
    if (!s.resident!.wikiVersions.some(v => v.editId === editId)) {
      const candidate = structuredClone(s); const room = candidate.resident!.rooms.find(v => v.id === r.id)!;
      const checked = wiki.editState(candidate, room, input, 'system', null, editId, () => {});
      if (checked.status !== 'conflict') contextWiki(candidate, room, []);
    }
    const result = wiki.editState(s, r, input, 'system', null, editId, emit);
    p.pageId = result.pageId; p.version = result.version; p.digest = result.digest;
    finish(result.status === 'conflict' ? 'blocked' : 'published', result.status === 'conflict' ? 'wiki_version_conflict' : null);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    finish('blocked', code(error));
  }
}
