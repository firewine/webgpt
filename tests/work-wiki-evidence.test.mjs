import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, truncate, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectWorkWikiCycle } from '../scripts/work-wiki-evidence.mjs';
import { digest } from '../dist/server/workspace/util.js';
import { wikiVersionDigest } from '../dist/server/workspace/wiki-policy.js';
import { acceptanceFixture } from './resident-acceptance-fixture.mjs';
import { workFixture } from './work-fixture.mjs';

const script = fileURLToPath(new URL('../scripts/work-wiki-evidence.mjs', import.meta.url));
const sentinel = 'PRIVATE_SENTINEL_title_body_label_email_key_token_provider@example.invalid';
const parts = s => {
  const r = s.resident; const task = r.workItems[0]; const current = task.reports.find(p => p.id === task.currentReportId);
  return { r, task, current, accepted: task.reviews.find(v => v.decision === 'accept'),
    workAttempt: r.workAttempts.find(a => a.id === current?.attemptId),
    reviewAttempt: r.workAttempts.find(a => a.purpose === 'review' && a.reportDigest === current?.digest),
    proposal: r.turns.find(t => t.proposalResults?.some(v => v.taskId === task.id && v.status === 'applied')),
    wiki: r.wikiVersions.find(v => v.editId === 'report:' + current?.id),
    next: r.turns.find(t => !t.workAttemptId && t.wikiCitations?.some(c => c.sourceRefs.some(ref => ref.id === current?.id))) };
};

function syncReply(turn) {
  const raw = JSON.parse(turn.text); raw.text = turn.reply.text; raw.proposals = turn.reply.proposals;
  turn.text = JSON.stringify(raw);
}

function rewritePrompt(d, turn, change) {
  const blocks = turn.prompt.split('\n\n'); const prefix = turn.workAttemptId ? '{"taskId":' : '{"roomId":';
  const index = blocks.findIndex(v => v.startsWith(prefix)); assert.ok(index >= 0);
  const data = JSON.parse(blocks[index]); change(data); blocks[index] = JSON.stringify(data);
  turn.prompt = blocks.join('\n\n'); turn.promptDigest = digest(turn.prompt);
  const attempt = d.r.workAttempts.find(a => a.providerTurnId === turn.id);
  if (attempt) attempt.providerPromptDigest = turn.promptDigest;
}

// Rebind the current report's saved consumers so artifact-check tampering is the only broken invariant.
function relinkCurrentReport(d) {
  const { r, task, current, accepted, workAttempt, reviewAttempt, wiki } = d;
  const work = r.turns.find(t => t.id === workAttempt.providerTurnId);
  const review = r.turns.find(t => t.id === reviewAttempt.providerTurnId);
  task.acceptance = structuredClone(current.acceptance);
  work.reply.text = current.text; syncReply(work);
  r.messages.find(m => m.id === work.messageId).text = `${workAttempt.input.title} · 산출물 보고\n${current.text}`;
  current.outputs[0].digest = digest(current.text);
  current.digest = digest(JSON.stringify({ ...current, digest: undefined }));
  accepted.reportDigest = current.digest; accepted.checks = structuredClone(current.checks);
  reviewAttempt.reportDigest = current.digest;
  review.reply.proposals.find(p => p.kind === 'work_review').payload.reportDigest = current.digest; syncReply(review);
  const body = JSON.parse(wiki.body);
  Object.assign(body, { reportDigest: current.digest, text: current.text, checks: current.checks, blockers: current.blockers });
  wiki.body = JSON.stringify(body); wiki.sourceRefs[0].digest = current.digest; wiki.digest = wikiVersionDigest(wiki);
  const ref = { pageId: wiki.pageId, version: wiki.version, digest: wiki.digest, scopeRef: wiki.scopeRef, sourceRefs: wiki.sourceRefs };
  const snapshot = { ...ref, title: wiki.title, body: wiki.body, epistemicStatus: wiki.epistemicStatus };
  const matches = c => c.pageId === wiki.pageId && c.version === wiki.version;
  for (const message of r.messages) if (message.wikiCitations) {
    message.wikiCitations = message.wikiCitations.map(c => matches(c) ? structuredClone(ref) : c);
  }
  for (const turn of r.turns) {
    if (turn !== work && turn !== review && !turn.wikiCitations?.some(matches)) continue;
    turn.wikiCitations = turn.wikiCitations.map(c => matches(c) ? structuredClone(snapshot) : c);
    const attempt = r.workAttempts.find(a => a.providerTurnId === turn.id);
    if (attempt) {
      attempt.input.acceptance = structuredClone(current.acceptance);
      attempt.input.wikiCitations = structuredClone(turn.wikiCitations);
      attempt.inputDigest = digest(JSON.stringify(attempt.input));
    }
    rewritePrompt(d, turn, data => {
      data.wiki = structuredClone(turn.wikiCitations);
      if (attempt) data.acceptance = structuredClone(attempt.input.acceptance);
      if (turn === review) data.report = structuredClone(current);
    });
  }
}

function redacted(out, secrets = []) {
  assert.equal(out.evidence, 'stored_snapshot_only'); assert.equal(out.modelCalls, 0);
  assert.equal(out.realModelAcceptance, 'UNVERIFIED_BY_AUDIT');
  assert.ok(Object.values(out.checks).every(v => typeof v === 'boolean'));
  assert.ok(Object.values(out.counts).every(v => Number.isSafeInteger(v) && v >= 0));
  assert.ok(out.reasonCodes.every(v => /^[A-Z][A-Z0-9_]+$/.test(v)));
  const printed = JSON.stringify(out);
  for (const secret of [sentinel, ...secrets]) assert.ok(!printed.includes(secret), 'report must not contain private source values');
}

function runCli(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr, '');
  const out = JSON.parse(result.stdout); redacted(out, args.filter(v => v.length > 8));
  return { code: result.status, out };
}

test('stored evidence: genuine unattended mock-model Store/Runner rework flow and copied corruptions', async t => {
  // acceptanceFixture is an offline, explicitly fake transport; this is never real-model acceptance.
  const f = await acceptanceFixture(t); const state = await f.runUnattended(); const p = parts(state);
  assert.equal(f.calls.length, 8); assert.equal(f.maximum(), 1); assert.equal(state.jobs.length, 0);
  assert.ok(state.resident.turns.every(turn => turn.participant.kind === 'fake'));
  assert.equal(p.task.reports.length, 2); assert.deepEqual(p.task.reviews.map(v => v.decision), ['rework', 'accept']);
  assert.equal(p.wiki.version, 2); assert.equal(p.current.id, p.task.reports[1].id);
  const before = JSON.stringify(state); const good = inspectWorkWikiCycle(state, p.task.id);
  assert.equal(good.status, 'records_consistent'); assert.deepEqual(good.reasonCodes, []);
  assert.ok(Object.values(good.checks).every(Boolean)); assert.equal(good.counts.currentReportWikiVersions, 1);
  assert.equal(good.counts.currentReportWikiNotices, 1); assert.equal(good.counts.subsequentAmbientCitations, 1);
  assert.equal(JSON.stringify(state), before, 'inspection must not mutate its input');
  redacted(good, [p.task.id, p.current.id, p.task.title, p.current.text, p.current.summary]);

  const mutations = [
    ['owner-created task', 'OWNER_CREATED_TASK', d => { d.task.proposedBy = 'owner'; }],
    ['proposal source absent', 'AMBIENT_PROPOSAL_MISSING', d => {
      d.r.turns = d.r.turns.filter(turn => !turn.reply?.proposals.some(v => v.kind === 'work_propose'));
    }],
    ['proposal points to another task', 'AMBIENT_PROPOSAL_MISSING', d => {
      d.r.turns.find(turn => turn.proposalResults?.some(v => v.taskId === d.task.id)).proposalResults[0].taskId = sentinel;
    }],
    ['successful proposal timestamps moved after latest ambient', 'AMBIENT_PROPOSAL_MISSING', d => {
      const latest = d.r.turns.filter(t => !t.workAttemptId).at(-1);
      const start = Date.parse(latest.finishedAt) + 1000;
      d.proposal.startedAt = new Date(start).toISOString(); d.proposal.finishedAt = new Date(start + 1).toISOString();
    }],
    ['successful proposal public message follows work report', 'AMBIENT_PROPOSAL_MISSING', d => {
      const reportMessage = d.r.messages.find(m => m.sourceKind === 'work' && m.sourceId === d.current.id);
      d.r.messages.find(m => m.id === d.proposal.messageId).sequence = reportMessage.sequence + 1;
    }],
    ['current report text changed', 'REPORT_CHAIN_MISMATCH', d => { d.current.text += sentinel; }],
    ['report digest changed', 'REPORT_CHAIN_MISMATCH', d => { d.current.digest = 'f'.repeat(64); }],
    ['rehashed report disagrees with original provider turn', 'REPORT_CHAIN_MISMATCH', d => {
      d.current.text += sentinel; d.current.outputs[0].digest = digest(d.current.text);
      d.current.digest = digest(JSON.stringify({ ...d.current, digest: undefined }));
    }],
    ['prior report original changed', 'REPORT_CHAIN_MISMATCH', d => { d.task.reports[0].summary += sentinel; }],
    ['prior report removed from rework chain', 'REPORT_CHAIN_MISMATCH', d => { d.task.reports.shift(); }],
    ['frozen work input changed', 'REPORT_CHAIN_MISMATCH', d => {
      d.r.workAttempts.find(a => a.id === d.current.attemptId).input.description += sentinel;
    }],
    ...['work', 'review'].map(purpose => [`rehashed ${purpose} prompt omits sourceMessages`,
      purpose === 'work' ? 'REPORT_CHAIN_MISMATCH' : 'REVIEW_CHAIN_MISMATCH', d => {
        const attempt = d[purpose + 'Attempt']; const turn = d.r.turns.find(t => t.id === attempt.providerTurnId);
        const frozen = JSON.stringify(attempt.input); const inputDigest = attempt.inputDigest;
        rewritePrompt(d, turn, data => { delete data.sourceMessages; });
        assert.equal(JSON.stringify(attempt.input), frozen); assert.equal(attempt.inputDigest, inputDigest);
        assert.equal(turn.promptDigest, digest(turn.prompt)); assert.equal(attempt.providerPromptDigest, turn.promptDigest);
      }]),
    ['report source message changed', 'REPORT_CHAIN_MISMATCH', d => { d.current.sourceMessageIds = [sentinel]; }],
    ['report turn chain broken', 'REPORT_CHAIN_MISMATCH', d => {
      d.r.workAttempts.find(a => a.id === d.current.attemptId).providerTurnId = sentinel;
    }],
    ...[
      ['done with current report blocker', p => { p.blockers.push(sentinel); }],
      ['done without current report outputs', p => { p.outputs = []; }],
      ['done without acceptance criteria or checks', p => { p.acceptance = []; p.checks = []; }],
      ['done with missing acceptance check', p => { p.checks.pop(); }],
      ['done with duplicate acceptance check', p => { p.checks.push({ ...p.checks[0] }); }],
      ['done with check for unknown acceptance', p => { p.checks[0].acceptanceId = sentinel; }],
      ['done with reported acceptance check', p => { p.checks[0].outcome = 'reported'; }],
      ['done with observed_fail acceptance check', p => { p.checks[0].outcome = 'observed_fail'; }],
      ['done with not_run acceptance check', p => { p.checks[0].outcome = 'not_run'; }],
    ].map(([name, mutate]) => [name, 'DONE_ACCEPTANCE_NOT_OBSERVED', d => {
      assert.equal(d.task.status, 'done');
      mutate(d.current);
      // Keep the edited report's own digest valid and require the done-specific reason.
      d.current.digest = digest(JSON.stringify({ ...d.current, digest: undefined }));
    }]),
    ['review references no report', 'REVIEW_REPORT_MISMATCH', d => { d.accepted.reportDigest = 'f'.repeat(64); }],
    ['reviewer differs from recorded review author', 'REVIEW_CHAIN_MISMATCH', d => { d.accepted.reviewerId = 'fake-c'; }],
    ['own review', 'REVIEW_NOT_INDEPENDENT', d => { d.accepted.reviewerId = d.current.authorId; }],
    ...[
      ['completed review payload includes work-only blockers', 'review', { blockers: [] }],
      ['completed review payload includes work-only summary', 'review', { summary: sentinel }],
      ['completed work report payload includes review-only decision', 'work', { decision: 'accept' }],
    ].map(([name, purpose, extra]) => [name, purpose === 'work' ? 'REPORT_CHAIN_MISMATCH' : 'REVIEW_CHAIN_MISMATCH', d => {
      const turn = d.r.turns.find(t => t.id === d[purpose + 'Attempt'].providerTurnId);
      const intent = turn.reply.proposals.find(p => p.kind === (purpose === 'work' ? 'work_report' : 'work_review'));
      Object.assign(intent.payload, structuredClone(extra)); syncReply(turn);
    }]),
    ['review proposal digest mismatch', 'REVIEW_CHAIN_MISMATCH', d => {
      const a = d.r.workAttempts.find(a => a.purpose === 'review' && a.reportDigest === d.current.digest);
      const turn = d.r.turns.find(turn => turn.id === a.providerTurnId);
      turn.reply.proposals[0].payload.reportDigest = 'f'.repeat(64);
      const raw = JSON.parse(turn.text); raw.proposals = turn.reply.proposals; turn.text = JSON.stringify(raw);
    }],
    ['Wiki body changed', 'WIKI_REPORT_MISMATCH', d => { d.wiki.body += sentinel; }],
    ['Wiki digest changed', 'WIKI_REPORT_MISMATCH', d => { d.wiki.digest = 'f'.repeat(64); }],
    ['rehashed Wiki has wrong report source', 'WIKI_REPORT_MISMATCH', d => {
      d.wiki.sourceRefs[0].digest = 'f'.repeat(64); d.wiki.digest = wikiVersionDigest(d.wiki);
    }],
    ['Wiki epistemic status upgraded', 'WIKI_REPORT_MISMATCH', d => { d.wiki.epistemicStatus = 'verified'; }],
    ['duplicate report Wiki version', 'WIKI_REPORT_MISMATCH', d => { d.r.wikiVersions.push({ ...d.wiki, id: d.wiki.id + '-duplicate' }); }],
    ['duplicate report Wiki notice', 'WIKI_NOTICE_MISMATCH', d => {
      const m = d.r.messages.find(m => m.sourceKind === 'wiki' && m.sourceId === d.wiki.id);
      d.r.messages.push({ ...m, id: m.id + '-duplicate' });
    }],
    ['notice has wrong citation', 'WIKI_NOTICE_MISMATCH', d => {
      d.r.messages.find(m => m.sourceKind === 'wiki' && m.sourceId === d.wiki.id).wikiCitations[0].digest = sentinel;
    }],
    ['unknown work schema', 'UNSUPPORTED_SCHEMA', d => { d.r.workSchemaVersion = 2; }],
    ['unknown report version', 'UNSUPPORTED_REPORT_REVIEW_RECORD', d => { d.current.version = 2; }],
  ];
  for (const [name, reason, mutate] of mutations) await t.test(name, () => {
    const copy = structuredClone(state); mutate(parts(copy)); const out = inspectWorkWikiCycle(copy, p.task.id);
    assert.equal(out.status, 'invalid'); assert.ok(out.reasonCodes.includes(reason), JSON.stringify(out)); redacted(out);
  });

  for (const [name, mutate] of [
    ['self-consistent observed_pass report lacks text_includes phrase', p => {
      p.text = p.text.replaceAll(p.acceptance[0].check.value, sentinel);
      assert.ok(!p.text.includes(p.acceptance[0].check.value));
    }],
    ['self-consistent observed_pass report has manual criterion', p => { p.acceptance[0].check = { kind: 'manual' }; }],
    ['self-consistent observed_pass report has execution criterion', p => { p.acceptance[0].check = { kind: 'execution' }; }],
    ['self-consistent observed_pass report has wrong evidenceRefs', p => { p.checks[0].evidenceRefs = ['turn:' + sentinel]; }],
  ]) await t.test(name, () => {
    const copy = structuredClone(state); const d = parts(copy); mutate(d.current); relinkCurrentReport(d);
    assert.ok(d.current.checks.every(c => c.outcome === 'observed_pass'));
    const out = inspectWorkWikiCycle(copy, p.task.id);
    assert.equal(out.status, 'invalid'); assert.deepEqual(out.reasonCodes, ['REPORT_CHAIN_MISMATCH']); redacted(out);
  });

  for (const [name, mutate] of [
    ['later ambient not completed', d => { d.next.status = 'failed'; }],
    ['later ambient predates review completion', d => { d.next.startedAt = '2000-01-01T00:00:00.000Z'; }],
    ['later ambient has no valid start time', d => { d.next.startedAt = null; }],
    ['input snapshot body absent', d => { delete d.next.wikiCitations[0].body; }],
    ['saved prompt body changed', d => { d.next.prompt += sentinel; }],
    ['message has different source references', d => {
      d.r.messages.find(m => m.id === d.next.messageId).wikiCitations[0].sourceRefs[0].digest = sentinel;
    }],
  ]) await t.test(name, () => {
    const copy = structuredClone(state); mutate(parts(copy)); const out = inspectWorkWikiCycle(copy, p.task.id);
    assert.equal(out.status, 'incomplete'); assert.equal(out.checks.subsequentAmbientCitation, false); redacted(out);
  });

  await t.test('same recorded connection still permits different participants to review', () => {
    const copy = structuredClone(state);
    for (const member of copy.participants) member.connectionId = sentinel;
    for (const turn of copy.resident.turns) turn.participant.connectionId = sentinel;
    const out = inspectWorkWikiCycle(copy, p.task.id); assert.equal(out.status, 'records_consistent'); redacted(out);
  });

  await t.test('private and malformed values never reach the redacted report', () => {
    const copy = structuredClone(state);
    copy.privateCredentials = { key: sentinel, token: sentinel, email: sentinel };
    copy.connections.push({ id: sentinel, label: sentinel, email: sentinel });
    copy.participants[0].label = sentinel;
    const out = inspectWorkWikiCycle(copy, p.task.id); assert.equal(out.status, 'records_consistent'); redacted(out);
    for (const bad of [null, [], sentinel, { error: sentinel }, { version: 2, resident: sentinel }]) {
      const result = inspectWorkWikiCycle(bad, sentinel); assert.equal(result.status, 'invalid'); redacted(result);
    }
  });

  await t.test('CLI reads only an explicit bounded regular JSON file and prints no private data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wj-evidence-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, sentinel + '.json'); const copy = structuredClone(state); copy.privateText = sentinel;
    await writeFile(path, JSON.stringify(copy));
    assert.equal(runCli([path, p.task.id]).code, 0);
    const absent = runCli([path, 'missing-task']); assert.equal(absent.code, 1); assert.equal(absent.out.status, 'incomplete');
    for (const args of [[], [path], [path, p.task.id, sentinel], ['relative.json', p.task.id]]) {
      const result = runCli(args); assert.equal(result.code, 2); assert.deepEqual(result.out.reasonCodes, ['CLI_INVALID_ARGUMENTS']);
    }
    const malformed = join(directory, 'malformed.json'); await writeFile(malformed, '{' + sentinel);
    assert.deepEqual(runCli([malformed, p.task.id]).out.reasonCodes, ['CLI_INVALID_JSON']);
    const oversized = join(directory, 'oversized.json'); await writeFile(oversized, ''); await truncate(oversized, 32 * 1024 * 1024 + 1);
    assert.deepEqual(runCli([oversized, p.task.id]).out.reasonCodes, ['CLI_SNAPSHOT_SIZE_OR_TYPE']);
    assert.deepEqual(runCli([directory, p.task.id]).out.reasonCodes, ['CLI_SNAPSHOT_SIZE_OR_TYPE']);
    const link = join(directory, 'symlink.json'); await symlink(path, link);
    assert.deepEqual(runCli([link, p.task.id]).out.reasonCodes, ['CLI_SNAPSHOT_UNREADABLE']);
    assert.deepEqual(runCli([join(directory, sentinel), p.task.id]).out.reasonCodes, ['CLI_SNAPSHOT_UNREADABLE']);
    assert.equal(JSON.stringify(copy), await readFile(path, 'utf8'), 'CLI must not write the snapshot');
  });

  await t.test('import needs no app build, filesystem API, or network API', () => {
    const code = String.raw`
      import { registerHooks } from 'node:module';
      const target = ${JSON.stringify(new URL('../scripts/work-wiki-evidence.mjs', import.meta.url).href)};
      registerHooks({ resolve(specifier, context, next) {
        if (/^(?:node:)?(?:fs(?:\/promises)?|https?|net|tls|dns|dgram)$/.test(specifier)) throw new Error('unexpected_io_import');
        if (!specifier.startsWith('node:') && specifier !== target) throw new Error('unexpected_app_import');
        return next(specifier, context);
      } });
      globalThis.fetch = () => { throw new Error('unexpected_network'); };
      const module = await import(target);
      if (typeof module.inspectWorkWikiCycle !== 'function') throw new Error('missing_export');
      process.stdout.write('imported');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, 'imported'); assert.equal(child.stderr, '');
  });
});

test('stored evidence: real intermediate mock-model stages remain incomplete; only review/unrelated Wiki is insufficient', async t => {
  const f = await acceptanceFixture(t); f.control({ action: 'on' });
  const initial = inspectWorkWikiCycle(f.app.store.read(), 'not-created'); assert.equal(initial.status, 'incomplete');
  let taskId;
  for (let stage = 1; stage <= 7; stage++) {
    await f.step(); const state = f.app.store.read(); taskId = state.resident.workItems[0]?.id;
    if (!taskId) continue;
    const out = inspectWorkWikiCycle(state, taskId); assert.equal(out.status, 'incomplete', JSON.stringify(out)); redacted(out);
    if (stage < 7) assert.equal(out.checks.taskDone, false);
    if (stage === 7) {
      assert.equal(out.checks.acceptedIndependentReview, true); assert.equal(out.checks.currentReportWiki, true);
      assert.equal(out.checks.subsequentAmbientCitation, false);
      const d = parts(state); const reviewTurn = d.r.turns.at(-1);
      assert.equal(reviewTurn.wikiCitations[0].digest, d.wiki.digest, 'review really read the Wiki, but is not the next ambient say');
      delete reviewTurn.workAttemptId;
      assert.equal(inspectWorkWikiCycle(state, taskId).checks.subsequentAmbientCitation, false);
    }
  }
  const unrelated = f.app.wiki.edit(f.roomId, { slug: 'unrelated-evidence', title: 'Unrelated offline fixture', body: sentinel,
    scopeRef: 'room:' + f.roomId, expectedVersion: 0, sourceRefs: [{ kind: 'message', id: f.sourceId }] }, crypto.randomUUID());
  f.app.wiki.pin(f.roomId, { expectedVersion: f.room().version, pins: [{ pageId: unrelated.pageId, version: 1 }] }, crypto.randomUUID());
  await f.step();
  const unrelatedOnly = inspectWorkWikiCycle(f.app.store.read(), taskId);
  assert.equal(unrelatedOnly.status, 'incomplete'); assert.equal(unrelatedOnly.checks.subsequentAmbientCitation, false); redacted(unrelatedOnly);
  f.app.wiki.pin(f.roomId, { expectedVersion: f.room().version, automatic: true }, crypto.randomUUID());
  await f.step(); assert.equal(inspectWorkWikiCycle(f.app.store.read(), taskId).status, 'records_consistent');
});

test('stored evidence: actual owner-created workFixture flow never passes as an AI proposal', async t => {
  const f = await workFixture(t); const taskId = f.propose(); await f.step(); await f.step(); await f.step();
  assert.equal(f.task(taskId).status, 'done');
  const out = inspectWorkWikiCycle(f.app.store.read(), taskId);
  assert.equal(out.status, 'invalid'); assert.ok(out.reasonCodes.includes('OWNER_CREATED_TASK')); redacted(out);
});
