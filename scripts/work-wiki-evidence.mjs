// Offline observation of R5/R7 records, never authority to dispatch or accept a model.
// Standalone on purpose: importing this module needs neither a build nor app startup.
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';

const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string';
const id = v => text(v) && v.length > 0 && v.length <= 200 && v.trim() === v;
const positive = v => Number.isSafeInteger(v) && v > 0;
const ids = v => Array.isArray(v) && v.every(id) && new Set(v).size === v.length;
const uniqueText = values => [...new Set(values.map(v => v.trim()))];
const hash = v => createHash('sha256').update(v).digest('hex');
const digest = v => hash(JSON.stringify(v));
const one = values => values.length === 1 ? values[0] : null;
const time = v => text(v) ? Date.parse(v) : NaN;
const citation = v => ({ pageId: v.pageId, version: v.version, digest: v.digest, scopeRef: v.scopeRef, sourceRefs: v.sourceRefs });
const snapshot = v => ({ ...citation(v), title: v.title, body: v.body, epistemicStatus: v.epistemicStatus });
const only = (v, keys) => object(v) && Object.keys(v).every(key => keys.includes(key));

function report() {
  return {
    evidence: 'stored_snapshot_only', modelCalls: 0, realModelAcceptance: 'UNVERIFIED_BY_AUDIT', status: 'incomplete',
    checks: { schemaSupported: false, taskFound: false, ambientProposal: false, taskDone: false, frozenWorkReports: false,
      acceptedIndependentReview: false, currentReportWiki: false, wikiNotice: false, subsequentAmbientCitation: false },
    counts: { proposalTurns: 0, reports: 0, workAttempts: 0, reviewAttempts: 0, acceptedReviews: 0,
      currentReportWikiVersions: 0, currentReportWikiNotices: 0, subsequentAmbientCitations: 0 }, reasonCodes: [],
  };
}

// Only parse the saved structured input block, never search for a body substring.
function input(turn, key) {
  if (!text(turn.prompt) || hash(turn.prompt) !== turn.promptDigest) return null;
  const block = one(turn.prompt.split('\n\n').filter(p => p.startsWith('{"' + key + '":')));
  try { const value = JSON.parse(block); return object(value) ? value : null; } catch { return null; }
}

function completedSay(turn) {
  if (!turn || turn.status !== 'completed' || turn.reply?.version !== 1 || turn.reply.action !== 'say' ||
      !text(turn.reply.text) || !turn.reply.text.trim() || !Array.isArray(turn.reply.proposals) ||
      turn.participant?.id !== turn.participantId || !positive(turn.generation) || !positive(turn.epoch) ||
      !Number.isFinite(time(turn.startedAt)) || !Number.isFinite(time(turn.finishedAt)) || time(turn.finishedAt) < time(turn.startedAt)) return false;
  try {
    const raw = JSON.parse(turn.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    const proposals = (raw.proposals ?? []).map(p => ({ kind: p.kind.trim(), payload: p.payload }));
    return raw.version === 1 && raw.action === 'say' && raw.text === turn.reply.text && same(proposals, turn.reply.proposals);
  } catch { return false; }
}

function publicMessage(r, turn) {
  const m = one(r.messages.filter(m => m.sourceKind === 'room' && m.sourceId === turn.id));
  return m && m.id === turn.messageId && m.roomId === turn.roomId && m.authorId === turn.participantId &&
    m.visibility === 'room_public' && m.text === turn.reply?.text && positive(m.sequence) ? m : null;
}

function publicSources(r, roomId, sourceIds, saved) {
  if (!ids(sourceIds) || !sourceIds.length || saved && (!Array.isArray(saved) || saved.length !== sourceIds.length)) return false;
  return sourceIds.every(sourceId => {
    const m = one(r.messages.filter(m => m.id === sourceId && m.roomId === roomId && m.visibility === 'room_public'));
    return !!m && (!saved || saved.some(s => same(s, m)));
  });
}

// WorkQueue.fields/proposeState's existing normalization and field order.
function proposalDigest(p, turn) {
  try {
    const acceptance = (p.acceptance ?? []).map(a => ({ id: a.id.trim(), text: a.text.trim(),
      check: { kind: a.check?.kind ?? 'manual', ...(a.check?.kind === 'text_includes' ? { value: a.check.value.trim() } : {}) } }));
    return digest({ title: p.title.trim(), description: (p.description ?? '').trim(), kind: p.kind.trim(),
      sourceMessageIds: uniqueText(p.sourceMessageIds ?? [turn.messageId]), acceptance, priority: p.priority ?? 0,
      requiredRole: p.requiredRole?.trim() || null, allowedParticipantIds: uniqueText(p.allowedParticipantIds ?? []),
      dependencies: uniqueText(p.dependencies ?? []), authorizedScopeRef: (p.authorizedScopeRef ?? '').trim() });
  } catch { return null; }
}

function hasProposal(r, task, turn) {
  const message = publicMessage(r, turn);
  if (turn.roomId !== task.roomId || turn.participantId !== task.proposedBy || turn.workAttemptId || !completedSay(turn) ||
      !message || !Array.isArray(turn.proposalResults)) return false;
  const work = r.turns.filter(t => r.workAttempts.some(a => a.taskId === task.id && a.purpose === 'work' && a.providerTurnId === t.id));
  // Use the durable order/basis and scheduler completion clock. Work preparation
  // uses wall time, while resident completion may use the injected scheduler clock.
  if (work.some(t => r.turns.indexOf(turn) >= r.turns.indexOf(t) || t.basisSequence < message.sequence ||
    Number.isFinite(time(t.finishedAt)) && time(turn.finishedAt) > time(t.finishedAt))) return false;
  const data = input(turn, 'roomId');
  if (data?.roomId !== task.roomId || data.participant?.id !== turn.participantId || data.generation !== turn.generation) return false;
  return turn.reply.proposals.some((p, index) => p.kind === 'work_propose' && object(p.payload) && p.payload.taskId === undefined &&
    (p.payload.proposalKey ?? `${turn.id}:${index}`) === task.proposalKey && proposalDigest(p.payload, turn) === task.proposalDigest &&
    turn.proposalResults.some(v => v.index === index && v.taskId === task.id && v.status === 'applied'));
}

function attemptTurn(r, task, attempt, purpose) {
  if (!attempt || attempt.taskId !== task.id || attempt.roomId !== task.roomId || attempt.purpose !== purpose ||
      attempt.status !== 'completed' || attempt.reported !== true || !positive(attempt.taskVersion) ||
      !object(attempt.input) || digest(attempt.input) !== attempt.inputDigest ||
      attempt.requestId !== 'resident-work:' + attempt.id || attempt.input.kind !== task.kind ||
      attempt.input.authorizedScopeRef !== attempt.authorizedScopeRef || !ids(attempt.input.feedbackReviewIds)) return null;
  const turn = one(r.turns.filter(t => t.id === attempt.providerTurnId));
  if (!completedSay(turn) || turn.workAttemptId !== attempt.id || turn.roomId !== task.roomId ||
      turn.participantId !== attempt.participantId || turn.generation !== attempt.contextGeneration || turn.epoch !== attempt.epoch ||
      turn.workSeatVersion !== attempt.seatVersion || turn.promptDigest !== attempt.providerPromptDigest || turn.proposalsStatus !== 'applied') return null;
  const data = input(turn, 'taskId');
  const previous = attempt.input.previousReportId === null ? null : task.reports.find(p => p.id === attempt.input.previousReportId);
  const feedback = attempt.input.feedbackReviewIds?.map(reviewId => task.reviews.find(v => v.id === reviewId));
  if (!data || data.taskId !== task.id || data.attemptId !== attempt.id || data.taskVersion !== attempt.taskVersion || data.purpose !== purpose ||
      data.title !== attempt.input.title || data.description !== attempt.input.description || !same(data.acceptance, attempt.input.acceptance) ||
      data.authorizedScopeRef !== attempt.authorizedScopeRef || !Array.isArray(data.sourceMessages) || !publicSources(r, task.roomId, attempt.input.sourceMessageIds, data.sourceMessages) ||
      !same(data.wiki, attempt.input.wikiCitations) || !same(turn.wikiCitations, data.wiki) ||
      !Array.isArray(feedback) || feedback.some(v => !v) || !same(data.reviewFeedback, feedback) ||
      (purpose === 'work' ? !same(data.previousReport, previous) || data.report !== null : data.previousReport !== null)) return null;
  return { attempt, turn, data };
}

function analysisChecks(p, ref) {
  // WorkQueue's analysis artifact checks observe string inclusion only. Manual
  // and execution criteria cannot become observed_pass from a model assertion.
  return p.acceptance.map(a => ({ acceptanceId: a.id,
    outcome: a.check.kind === 'text_includes' ? text(a.check.value) && a.check.value.length > 0 && p.text.includes(a.check.value) ? 'observed_pass' : 'observed_fail' : a.check.kind === 'execution' ? 'not_run' : 'reported',
    evidenceRefs: [ref] }));
}

function workReport(r, task, p) {
  const a = one(r.workAttempts.filter(a => a.id === p.attemptId));
  const link = attemptTurn(r, task, a, 'work');
  if (!link || p.version !== 1 || p.taskId !== task.id || p.taskVersion !== a.taskVersion || p.authorId !== a.participantId ||
      !text(p.text) || p.digest !== digest({ ...p, digest: undefined }) || !same(p.acceptance, a.input.acceptance) ||
      !Array.isArray(p.checks) || !same(p.checks.map(({ acceptanceId, outcome, evidenceRefs }) => ({ acceptanceId, outcome, evidenceRefs })), analysisChecks(p, 'turn:' + link.turn.id)) ||
      !same(p.sourceMessageIds, a.input.sourceMessageIds) ||
      !same(p.blockers, uniqueText(link.turn.reply.proposals.find(v => v.kind === 'work_report')?.payload?.blockers ?? [])) ||
      !same(p.wikiCitations, a.input.wikiCitations.map(citation)) ||
      !same(p.outputs, [{ ref: 'turn:' + link.turn.id, digest: hash(p.text), kind: 'text' }]) || p.text !== link.turn.reply.text) return false;
  const intent = one(link.turn.reply.proposals.filter(v => v.kind === 'work_report'))?.payload;
  const m = one(r.messages.filter(m => m.sourceKind === 'work' && m.sourceId === p.id));
  return only(intent, ['version', 'taskId', 'taskVersion', 'attemptId', 'summary', 'blockers']) &&
    intent.version === 1 && intent.taskId === task.id && intent.attemptId === a.id && intent.taskVersion === a.taskVersion &&
    intent.summary?.trim() === p.summary && m?.id === link.turn.messageId && m.roomId === task.roomId && m.authorId === p.authorId &&
    m.visibility === 'room_public' && m.text === `${a.input.title} · 산출물 보고\n${p.text}`;
}

function reviewLink(r, task, review) {
  const p = one(task.reports.filter(p => p.digest === review.reportDigest));
  // WorkQueue.reviewState compares participant IDs. Shared connections do not revoke independence.
  if (!p || review.version !== 1 || review.reviewerId === p.authorId || review.reviewerId === 'owner') return null;
  const links = r.workAttempts.filter(a => a.taskId === task.id && a.purpose === 'review' &&
    a.reportDigest === p.digest && a.participantId === review.reviewerId && a.taskVersion === review.taskVersion)
    .map(a => attemptTurn(r, task, a, 'review')).filter(Boolean).filter(link => {
      const b = one(link.turn.reply.proposals.filter(v => v.kind === 'work_review'))?.payload;
      return only(b, ['version', 'taskId', 'taskVersion', 'attemptId', 'expectedVersion', 'reportDigest', 'decision', 'reason', 'confirmedAcceptanceIds']) &&
        b.version === 1 && b.taskId === task.id && b.attemptId === link.attempt.id && b.taskVersion === review.taskVersion &&
        b.reportDigest === p.digest && b.reason?.trim() === review.reason && same(link.data.report, p) &&
        link.attempt.input.previousReportId === p.id && same(review.checks, p.checks) &&
        (b.decision === review.decision || b.decision === 'accept' && review.decision === 'blocked');
    });
  const link = one(links);
  const message = one(r.messages.filter(m => m.sourceKind === 'work' && m.sourceId === review.id));
  const reportMessage = r.messages.find(m => m.sourceKind === 'work' && m.sourceId === p.id);
  const verdict = { accept: '검토 후 완료', rework: '재작업 요청', blocked: '검토 보류' }[review.decision];
  return link && message?.roomId === task.roomId && message.authorId === review.reviewerId && message.visibility === 'room_public' &&
    positive(message.sequence) && link.turn.basisSequence >= reportMessage?.sequence && message.sequence > reportMessage.sequence &&
    message.text === `${link.attempt.input.title} · ${verdict}\n${review.reason}` ? { ...link, message } : null;
}

// Mirrors the pure wikiVersionDigest contract in wiki-policy; no app/runtime import.
function wikiDigest(v) {
  return digest({ pageId: v.pageId, roomId: v.roomId, scopeRef: v.scopeRef, title: v.title, body: v.body,
    sourceRefs: v.sourceRefs, tombstone: v.tombstone, epistemicStatus: v.epistemicStatus });
}

function reportWiki(r, task, p, v) {
  const a = r.workAttempts.find(a => a.id === p.attemptId);
  const page = one(r.wikiPages.filter(page => page.id === v.pageId));
  let body; try { body = JSON.parse(v.body); } catch { return false; }
  const sourceStatus = p.checks.some(c => ['observed_pass', 'observed_fail'].includes(c.outcome)) ? 'observed' :
    p.checks.some(c => c.outcome === 'not_run') ? 'not_run' : 'reported';
  return page?.roomId === task.roomId && page.scopeRef === a.authorizedScopeRef && v.roomId === task.roomId &&
    v.scopeRef === a.authorizedScopeRef && v.authoredBy === p.authorId && positive(v.version) && page.headVersion >= v.version &&
    v.status === 'published' && v.epistemicStatus === 'reported' && v.tombstone === false && v.digest === wikiDigest(v) &&
    same(v.sourceRefs, [{ kind: 'report', id: p.id, digest: p.digest, status: sourceStatus }]) &&
    body.reportId === p.id && body.reportDigest === p.digest && body.summary === p.summary &&
    (body.originalTextIncluded === false ? body.textLength === p.text.length : body.text === p.text && same(body.checks, p.checks) && same(body.blockers, p.blockers));
}

function ambientCitation(r, task, turn, v, accepted) {
  if (turn.workAttemptId || turn.roomId !== task.roomId || !completedSay(turn) ||
      r.turns.indexOf(turn) <= r.turns.indexOf(accepted.turn) || time(turn.startedAt) < time(accepted.turn.finishedAt)) return false;
  const m = publicMessage(r, turn); const data = input(turn, 'roomId');
  return !!m && data?.roomId === task.roomId && data.participant?.id === turn.participantId &&
    data.generation === turn.generation &&
    turn.basisSequence >= accepted.message.sequence && m.sequence > accepted.message.sequence &&
    Array.isArray(turn.wikiCitations) && same(data.wiki, turn.wikiCitations) &&
    turn.wikiCitations.filter(ref => same(ref, snapshot(v))).length === 1 &&
    same(m.wikiCitations, turn.wikiCitations.map(citation));
}

export function inspectWorkWikiCycle(state, taskId) {
  const out = report(); let invalid = false;
  const fail = (code, fatal = false) => { if (!out.reasonCodes.includes(code)) out.reasonCodes.push(code); invalid ||= fatal; };
  const check = (name, ok, code, fatal = false) => { out.checks[name] = !!ok; if (!ok) fail(code, fatal); };
  const finish = () => { out.status = invalid ? 'invalid' : Object.values(out.checks).every(Boolean) ? 'records_consistent' : 'incomplete'; return out; };
  try {
    const r = state?.resident;
    check('schemaSupported', object(state) && state.version === 1 && object(r) && r.schemaVersion === 1 &&
      r.workSchemaVersion === 1 && r.wikiSchemaVersion === 1 && [undefined, 1].includes(r.workExecutionSchemaVersion), 'UNSUPPORTED_SCHEMA', true);
    if (!out.checks.schemaSupported) return finish();
    const collections = [state.participants, r.rooms, r.workItems, r.workAttempts, r.turns, r.messages, r.wikiPages, r.wikiVersions];
    if (!id(taskId) || collections.some(items => !Array.isArray(items) || items.length > 100000 ||
      items.some(v => !object(v) || !id(v.id)) || new Set(items.map(v => v.id)).size !== items.length)) {
      fail('MALFORMED_SNAPSHOT', true); return finish();
    }
    const task = r.workItems.find(t => t.id === taskId);
    check('taskFound', task, 'TASK_NOT_FOUND'); if (!task) return finish();
    if (task.kind !== 'analysis' || !positive(task.version) || !id(task.proposedBy) || !id(task.proposalKey) ||
        !/^[a-f0-9]{64}$/.test(task.proposalDigest) || !Array.isArray(task.reports) || !Array.isArray(task.reviews) ||
        !Array.isArray(task.acceptance) || !ids(task.sourceMessageIds) || !id(task.authorizedScopeRef) ||
        !['backlog', 'ready', 'claimed', 'running', 'review', 'rework', 'done', 'blocked', 'failed', 'cancelled'].includes(task.status) ||
        !r.rooms.some(room => room.id === task.roomId)) {
      fail('UNSUPPORTED_TASK_RECORD', true); return finish();
    }
    if ([...task.reports, ...task.reviews].some(v => !object(v) || v.version !== 1 || !id(v.id)) ||
        new Set([...task.reports, ...task.reviews].map(v => v.id)).size !== task.reports.length + task.reviews.length) {
      fail('UNSUPPORTED_REPORT_REVIEW_RECORD', true); return finish();
    }
    out.counts.reports = task.reports.length;
    out.counts.workAttempts = r.workAttempts.filter(a => a.taskId === task.id && a.purpose === 'work').length;
    out.counts.reviewAttempts = r.workAttempts.filter(a => a.taskId === task.id && a.purpose === 'review').length;
    out.counts.proposalTurns = r.turns.filter(turn => hasProposal(r, task, turn)).length;
    check('ambientProposal', task.proposedBy !== 'owner' && out.counts.proposalTurns > 0 &&
      publicSources(r, task.roomId, task.sourceMessageIds), task.proposedBy === 'owner' ? 'OWNER_CREATED_TASK' : 'AMBIENT_PROPOSAL_MISSING', true);
    check('taskDone', task.status === 'done', 'TASK_NOT_DONE');
    check('frozenWorkReports', task.reports.length > 0 && task.reports.every(p => workReport(r, task, p)),
      task.reports.length ? 'REPORT_CHAIN_MISMATCH' : 'REPORT_MISSING', task.reports.length > 0);
    const current = one(task.reports.filter(p => p.id === task.currentReportId));
    if (!current) { fail('CURRENT_REPORT_MISSING'); return finish(); }
    const currentAttempt = r.workAttempts.find(a => a.id === current.attemptId);
    if (task.currentAttemptId !== current.attemptId || currentAttempt?.authorizedScopeRef !== task.authorizedScopeRef ||
        !same(current.sourceMessageIds, task.sourceMessageIds) || !same(current.acceptance, task.acceptance)) fail('CURRENT_REPORT_CHAIN_MISMATCH', true);
    for (const review of task.reviews) {
      const p = task.reports.find(p => p.digest === review.reportDigest);
      if (!p) fail('REVIEW_REPORT_MISMATCH', true);
      else if (p.authorId === review.reviewerId) fail('REVIEW_NOT_INDEPENDENT', true);
      else if (!reviewLink(r, task, review)) fail('REVIEW_CHAIN_MISMATCH', true);
    }
    const accepted = task.reviews.filter(v => v.reportDigest === current.digest && v.decision === 'accept');
    out.counts.acceptedReviews = accepted.length;
    const link = accepted.length === 1 ? reviewLink(r, task, accepted[0]) : null;
    const observed = current.outputs.length > 0 && current.blockers.length === 0 && current.acceptance.length > 0 &&
      current.checks.length === current.acceptance.length && current.checks.every(c => c.outcome === 'observed_pass') &&
      current.acceptance.every(a => current.checks.filter(c => c.acceptanceId === a.id).length === 1);
    if (task.status === 'done' && !observed) fail('DONE_ACCEPTANCE_NOT_OBSERVED', true);
    check('acceptedIndependentReview', link && observed && accepted[0].taskVersion + 1 === task.version, 'ACCEPTED_REVIEW_MISSING');
    if (accepted.length > 1) fail('MULTIPLE_ACCEPTED_REVIEWS', true);
    const versions = r.wikiVersions.filter(v => v.editId === 'report:' + current.id);
    out.counts.currentReportWikiVersions = versions.length;
    const wiki = one(versions);
    check('currentReportWiki', wiki && reportWiki(r, task, current, wiki), versions.length ? 'WIKI_REPORT_MISMATCH' : 'WIKI_REPORT_MISSING', versions.length > 0);
    if (!wiki) return finish();
    const notices = r.messages.filter(m => m.sourceKind === 'wiki' && m.sourceId === wiki.id);
    out.counts.currentReportWikiNotices = notices.length;
    const notice = one(notices);
    check('wikiNotice', notice && notice.roomId === task.roomId && notice.authorId === current.authorId &&
      notice.visibility === 'room_public' && same(notice.wikiCitations, [citation(wiki)]),
      notices.length ? 'WIKI_NOTICE_MISMATCH' : 'WIKI_NOTICE_MISSING', notices.length > 0);
    if (link && out.checks.currentReportWiki) out.counts.subsequentAmbientCitations = r.turns.filter(turn => ambientCitation(r, task, turn, wiki, link)).length;
    check('subsequentAmbientCitation', out.counts.subsequentAmbientCitations > 0, 'SUBSEQUENT_AMBIENT_CITATION_MISSING');
  } catch { fail('MALFORMED_SNAPSHOT', true); }
  return finish();
}

function cliFailure(code) { const out = report(); out.status = 'invalid'; out.reasonCodes.push(code); return out; }

async function cli(args) {
  if (args.length !== 2 || !isAbsolute(args[0]) || !id(args[1])) return cliFailure('CLI_INVALID_ARGUMENTS');
  let file;
  try {
    const { open } = await import('node:fs/promises'); const { constants } = await import('node:fs');
    file = await open(args[0], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SNAPSHOT_BYTES) return cliFailure('CLI_SNAPSHOT_SIZE_OR_TYPE');
    const buffer = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break; length += bytesRead;
    }
    if (length > MAX_SNAPSHOT_BYTES) return cliFailure('CLI_SNAPSHOT_SIZE_OR_TYPE');
    let state;
    try { state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { return cliFailure('CLI_INVALID_JSON'); }
    return inspectWorkWikiCycle(state, args[1]);
  } catch { return cliFailure('CLI_SNAPSHOT_UNREADABLE'); }
  finally { if (file) await file.close().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = await cli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exitCode = out.status === 'records_consistent' ? 0 : out.status === 'incomplete' ? 1 : 2;
}
