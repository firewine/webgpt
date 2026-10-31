import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Wiki, validateWikiState } from '../dist/server/workspace/wiki.js';
import { contextWiki, actorScope } from '../dist/server/workspace/wiki-policy.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { FakeResidentCompletion } from '../dist/server/workspace/resident-fake.js';
import { wikiFixture } from './wiki-fixture.mjs';
import { storage, until, topic } from './workspace-helpers.mjs';
const key = () => crypto.randomUUID();

test('R7-A: owner and participant edit one base: one version and one durable 409 conflict; originals and past citations remain exact', async t => {
  const f = await wikiFixture(t); const first = f.w.edit(f.roomId, f.edit(), 'first'); f.pin(first.pageId);
  const old = f.w.get(f.roomId, first.pageId).version; const pin = contextWiki(f.app.store.read(), f.room());
  const edit = f.edit({ pageId: first.pageId, expectedVersion: 1, body: '참여자가 먼저 작성한 다음 버전' });
  const outcomes = await Promise.all([Promise.resolve().then(() => f.w.edit(f.roomId, edit, 'participant', f.actor())), f.api(`/api/rooms/${f.roomId}/wiki/${first.pageId}`, { ...edit, body: '동시에 작성한 owner 원문' }).then(async r => ({ statusCode: r.status, result: await r.json() }))]);
  assert.equal(outcomes[0].status, 'published'); assert.equal(outcomes[1].statusCode, 409); const conflict = outcomes[1].result;
  assert.equal(conflict.error.code, 'wiki_version_conflict'); assert.equal(f.w.get(f.roomId, first.pageId, undefined, conflict.conflictId).version.body, '동시에 작성한 owner 원문');
  assert.equal(f.w.get(f.roomId, first.pageId).page.headVersion, 2); assert.deepEqual(f.w.get(f.roomId, first.pageId, 1).version, old); assert.deepEqual(contextWiki(f.app.store.read(), f.room()), pin);
  const conflictCount = f.app.store.read().resident.wikiVersions.length;
  const retry = await f.api(`/api/rooms/${f.roomId}/wiki/${first.pageId}`, { ...edit, body: '동시에 작성한 owner 원문' }, { headers: { 'Idempotency-Key': 'same-conflict' } }); assert.equal(retry.status, 409);
  const retry2 = await f.api(`/api/rooms/${f.roomId}/wiki/${first.pageId}`, { ...edit, body: '동시에 작성한 owner 원문' }, { headers: { 'Idempotency-Key': 'same-conflict' } }); assert.equal(retry2.status, 409); assert.equal(f.app.store.read().resident.wikiVersions.length, conflictCount + 1);
});

test('R7-B: twenty edit/report replays create one version/notice each; model verified text never promotes reported status', async t => {
  const f = await wikiFixture(t); let page;
  for (let i = 0; i < 20; i++) page = f.w.edit(f.roomId, f.edit({ body: 'verified라고 쓴 모델의 보고' }), 'one-edit', f.actor());
  assert.equal(f.app.store.read().resident.wikiVersions.length, 1); assert.equal(f.app.store.read().resident.messages.filter(m => m.sourceKind === 'wiki').length, 1); assert.equal(f.w.get(f.roomId, page.pageId).version.epistemicStatus, 'reported');
  assert.throws(() => f.w.edit(f.roomId, f.edit({ epistemicStatus: 'verified' }), 'bad-status', f.actor()), /invalid_wiki_fields/);
  const taskId = f.propose(); await f.step(); const report = f.task(taskId).reports[0];
  for (let i = 0; i < 20; i++) f.app.store.transact((s, emit) => f.w.publishReport(s, s.resident.rooms[0], report, emit));
  const vs = f.app.store.read().resident.wikiVersions.filter(v => v.editId === 'report:' + report.id); assert.equal(vs.length, 1); assert.equal(vs[0].epistemicStatus, 'reported'); assert.equal(vs[0].sourceRefs[0].digest, report.digest);
  assert.equal(f.app.store.read().resident.messages.filter(m => m.sourceId === vs[0].id).length, 1); assert.equal(f.task(taskId).status, 'review');
});

test('R7-C/F: private draft, foreign room/report, context/URL/file source references are rejected without fetching anything', async t => {
  const f = await wikiFixture(t); f.app.store.transact(s => { s.resident.messages.push({ ...s.resident.messages[0], id: 'private', visibility: 'topic_round', text: 'private sentinel' }, { ...s.resident.messages[0], id: 'foreign', roomId: 'foreign-room', text: 'foreign sentinel' }); });
  for (const ref of [{ kind: 'message', id: 'private' }, { kind: 'message', id: 'foreign' }, { kind: 'context', id: 'fake-b' }, { kind: 'url', id: 'http://127.0.0.1/secret' }, { kind: 'file', id: '/etc/passwd' }, { kind: 'report', id: 'non-public-report' }]) assert.throws(() => f.w.edit(f.roomId, f.edit({ sourceRefs: [ref] }), key(), f.actor()), /wiki_source_not_public|invalid_wiki_source/);
  assert.equal(f.app.store.read().resident.wikiPages.length, 0); assert.equal(f.app.store.read().jobs.length, 0); assert.equal(f.app.store.read().resident.turns.length, 0);
});

test('R7-D: next two speakers and an analysis attempt pin the exact page/version/digest/sources; later edits never change old inputs', async t => {
  const inputs = []; const fake = new FakeResidentCompletion({ complete: async () => assert.fail('No real provider') }, 1);
  const f = await wikiFixture(t, { provider: { complete: i => { inputs.push(i.prompt); return fake.complete(i); } } });
  const page = f.w.edit(f.roomId, f.edit({ body: '고정 원문 ' + '가'.repeat(8000) }), 'pinned'); f.pin(page.pageId); const pinned = contextWiki(f.app.store.read(), f.room());
  await f.step(); await f.step(); const spoken = f.app.store.read().resident.turns.slice(0, 2); assert.equal(spoken.length, 2);
  for (const turn of spoken) { assert.deepEqual(turn.wikiCitations, pinned); assert.ok(turn.prompt.includes(pinned[0].body)); assert.deepEqual(f.app.store.read().resident.messages.find(m => m.sourceId === turn.id).wikiCitations[0].sourceRefs, pinned[0].sourceRefs); }
  const before = JSON.stringify(spoken); f.w.edit(f.roomId, f.edit({ pageId: page.pageId, expectedVersion: 1, body: '수정된 v2' }), 'updated'); assert.deepEqual(contextWiki(f.app.store.read(), f.room()), pinned);
  const task = f.propose(); await f.step(); const attempt = f.app.store.read().resident.workAttempts.find(a => a.taskId === task); assert.deepEqual(attempt.input.wikiCitations, pinned); assert.ok(inputs.at(-1).includes(pinned[0].body));
  assert.equal(JSON.stringify(f.app.store.read().resident.turns.slice(0, 2)), before); assert.equal(f.task(task).reports[0].wikiCitations[0].digest, page.digest);
});

test('R7: focus captures the same allowed Wiki version for every member without changing legacy topic barriers or parser', async t => {
  const f = await wikiFixture(t); const p = f.w.edit(f.roomId, f.edit(), key()); f.pin(p.pageId); const id = f.app.residentRunner.focus(f.roomId, { ...topic, limits: { maxRequests: 12 } }, key());
  const d = await until(() => f.app.store.read().discussions.find(d => d.id === id && ['completed', 'partial'].includes(d.status))); assert.equal(d.wikiCitations[0].digest, p.digest);
  for (const turn of d.turns) { assert.equal(turn.wikiCitations[0].digest, p.digest); assert.ok(turn.prompt.includes(p.digest)); }
  assert.equal(f.app.store.read().resident.rooms[0].wikiPins[0].version, 1);
});

test('R7/R8 boundary: work reports become shared Wiki automatically, next reviewer reads it without owner pinning, and edits affect only future inputs', async t => {
  const f = await wikiFixture(t); const taskId = f.propose(); await f.step();
  const state = f.app.store.read(); const published = state.resident.wikiVersions[0]; assert.equal(f.room().wikiPins, undefined);
  assert.equal(published.sourceRefs[0].id, f.task(taskId).reports[0].id); assert.equal(published.epistemicStatus, 'reported');
  await f.step(); const review = f.app.store.read().resident.turns.at(-1); assert.equal(review.participantId, 'fake-b');
  assert.equal(review.wikiCitations[0].digest, published.digest); assert.equal(JSON.parse(review.prompt.split('\n\n').find(line => line.startsWith('{"taskId":'))).wiki[0].body, published.body); assert.equal(f.task(taskId).status, 'done');
  const before = JSON.stringify(review); const changed = f.w.edit(f.roomId, f.edit({ pageId: published.pageId, expectedVersion: 1, body: '공유 기억의 새 보고 버전' }), key());
  await f.step(); assert.equal(f.app.store.read().resident.turns.at(-1).wikiCitations[0].digest, changed.digest);
  assert.equal(JSON.stringify(f.app.store.read().resident.turns.find(t => t.id === review.id)), before);
  f.w.pin(f.roomId, { expectedVersion: f.room().version, pins: [] }, key()); assert.deepEqual(contextWiki(f.app.store.read(), f.room()), []);
  f.w.pin(f.roomId, { expectedVersion: f.room().version, automatic: true }, key()); assert.equal(contextWiki(f.app.store.read(), f.room())[0].version, 2);
});

test('R7: already claimed work keeps its frozen input when newer automatic Wiki exceeds the next-input limit', async t => {
  const f = await wikiFixture(t); const p = f.w.edit(f.roomId, f.edit(), key()); const taskId = f.propose();
  const a = f.q.claim(f.roomId, taskId, { participantId: 'fake-a', expectedVersion: f.task(taskId).version }, key());
  const original = f.app.store.read().resident.workAttempts.find(x => x.id === a.attemptId).inputDigest;
  for (let i = 0; i < 4; i++) f.w.edit(f.roomId, f.edit({ slug: 'added-' + i, body: '나'.repeat(18000) }), key());
  assert.throws(() => contextWiki(f.app.store.read(), f.room()), /wiki_context_requires_selection/);
  await f.step(); const attempt = f.app.store.read().resident.workAttempts.find(x => x.id === a.attemptId);
  assert.equal(attempt.inputDigest, original); assert.equal(attempt.input.wikiCitations.length, 1); assert.equal(attempt.input.wikiCitations[0].digest, p.digest);
  assert.equal(f.task(taskId).reports.length, 1); assert.equal(f.task(taskId).status, 'review');
});

test('R7: over-limit project Wiki blocks that actor’s task without a partial claim and another allowed task still reports', async t => {
  const f = await wikiFixture(t); f.app.store.transact(s => s.bindings.push({ id: 'large-project' }));
  f.q.seat(f.roomId, { participantId: 'fake-a', expectedVersion: 1, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId, 'binding:large-project'] }, key());
  for (let i = 0; i < 4; i++) f.w.edit(f.roomId, f.edit({ slug: 'project-' + i, scopeRef: 'binding:large-project', body: '다'.repeat(18000) }), key());
  const blocked = f.propose({ priority: 1 }); const allowed = f.propose({ allowedParticipantIds: ['fake-b'] });
  await f.step(); assert.equal(f.task(blocked).status, 'blocked'); assert.equal(f.task(blocked).reason, 'wiki_context_requires_selection'); assert.equal(f.task(blocked).claimantId, null);
  assert.equal(f.app.store.read().resident.workAttempts.filter(a => a.taskId === blocked).length, 0); assert.equal(f.task(allowed).reports.length, 1);
});

test('R7: tombstone and conflict corrections preserve prior versions and old pinned citation', async t => {
  const f = await wikiFixture(t); const p = f.w.edit(f.roomId, f.edit(), key()); f.pin(p.pageId); const old = f.w.get(f.roomId, p.pageId, 1).version;
  f.w.edit(f.roomId, f.edit({ pageId: p.pageId, expectedVersion: 1, body: '이유를 기록한 폐기', tombstone: true }), key()); assert.equal(f.w.get(f.roomId, p.pageId).version.tombstone, true); assert.deepEqual(f.w.get(f.roomId, p.pageId, 1).version, old);
  assert.equal(contextWiki(f.app.store.read(), f.room())[0].digest, old.digest); assert.throws(() => f.pin(p.pageId, 2), /wiki_version_not_found/); assert.equal(f.app.store.read().resident.wikiVersions.length, 2);
});

test('R7: one failed SQLite event rolls back Wiki/page/notice/command together; replay after failure commits exactly once', async t => {
  const f = await wikiFixture(t); const db = new DatabaseSync(join(f.directory, 'workspace.sqlite')); t.after(() => db.close()); const original = f.app.store.cursor();
  db.exec("CREATE TRIGGER reject_wiki BEFORE INSERT ON events WHEN NEW.type='resident.wiki_edited' BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.throws(() => f.w.edit(f.roomId, f.edit(), 'atomic'), /fixture/); assert.equal(f.app.store.read().resident.wikiPages.length, 0); assert.equal(f.app.store.cursor(), original);
  db.exec('DROP TRIGGER reject_wiki'); const result = f.w.edit(f.roomId, f.edit(), 'atomic'); assert.equal(f.w.edit(f.roomId, f.edit(), 'atomic').pageId, result.pageId); assert.equal(f.app.store.read().resident.wikiVersions.length, 1);
});

test('R7: future/lost/corrupt Wiki schema is refused and retired grants without generation are preserved revoked', async t => {
  const f = await wikiFixture(t); f.w.edit(f.roomId, f.edit(), key()); const initial = f.app.store.read();
  f.app.store.transact(s => { s.resident.wikiSchemaVersion = 99; }); assert.throws(() => new Wiki(f.app.store, true), /unsupported_wiki_schema/);
  f.app.store.transact(s => { delete s.resident.wikiSchemaVersion; }); assert.throws(() => new Wiki(f.app.store, true), /wiki_migration_state_missing/);
  f.app.store.transact(s => { s.resident.wikiSchemaVersion = 1; s.resident.wikiVersions[0].body = 'corrupt'; }); assert.throws(() => validateWikiState(f.app.store.read()), /invalid_wiki_state/); assert.equal(f.app.store.read().resident.wikiPages[0].id, initial.resident.wikiPages[0].id);
  const old = await storage(t); new ResidentStore(old.store, true); old.store.transact(s => { s.resident.residentGrants.push({ id: 'legacy-no-generation', kind: 'resident', hash: 'legacy', revoked: false }); });
  new Wiki(old.store, true); assert.equal(old.store.read().resident.residentGrants[0].revoked, true); assert.equal(old.store.read().resident.residentGrants[0].reason, 'legacy_generation_missing');
});

test('R7: bounded Wiki history/state, flag-off reads, and context limit never truncate or silently publish over-limit input', async t => {
  const f = await wikiFixture(t); const p = f.w.edit(f.roomId, f.edit(), key());
  const off = new Wiki(f.app.store, false); assert.equal(off.get(f.roomId, p.pageId).version.body, f.edit().body); assert.throws(() => off.edit(f.roomId, f.edit(), key()), /resident_disabled/);
  assert.equal((await f.api(`/api/rooms/${f.roomId}/wiki?limit=51`)).status, 400); assert.equal((await f.api(`/api/rooms/${f.roomId}/wiki/${p.pageId}/history?limit=51`)).status, 400);
  const snapshot = JSON.stringify(f.app.snapshot()); assert.ok(!snapshot.includes(f.edit().body)); assert.throws(() => f.w.edit(f.roomId, f.edit({ body: '가'.repeat(20001) }), key()), /invalid_wiki_body/);
  const pages = []; for (let i = 0; i < 4; i++) pages.push(f.w.edit(f.roomId, f.edit({ slug: 'large-' + i, body: String(i) + '나'.repeat(18000) }), key()));
  assert.throws(() => f.w.pin(f.roomId, { expectedVersion: f.room().version, pins: pages.map(p => ({ pageId: p.pageId, version: 1 })) }, key()), /wiki_context_requires_selection/); assert.deepEqual(f.room().wikiPins ?? [], []);
});

test('R7: a project Wiki history loses access on seat revocation and blocks next dispatch until a safe context handoff', async t => {
  const f = await wikiFixture(t); f.app.store.transact(s => s.bindings.push({ id: 'project-fixture' }));
  f.q.seat(f.roomId, { participantId: 'fake-a', expectedVersion: 1, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId, 'binding:project-fixture'] }, key());
  const p = f.w.edit(f.roomId, f.edit({ scopeRef: 'binding:project-fixture', body: 'project sentinel original' }), key()); f.pin(p.pageId); await f.step();
  f.q.seat(f.roomId, { participantId: 'fake-a', expectedVersion: 2, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, key());
  await f.step(); await f.step(); assert.equal(f.room().reason, 'wiki_context_requires_handoff'); const before = f.app.store.read().resident.turns.length; for (let i = 0; i < 10; i++) await f.step(); assert.equal(f.app.store.read().resident.turns.length, before);
  const handoff = f.app.residentRunner.handoff(f.roomId, { participantId: 'fake-a', expectedEpoch: f.room().epoch, expectedGeneration: 1 }, key());
  assert.equal(handoff.generation, 2); assert.ok(!f.app.store.read().resident.contextCheckpoints.at(-1).text.includes('project sentinel original'));
});

test('R7: structured AI wiki_edit applies after the completed envelope, but a late old generation applies no Wiki action', async t => {
  let source; let roomId; let release; const f = await wikiFixture(t, { provider: { complete: async input => {
    input.hooks.dispatched(); input.hooks.receipt('wiki-fixture'); await new Promise(resolve => { release = resolve; });
    return { receipt: 'wiki-fixture', usage: null, text: JSON.stringify({ version: 1, action: 'say', text: '공개 내용을 Wiki에 기록합니다.', replyTo: null, mentions: [], claims: [], reviews: [], verifications: [], uncertainty: [], proposals: [{ kind: 'wiki_edit', payload: { slug: 'agent-notes', title: '참여자 메모', body: 'reported 원문', expectedVersion: 0, scopeRef: 'room:' + roomId, sourceRefs: [{ kind: 'message', id: source }] } }] }) };
  } } }); source = f.sourceId; roomId = f.roomId;
  const running = f.step(); await until(() => release); assert.equal(f.app.store.read().resident.wikiVersions.length, 0); release(); await running; assert.equal(f.app.store.read().resident.wikiVersions.length, 1);
  release = null; const stale = f.step(); await until(() => release); f.app.store.transact(s => { s.resident.rooms[0].contexts.find(c => c.participantId === 'fake-b').generation++; }); release(); await stale;
  assert.equal(f.app.store.read().resident.wikiVersions.length, 1); assert.equal(f.app.store.read().resident.turns.at(-1).status, 'stale');
});
