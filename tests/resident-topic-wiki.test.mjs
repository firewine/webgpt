import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Wiki } from '../dist/server/workspace/wiki.js';
import { contextWiki, WIKI_LIMITS } from '../dist/server/workspace/wiki-policy.js';
import { prepareTopicWiki, publishTopicWiki } from '../dist/server/workspace/topic-wiki.js';
import { roomContext } from '../dist/server/workspace/resident-context.js';
import { wikiFixture } from './wiki-fixture.mjs';
import { reply } from './resident-fixture.mjs';
import { response, topic, until } from './workspace-helpers.mjs';
import { dotFixture } from './dot-mcp-fixture.mjs';
import { topicPolicy } from '../dist/server/workspace/resident-focus.js';

const key = () => crypto.randomUUID();
const live = t => ['prepared', 'running', 'unconfirmed'].includes(t.status);
const terminal = d => ['completed', 'partial', 'cancelled'].includes(d.status) && !d.turns.some(live);
const hash = text => createHash('sha256').update(text).digest('hex');

async function topicWikiFixture(t, options = {}) {
  const ambientInputs = [], topicInputs = [], paused = new Set(), excluded = new Set();
  const f = await wikiFixture(t, { on: false, maxRequests: 200, provider: { complete: async input => {
    assert.equal(input.participant.kind, 'fake');
    ambientInputs.push(input.prompt); input.hooks.dispatched();
    return { text: reply({ text: 'Fixture ambient reply; no provider or account verification.' }), receipt: 'fixture-ambient-' + ambientInputs.length, usage: { input: 1, output: 1 } };
  } } });
  const participantIds = options.participantIds ?? topic.participantIds;
  for (const participantId of participantIds.filter(pid => !topic.participantIds.includes(pid))) {
    f.app.store.transact(s => { s.participants.push({ ...s.participants[0], id: participantId, label: participantId }); });
    f.control({ action: 'set_member', participantId, enabled: true });
    f.q.seat(f.roomId, { participantId, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, key());
  }
  // Replace only fixture completions. Both the topic engine and room runner
  // still reserve, dispatch, parse, settle and project their real durable turns.
  f.app.providers.complete = async input => {
    assert.equal(input.participant.kind, 'fake');
    assert.ok(participantIds.includes(input.participant.id));
    topicInputs.push(input.prompt); input.hooks.dispatched();
    const phase = input.prompt.match(/ · (\w+) ·/)[1];
    const body = JSON.parse(response(input.prompt, input.participant, { verify: options.verify ?? 'review' }));
    body.text = `PUBLIC_${phase}_${input.participant.id}_BEGIN ${options.longText && phase === 'synthesis' ? options.longText : 'fixture outcome'} PUBLIC_END`;
    body.claims = [{ text: `CLAIM_${phase}_${input.participant.id}`, assumptions: ['ASSUMPTION_REQUIRES_CHECK'] }];
    body.uncertainty = ['UNCERTAINTY_REMAINS_UNVERIFIED'];
    if (options.transformReply) options.transformReply(body, phase, input);
    if (options.partialWithSynthesis && phase === 'summary_review' && !excluded.has(phase)) {
      excluded.add(phase);
      const d = f.app.store.read().discussions.find(d => d.turns.some(t => t.id === input.requestId));
      f.app.engine.control(d.id, { action: 'exclude', expectedRevision: d.revision, participantId: participantIds.find(pid => pid !== input.participant.id) }, key());
    }
    if (options.pauseBeforeFinish && phase === 'summary_review') {
      const d = f.app.store.read().discussions.find(d => d.turns.some(t => t.id === input.requestId));
      if (!paused.has(d.revision)) {
        paused.add(d.revision);
        f.app.engine.control(d.id, { action: 'pause', expectedRevision: d.revision }, key());
      }
    }
    const text = JSON.stringify(body); input.hooks.delta(text);
    return { text, receipt: 'fixture-topic-' + topicInputs.length, usage: options.usage ?? { input: 1, output: 1 } };
  };
  if (options.stopAfterPhase) {
    let stopped = false;
    const unsubscribe = f.app.store.subscribe(event => {
      if (stopped || event.type !== 'turn.finished') return;
      const d = f.app.store.read().discussions.find(d => d.id === event.discussionId);
      if (d.phase !== options.stopAfterPhase || d.tasks.some(t => ['pending', 'running', 'unconfirmed'].includes(t.status)) || d.turns.some(live)) return;
      stopped = true;
      for (const participantId of participantIds) f.app.engine.control(d.id, { action: 'exclude', expectedRevision: d.revision, participantId }, key());
    });
    t.after(unsubscribe);
  }
  f.control({ action: 'on' });
  return { ...f, ambientInputs, topicInputs,
    discussion: id => f.app.store.read().discussions.find(d => d.id === id),
    start: (input = {}, linked = true) => {
      const value = { ...topic, participantIds, limits: { maxRequests: 100, maxRounds: 1, maxVerificationTasks: 2, maxToolJobs: 0, ...options.limits }, ...input };
      return linked ? f.app.residentRunner.focus(f.roomId, value, key()) : f.app.engine.create(value, key());
    } };
}

async function finished(f, id) {
  return until(() => { const d = f.discussion(id); return terminal(d) && d; }, 10000);
}

// Pause through the public engine control so all accepted groups can be
// projected before exercising a publication boundary. Resuming needs no reply.
async function projectedTopic(t, options = {}) {
  const f = await topicWikiFixture(t, { ...options, pauseBeforeFinish: true });
  const id = f.start();
  await until(() => { const d = f.discussion(id); return d.status === 'paused' && !d.turns.some(live); }, 10000);
  await f.step();
  assert.ok(f.app.store.read().resident.messages.some(m => m.sourceKind === 'topic'));
  assert.equal(f.discussion(id).wikiPublication.status, 'pending');
  if (options.beforeResume) f.app.store.transact(s => options.beforeResume(s, s.resident.rooms.find(r => r.id === f.roomId), s.discussions.find(d => d.id === id)));
  f.app.engine.control(id, { action: 'resume', expectedRevision: f.discussion(id).revision }, key());
  await finished(f, id);
  return { ...f, id };
}

function replay(f, id, wiki = f.w) {
  f.app.store.transact((s, emit) => publishTopicWiki(s, s.resident.rooms.find(r => r.id === f.roomId), s.discussions.find(d => d.id === id), wiki, emit));
}

function assertNoPublication(f) {
  const s = f.app.store.read();
  assert.equal(s.resident.wikiPages.length, 0);
  assert.equal(s.resident.wikiVersions.length, 0);
  assert.equal(s.resident.messages.filter(m => m.sourceKind === 'wiki').length, 0);
}

function wikiState(f, id) {
  const s = f.app.store.read();
  return { publication: s.discussions.find(d => d.id === id).wikiPublication, pages: s.resident.wikiPages, versions: s.resident.wikiVersions,
    notices: s.resident.messages.filter(m => m.sourceKind === 'wiki') };
}

test('topic Wiki: actual engine completion publishes once, and the next two ambient turns cite the exact automatic snapshot', async t => {
  const longText = 'FULL_OUTCOME_BEGIN_' + 'x'.repeat(8000) + '_FULL_OUTCOME_END';
  const f = await topicWikiFixture(t, { longText, transformReply: (body, phase, input) => {
    if (!['synthesis', 'summary_review'].includes(phase)) return;
    const claimId = JSON.parse(input.prompt.split('\n\n').find(p => p.startsWith('{"topic":'))).claims[0].id;
    body.reviews = [{ claimId, stance: 'challenge', reason: 'CLOSING_REVIEW_RETAINS_DISAGREEMENT' }];
    body.verifications = [{ claimId, method: 'review', url: '', question: 'CLOSING_VERIFICATION_REMAINS_A_PROPOSAL' }];
  } }); const id = f.start();
  const prepared = f.discussion(id).wikiPublication;
  assert.equal(prepared.status, 'pending'); assert.equal(prepared.revision, 1);
  assert.equal(prepared.roomEpoch, f.room().epoch); assert.match(prepared.scopeDigest, /^[a-f0-9]{64}$/);
  assert.equal(prepared.pageId, null); assert.equal(prepared.reason, null);
  const d = await finished(f, id); assert.equal(d.status, 'completed');
  const calls = f.topicInputs.length; assert.equal(calls, d.turns.length);
  await f.step();
  const s = f.app.store.read(), p = f.discussion(id).wikiPublication;
  assert.equal(s.resident.wikiPages.length, 1); assert.equal(s.resident.wikiVersions.length, 1);
  assert.equal(p.status, 'published'); assert.equal(f.room().topicLink, null);
  const v = f.w.get(f.roomId, p.pageId, p.version).version;
  assert.equal(v.authoredBy, 'system'); assert.equal(v.scopeRef, 'room:' + f.roomId);
  assert.equal(v.editId, `topic:${id}:1`); assert.equal(v.epistemicStatus, 'reported');
  assert.equal(p.digest, v.digest); assert.equal(p.inputDigest, v.inputDigest);
  const publicTurns = s.resident.messages.filter(m => m.sourceKind === 'topic');
  const outcome = JSON.parse(v.body);
  const closing = publicTurns.filter(m => ['synthesis', 'summary_review'].includes(d.turns.find(t => t.id === m.sourceId).phase));
  assert.deepEqual(new Set(v.sourceRefs.map(ref => ref.id)), new Set(closing.map(m => m.id)));
  for (const ref of v.sourceRefs) {
    const m = publicTurns.find(m => m.id === ref.id);
    assert.equal(ref.kind, 'message'); assert.equal(ref.status, 'reported'); assert.equal(ref.digest, hash(m.text));
    assert.equal(m.visibility, 'room_public'); assert.equal(m.roomId, f.roomId);
    const turn = d.turns.find(t => t.id === m.sourceId);
    assert.ok(v.body.includes(turn.reply.text));
    const archived = outcome.results.find(result => result.turnId === turn.id);
    for (const field of ['text', 'claims', 'reviews', 'verifications', 'uncertainty']) assert.deepEqual(archived[field], turn.reply[field]);
    for (const c of turn.reply.claims) assert.ok(v.body.includes(c.text));
    for (const u of turn.reply.uncertainty) assert.ok(v.body.includes(u));
  }
  for (const m of publicTurns) { assert.ok(v.body.includes(m.id)); assert.ok(v.body.includes(hash(m.text))); }
  assert.ok(v.body.includes(longText)); assert.equal(outcome.conclusionAvailable, true);
  const notice = s.resident.messages.filter(m => m.sourceKind === 'wiki');
  assert.equal(notice.length, 1); assert.equal(notice[0].sourceId, v.id);
  assert.equal(notice[0].authorId, 'system'); assert.equal(notice[0].visibility, 'room_public');
  assert.equal(f.room().wikiPins, undefined);
  const snapshot = contextWiki(s, f.room()); assert.equal(snapshot.length, 1); assert.equal(snapshot[0].body, v.body);
  await f.step(); await f.step();
  const turns = f.app.store.read().resident.turns;
  assert.equal(turns.length, 2); assert.equal(f.ambientInputs.length, 2);
  assert.deepEqual(new Set(turns.map(t => t.participantId)), new Set(['fake-a', 'fake-b']));
  for (const turn of turns) {
    assert.deepEqual(turn.wikiCitations, snapshot); assert.ok(turn.prompt.includes(v.digest));
    const input = JSON.parse(turn.prompt.split('\n\n').find(p => p.startsWith('{"roomId":')));
    assert.deepEqual(input.wiki, snapshot);
    const message = f.app.store.read().resident.messages.find(m => m.sourceKind === 'room' && m.sourceId === turn.id);
    assert.deepEqual(message.wikiCitations, snapshot.map(({ body, title, epistemicStatus, ...ref }) => ref));
  }
  const stable = wikiState(f, id);
  for (let n = 0; n < 20; n++) { replay(f, id); await f.app.residentRunner.tick(); }
  assert.deepEqual(wikiState(f, id), stable); assert.equal(f.topicInputs.length, calls);
  assert.equal(f.app.store.events(0, 5000).filter(e => e.type === 'resident.focus_returned' && e.data.discussionId === id).length, 1);
  assert.equal(f.app.store.events(0, 5000).filter(e => e.type === 'resident.wiki_edited' && e.data.versionId === v.id).length, 1);
});

test('topic Wiki: an owner correction survives twenty terminal replays without changing the topic version or earlier citations', async t => {
  const f = await topicWikiFixture(t); const id = f.start(); await finished(f, id); await f.step(); await f.step();
  const original = wikiState(f, id), oldTurn = structuredClone(f.app.store.read().resident.turns[0]);
  const p = original.publication;
  const updated = f.w.edit(f.roomId, f.edit({ pageId: p.pageId, expectedVersion: p.version, body: 'OWNER_CORRECTION_FULL_ORIGINAL' }), key());
  const corrected = wikiState(f, id), calls = f.topicInputs.length;
  for (let n = 0; n < 20; n++) { replay(f, id); await f.app.residentRunner.tick(); }
  assert.deepEqual(wikiState(f, id), corrected); assert.equal(f.topicInputs.length, calls);
  assert.equal(f.w.get(f.roomId, p.pageId).version.body, 'OWNER_CORRECTION_FULL_ORIGINAL');
  assert.deepEqual(f.w.get(f.roomId, p.pageId, p.version).version, original.versions[0]);
  assert.deepEqual(f.app.store.read().resident.turns.find(t => t.id === oldTurn.id), oldTurn);
  assert.equal(contextWiki(f.app.store.read(), f.room())[0].digest, updated.digest);
  assert.equal(corrected.versions.filter(v => v.editId === `topic:${id}:1`).length, 1);
});

test('topic Wiki: five participants archive their full closing outcome using five sources, with all earlier public turns indexed', async t => {
  const f = await topicWikiFixture(t, { participantIds: ['fake-a', 'fake-b', 'fake-c', 'fake-d', 'fake-e'], limits: { maxRounds: 2, maxVerificationTasks: 0 } });
  const id = f.start(); const d = await finished(f, id); assert.equal(d.status, 'completed'); await f.step();
  const s = f.app.store.read(), v = s.resident.wikiVersions[0];
  assert.equal(d.turns.length, 25); assert.equal(s.resident.wikiVersions.length, 1);
  assert.equal(f.discussion(id).wikiPublication.status, 'published'); assert.equal(v.sourceRefs.length, 5);
  for (const ref of v.sourceRefs) {
    const message = s.resident.messages.find(m => m.id === ref.id), turn = d.turns.find(t => t.id === message.sourceId);
    assert.ok(['synthesis', 'summary_review'].includes(turn.phase)); assert.ok(v.body.includes(turn.reply.text));
  }
  for (const m of s.resident.messages.filter(m => m.sourceKind === 'topic')) assert.ok(v.body.includes(m.id));
  assert.equal(f.topicInputs.length, d.turns.length);
});

test('topic Wiki: partial observations retain uncertainty and actual not-run evidence status without private material text', async t => {
  const secret = 'PRIVATE_MATERIAL_MUST_NEVER_ENTER_WIKI';
  const f = await topicWikiFixture(t, { verify: 'source', partialWithSynthesis: true, transformReply: body => { body.text += ' MODEL_SAYS_VERIFIED'; } });
  const id = f.start({ materials: secret }); const d = await finished(f, id);
  assert.equal(d.status, 'partial'); assert.ok(d.evidence.some(e => e.status === 'not_run'));
  // Only evidence explicitly attached to a publicly released turn may enter Wiki.
  f.app.store.transact(s => { const current = s.discussions.find(v => v.id === id), turn = current.turns.find(t => t.phase === 'synthesis');
    const e = { ...current.evidence.find(e => e.status === 'not_run'), id: 'public-not-run', taskId: turn.taskId };
    current.evidence.push(e); turn.evidenceIds.push(e.id);
  });
  await f.step(); const v = f.app.store.read().resident.wikiVersions[0];
  assert.equal(f.discussion(id).wikiPublication.status, 'published'); assert.equal(v.epistemicStatus, 'reported');
  assert.ok(v.body.includes('partial')); assert.ok(v.body.includes('UNCERTAINTY_REMAINS_UNVERIFIED'));
  assert.ok(v.body.includes('not_run')); assert.ok(v.body.includes('MODEL_SAYS_VERIFIED')); assert.ok(!v.body.includes(secret));
  const body = JSON.parse(v.body);
  const visibleEvidence = new Set(body.publicHistory.flatMap(h => d.turns.find(t => t.id === h.turnId).evidenceIds));
  for (const evidence of d.evidence.filter(e => e.status === 'not_run')) {
    assert.equal(body.evidence.some(e => e.id === evidence.id), visibleEvidence.has(evidence.id));
    assert.ok(!v.body.includes(evidence.source));
  }
  assert.equal(body.evidence.find(e => e.id === 'public-not-run').status, 'not_run');
  assert.ok(v.sourceRefs.every(ref => ref.status === 'reported'));
  assert.equal(f.app.store.read().jobs.length, 0);
});

test('topic Wiki: canonical last verification turn is archived while earlier or unreleased evidence stays outside public memory', async t => {
  const f = await topicWikiFixture(t, { transformReply: (body, phase, input) => {
    if (phase === 'cross_review') body.verifications = input.participant.id === 'fake-a' ? ['first check', 'second check'].map(question => ({ claimId: body.reviews[0].claimId, method: 'review', url: '', question })) : [];
  } });
  const id = f.start(); const d = await finished(f, id); await f.step();
  const checks = d.turns.filter(t => t.phase === 'verification'); assert.equal(checks.length, 2); assert.equal(checks[0].participantId, checks[1].participantId);
  const v = f.app.store.read().resident.wikiVersions[0], body = JSON.parse(v.body);
  assert.equal(f.discussion(id).wikiPublication.status, 'published');
  assert.equal(body.publicHistory.some(h => h.turnId === checks[0].id), false); assert.equal(body.publicHistory.some(h => h.turnId === checks[1].id), true);
  const visibleEvidence = new Set(body.publicHistory.flatMap(h => d.turns.find(t => t.id === h.turnId).evidenceIds));
  for (const e of body.evidence) assert.equal(visibleEvidence.has(e.id), true);
  for (const eid of checks[1].evidenceIds) assert.equal(body.evidence.some(e => e.id === eid), true);
  const g = await projectedTopic(t); const original = g.discussion(g.id);
  g.app.store.transact(s => { const current = s.discussions.find(v => v.id === g.id), checks = current.turns.filter(t => t.phase === 'verification');
    checks[0].status = 'failed'; current.status = 'partial'; current.phase = 'verification'; current.tasks.find(t => t.id === checks[0].taskId).status = 'cancelled';
    const later = new Set(current.turns.filter(t => ['revision', 'synthesis', 'summary_review'].includes(t.phase)).map(t => t.id));
    const ids = new Set([...checks.map(t => t.id), ...later]); s.resident.messages = s.resident.messages.filter(m => !ids.has(m.sourceId));
    current.turns = current.turns.filter(t => !later.has(t.id)); current.tasks = current.tasks.filter(t => !['revision', 'synthesis', 'summary_review'].includes(t.phase));
    const old = { ...current.evidence[0], id: 'old-private-evidence', revision: current.revision - 1 }; current.evidence.push(old);
    current.turns.find(t => t.phase === 'cross_review').evidenceIds.push(old.id);
  });
  replay(g, g.id); const archived = JSON.parse(g.app.store.read().resident.wikiVersions[0].body);
  assert.equal(g.discussion(g.id).wikiPublication.status, 'published');
  for (const turn of original.turns.filter(t => t.phase === 'verification')) for (const eid of turn.evidenceIds) assert.equal(archived.evidence.some(e => e.id === eid), false);
  assert.equal(archived.evidence.some(e => e.id === 'old-private-evidence'), false);
});

test('topic Wiki: revoking and replacing native authority cannot revive the original terminal publication', async t => {
  const f = await dotFixture(t); f.control({ action: 'set_member', participantId: 'fake-a', enabled: true });
  const complete = f.app.providers.complete.bind(f.app.providers);
  f.app.providers.complete = async input => { if (input.participant.kind === 'dot-mcp') return complete(input);
    input.hooks.dispatched(); const body = JSON.parse(response(input.prompt, input.participant)); body.verifications = [];
    return { text: JSON.stringify(body), receipt: key(), usage: null };
  };
  const id = f.app.residentRunner.focus(f.roomId, { ...topic, participantIds: ['fake-a', f.participantId], limits: { maxRequests: 40, maxRounds: 1, maxVerificationTasks: 0 } }, key());
  await until(() => f.state().discussions.find(d => d.id === id)?.status === 'completed');
  const policy = topicPolicy(f.state(), f.room()), version = f.state().dotMcp.bindings[0].version;
  f.app.dotMcp.revoke(f.connectionId, version, key());
  const current = f.state().dotMcp.bindings[0];
  const access = f.app.dotMcp.confirm({ connectionId: f.connectionId, expectedVersion: current.version, ownerConfirmed: true, tools: [...f.grant.tools], expiresAt: new Date(Date.now() + 86400000).toISOString() }, key());
  const grant = f.app.dotMcp.authenticate(access.token); await f.app.mcpEvents.handle('events/subscribe', f.params, grant);
  assert.notEqual(grant.id, f.grant.id); assert.equal(topicPolicy(f.state(), f.room()), policy);
  await f.step(); const state = f.state(), d = state.discussions.find(v => v.id === id);
  assert.equal(d.wikiPublication.status, 'skipped'); assert.equal(d.wikiPublication.reason, 'topic_wiki_scope_changed');
  assert.equal(state.resident.wikiVersions.length, 0);
});

test('topic Wiki: unavailable participants leave partial observations without an invented synthesis', async t => {
  const f = await topicWikiFixture(t, { stopAfterPhase: 'independent' });
  const id = f.start(); const d = await finished(f, id);
  assert.equal(d.status, 'partial'); assert.ok(!d.turns.some(t => t.phase === 'synthesis'));
  await f.step(); const s = f.app.store.read(), v = s.resident.wikiVersions[0];
  assert.equal(f.discussion(id).wikiPublication.status, 'published'); assert.ok(v.body.includes('partial'));
  assert.equal(JSON.parse(v.body).conclusionAvailable, false);
  assert.equal(v.sourceRefs.length, 2); assert.ok(!v.body.includes('PUBLIC_synthesis_'));
  for (const ref of v.sourceRefs) {
    const message = s.resident.messages.find(m => m.id === ref.id), turn = d.turns.find(t => t.id === message.sourceId);
    assert.equal(turn.phase, 'independent'); assert.ok(v.body.includes(turn.reply.text));
    assert.ok(v.body.includes(turn.reply.uncertainty[0]));
  }
});

for (const [name, mutate] of [
  ['room off', (s, r) => { r.desiredOn = false; }],
  ['old room epoch', (s, r) => { r.epoch++; }],
  ['revoked member', (s, r) => { r.members[0].enabled = false; }],
  ['changed seat policy', (s, r) => { r.seats[0].version++; }],
  ['old room generation', (s, r) => { roomContext(r, 'fake-a').generation++; }],
  ['old discussion generation', (s, r, d) => { d.contexts[0].generation++; }],
  ['old revision', (s, r, d) => { d.revision++; }],
  ['missing discussion room', (s, r, d) => { delete d.roomId; }],
  ['foreign discussion room', (s, r, d) => { d.roomId = 'foreign-room'; }],
  ['different linked topic', (s, r) => { r.topicLink = 'another-topic'; }],
  ['private closing source', (s, r, d) => { const ids = new Set(d.turns.filter(t => t.phase === 'summary_review').map(t => t.id)); for (const m of s.resident.messages) if (ids.has(m.sourceId)) m.visibility = 'topic_round'; }],
  ['foreign closing source', (s, r, d) => { const ids = new Set(d.turns.filter(t => t.phase === 'summary_review').map(t => t.id)); for (const m of s.resident.messages) if (ids.has(m.sourceId)) m.roomId = 'foreign-room'; }],
]) test('topic Wiki refuses ' + name + ' and never retries the denied publication', async t => {
  const f = await projectedTopic(t); const calls = f.topicInputs.length;
  const before = f.app.store.read();
  f.app.store.transact(s => mutate(s, s.resident.rooms.find(r => r.id === f.roomId), s.discussions.find(d => d.id === f.id)));
  replay(f, f.id); assertNoPublication(f);
  const publication = f.discussion(f.id).wikiPublication;
  assert.ok(['blocked', 'skipped'].includes(publication.status)); assert.ok(publication.reason);
  f.app.store.transact(s => {
    s.resident.rooms = before.resident.rooms; s.resident.messages = before.resident.messages;
    s.discussions = before.discussions; s.discussions.find(d => d.id === f.id).wikiPublication = publication;
  });
  for (let n = 0; n < 20; n++) replay(f, f.id);
  assertNoPublication(f); assert.deepEqual(f.discussion(f.id).wikiPublication, publication); assert.equal(f.topicInputs.length, calls);
});

test('topic Wiki: disabled Wiki, cancelled topics and nonterminal pending topics create no shared memory', async t => {
  const f = await projectedTopic(t); replay(f, f.id, new Wiki(f.app.store, false));
  assertNoPublication(f); assert.ok(['blocked', 'skipped'].includes(f.discussion(f.id).wikiPublication.status));
  const g = await topicWikiFixture(t); g.app.engine.kick = () => {}; const id = g.start();
  const pending = g.discussion(id).wikiPublication;
  for (let n = 0; n < 20; n++) replay(g, id);
  assert.deepEqual(g.discussion(id).wikiPublication, pending); assertNoPublication(g);
  g.app.engine.control(id, { action: 'cancel', expectedRevision: 1 }, key());
  await g.step(); assert.equal(g.discussion(id).wikiPublication.status, 'skipped'); assertNoPublication(g);
});

test('topic Wiki: standalone and legacy discussions stay without metadata, including after explicit revision', async t => {
  const f = await topicWikiFixture(t); f.app.engine.kick = () => {}; const id = f.start({}, false);
  assert.equal(f.discussion(id).wikiPublication, undefined);
  f.app.engine.control(id, { action: 'revise', expectedRevision: 1, text: 'Legacy topic revision' }, key());
  assert.equal(f.discussion(id).wikiPublication, undefined);
  f.app.store.transact((s, emit) => publishTopicWiki(s, s.resident.rooms[0], s.discussions[0], f.w, emit)); assertNoPublication(f);
  const g = await projectedTopic(t); g.app.store.transact(s => { delete s.discussions[0].wikiPublication; });
  for (let n = 0; n < 20; n++) { replay(g, g.id); await g.app.residentRunner.tick(); }
  assert.equal(g.discussion(g.id).wikiPublication, undefined); assertNoPublication(g);
  const h = await topicWikiFixture(t); h.app.engine.kick = () => {}; const linkedId = h.start();
  h.app.store.transact(s => { delete s.discussions.find(d => d.id === linkedId).wikiPublication; });
  h.app.engine.control(linkedId, { action: 'revise', expectedRevision: 1, text: 'A legacy room-linked topic still requires its original opt-in' }, key());
  assert.equal(h.discussion(linkedId).wikiPublication, undefined);
  h.app.engine.control(linkedId, { action: 'cancel', expectedRevision: 2 }, key()); await h.step(); assertNoPublication(h);
});

test('topic Wiki: explicit revision refreshes an opted-in pending scope and only the current revision is published', async t => {
  const f = await topicWikiFixture(t); const kick = f.app.engine.kick.bind(f.app.engine); f.app.engine.kick = () => {};
  const id = f.start(); const first = f.discussion(id).wikiPublication;
  f.app.engine.control(id, { action: 'revise', expectedRevision: 1, text: 'Only the revised topic is authorized' }, key());
  const second = f.discussion(id).wikiPublication;
  assert.equal(second.status, 'pending'); assert.equal(second.revision, 2); assert.equal(second.roomEpoch, f.room().epoch);
  assert.equal(first.revision, 1); f.app.engine.kick = kick; kick(); await finished(f, id); await f.step();
  const versions = f.app.store.read().resident.wikiVersions;
  assert.equal(versions.length, 1); assert.equal(versions[0].editId, `topic:${id}:2`);
  assert.equal(f.discussion(id).wikiPublication.revision, 2);
});

for (const kind of ['turn', 'job']) test('topic Wiki: a terminal topic waits for the original live ' + kind + ' before publishing', async t => {
  const f = await projectedTopic(t); const original = f.discussion(f.id);
  f.app.store.transact(s => {
    const d = s.discussions.find(d => d.id === f.id);
    if (kind === 'turn') d.turns.push({ ...d.turns.at(-1), id: 'held-original-turn', status: 'unconfirmed' });
    else s.jobs.push({ id: 'held-original-job', discussionId: d.id, status: 'reconciling' });
  });
  for (let n = 0; n < 20; n++) await f.app.residentRunner.tick();
  assertNoPublication(f);
  assert.equal(f.discussion(f.id).wikiPublication.status, 'pending'); assert.equal(f.room().topicLink, f.id);
  f.app.store.transact(s => {
    if (kind === 'turn') s.discussions.find(d => d.id === f.id).turns.find(t => t.id === 'held-original-turn').status = 'stale';
    else s.jobs.find(j => j.id === 'held-original-job').status = 'completed';
  });
  await f.step(); assert.equal(f.discussion(f.id).wikiPublication.status, 'published');
  assert.equal(f.app.store.read().resident.wikiVersions.length, 1); assert.equal(f.room().topicLink, null);
  assert.deepEqual(f.discussion(f.id).turns.slice(0, original.turns.length), original.turns);
});

test('topic Wiki: an outcome above 20000 characters is blocked in full, never excerpted or retried', async t => {
  const text = 'LONG_OUTCOME_BEGIN_' + 'x'.repeat(WIKI_LIMITS.body) + '_LONG_OUTCOME_END';
  const f = await topicWikiFixture(t, { longText: text }); const id = f.start(); await finished(f, id); const calls = f.topicInputs.length;
  await f.step(); assertNoPublication(f); const p = f.discussion(id).wikiPublication;
  assert.equal(p.status, 'blocked'); assert.ok(p.reason);
  const turn = f.discussion(id).turns.find(t => t.phase === 'synthesis'); assert.ok(turn.reply.text.includes(text));
  assert.ok(f.app.store.read().resident.messages.find(m => m.sourceId === turn.id).text.includes(text));
  for (let n = 0; n < 20; n++) { replay(f, id); await f.app.residentRunner.tick(); }
  assertNoPublication(f); assert.deepEqual(f.discussion(id).wikiPublication, p); assert.equal(f.topicInputs.length, calls);
});

test('topic Wiki: more than twenty public closing sources blocks the complete outcome without creating a partial Wiki', async t => {
  // This storage boundary cannot arise with today's eight-member limit. Keep
  // the real engine preparation and public records, then extend only the
  // accepted closing group to exercise the durable publication guard.
  const f = await projectedTopic(t, { beforeResume: (s, r, d) => {
    const turn = d.turns.find(t => t.phase === 'summary_review');
    const task = d.tasks.find(t => t.id === turn.taskId), message = s.resident.messages.find(m => m.sourceId === turn.id);
    const context = roomContext(r, d.members[0].id);
    for (let n = 0; n < 20; n++) {
      const participantId = 'source-limit-' + n, turnId = 'source-limit-turn-' + n, taskId = 'source-limit-task-' + n;
      const p = { ...d.members[0], id: participantId };
      s.participants.push(p); d.members.push(p); d.contexts.push({ ...structuredClone(d.contexts[0]), participantId });
      r.members.push({ ...r.members[0], participantId }); r.contexts.push({ ...structuredClone(context), participantId });
      d.turns.push({ ...structuredClone(turn), id: turnId, participantId, taskId });
      d.tasks.push({ ...structuredClone(task), id: taskId, participantId, turnId });
      s.resident.messages.push({ ...message, id: 'source-limit-message-' + n, sequence: ++r.lastMessageSequence, sourceId: turnId, authorId: participantId });
    }
    prepareTopicWiki(s, r, d);
  } });
  replay(f, f.id); assertNoPublication(f); assert.equal(f.discussion(f.id).wikiPublication.status, 'blocked');
  const p = f.discussion(f.id).wikiPublication; for (let n = 0; n < 20; n++) replay(f, f.id);
  assertNoPublication(f); assert.deepEqual(f.discussion(f.id).wikiPublication, p);
});

for (const limit of ['pages', 'body']) test('topic Wiki: next-input ' + limit + ' limit remains an explicit context selection guard', async t => {
  const f = await topicWikiFixture(t); const id = f.start(); await finished(f, id); await f.step();
  const count = limit === 'pages' ? WIKI_LIMITS.pins : 4;
  for (let n = 0; n < count; n++) f.w.edit(f.roomId, f.edit({ slug: 'context-limit-' + n, body: limit === 'body' ? 'x'.repeat(18000) : 'Additional public page ' + n }), key());
  const state = f.app.store.read(); assert.equal(f.discussion(id).wikiPublication.status, 'published');
  assert.throws(() => contextWiki(state, f.room()), /wiki_context_requires_selection/);
  assert.equal(state.resident.wikiVersions.filter(v => v.editId === `topic:${id}:1`).length, 1);
  assert.equal(f.topicInputs.length, f.discussion(id).turns.length);
});

for (const limit of ['pages', 'body']) test('topic Wiki: candidate context ' + limit + ' overflow leaves existing pages and notices untouched', async t => {
  const f = await projectedTopic(t, { longText: limit === 'body' ? 'CLOSING_CONTEXT_' + 'x'.repeat(8000) : undefined });
  const count = limit === 'pages' ? WIKI_LIMITS.pins : 3;
  for (let n = 0; n < count; n++) f.w.edit(f.roomId, f.edit({ slug: 'existing-context-' + n, body: limit === 'body' ? 'x'.repeat(18000) : 'Existing public page ' + n }), key());
  assert.equal(contextWiki(f.app.store.read(), f.room()).length, count);
  const before = wikiState(f, f.id), calls = f.topicInputs.length;
  replay(f, f.id);
  const blocked = wikiState(f, f.id);
  assert.equal(blocked.publication.status, 'blocked'); assert.equal(blocked.publication.reason, 'wiki_context_requires_selection');
  assert.deepEqual(blocked.pages, before.pages); assert.deepEqual(blocked.versions, before.versions); assert.deepEqual(blocked.notices, before.notices);
  assert.equal(blocked.versions.filter(v => v.editId === `topic:${f.id}:1`).length, 0);
  f.w.pin(f.roomId, { expectedVersion: f.room().version, pins: [] }, key());
  for (let n = 0; n < 20; n++) replay(f, f.id);
  assert.deepEqual(wikiState(f, f.id), blocked); assert.equal(f.topicInputs.length, calls);
});
