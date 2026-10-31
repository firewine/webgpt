import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { residentFixture } from './resident-fixture.mjs';
import { rotateResidentContext } from '../dist/server/workspace/resident-context.js';
import { digest } from '../dist/server/workspace/util.js';
import { Wiki } from '../dist/server/workspace/wiki.js';

test('R2-H: two consumers replay 100 handoffs with one generation/event/receipt and unchanged budgets/originals', async t => {
  const f = await residentFixture(t); await f.runner.tick(); f.advance(); await f.runner.tick();
  const original = '공개 장문 ' + '말'.repeat(3000); const posted = f.resident.postMessage(f.roomId, { text: original }, 'handoff-source');
  f.store.transact(s => { s.resident.messages.push({ ...s.resident.messages[0], id: 'private', sequence: ++s.resident.rooms[0].lastMessageSequence, visibility: 'topic_round', text: 'private draft must not leak' }); });
  const before = f.room(); const args = { participantId: 'fake-a', expectedGeneration: 1, expectedEpoch: before.epoch }; let receipt;
  for (let i = 0; i < 100; i++) {
    const result = i % 2 ? rotateResidentContext(f.store, true, f.roomId, args, 'same-context') : f.runner.handoff(f.roomId, args, 'same-context');
    if (i === 0) receipt = result; else assert.deepEqual(result, receipt);
  }
  const state = f.store.read().resident; assert.equal(state.contextCheckpoints.length, 1); assert.equal(f.room().contexts[0].generation, 2); assert.equal(f.calls(), 2);
  assert.equal(f.store.events(0).filter(e => e.type === 'resident.context_rotated').length, 1);
  assert.deepEqual(f.room().ledger, before.ledger); assert.deepEqual(f.room().budgets, before.budgets); assert.equal(f.resident.message(f.roomId, posted.messageId).message.text, original);
  const cp = state.contextCheckpoints[0]; assert.equal(cp.digest, digest(cp.text)); assert.equal(f.room().contexts[0].history[0].content, cp.text); assert.doesNotMatch(cp.text, /private draft/);
  assert.equal(JSON.parse(cp.text).notes.length, 2); assert.deepEqual(JSON.parse(cp.text).notes[0].uncertainty, ['별도 검증 필요']);
  const ref = JSON.parse(cp.text).messages.find(m => m.id === posted.messageId); assert.equal(ref.digest, digest(original)); assert.equal(ref.truncated, true);
  assert.throws(() => f.runner.handoff(f.roomId, args, 'stale-consumer'), /generation_conflict/);
  assert.throws(() => f.runner.handoff(f.roomId, { ...args, participantId: 'fake-b' }, 'same-context'), /idempotency_conflict/);
});

test('R2-H: checkpoint/generation/event/command is one SQLite transaction with no budget rollback', async t => {
  const f = await residentFixture(t); await f.runner.tick(); const before = f.store.read(); const cursor = f.store.cursor();
  const db = new DatabaseSync(join(f.directory, 'workspace.sqlite')); t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_context BEFORE INSERT ON commands WHEN NEW.id='resident:context:retry-context' BEGIN SELECT RAISE(ABORT, 'checkpoint rollback'); END;");
  const input = { participantId: 'fake-a', expectedGeneration: 1, expectedEpoch: f.room().epoch };
  assert.throws(() => f.runner.handoff(f.roomId, input, 'retry-context'), /checkpoint rollback/); assert.deepEqual(f.store.read(), before); assert.equal(f.store.cursor(), cursor);
  db.exec('DROP TRIGGER fail_context'); f.runner.handoff(f.roomId, input, 'retry-context'); assert.equal(f.room().contexts[0].generation, 2); assert.deepEqual(f.room().ledger, before.resident.rooms[0].ledger);
});

test('R2-J: unresolved actor, unreported work/job, topic focus and browser contexts do not rotate', async t => {
  const f = await residentFixture(t); const pristine = f.store.read();
  const cases = [
    [s => s.resident.turns.push({ id: 'pending', roomId: f.roomId, participantId: 'fake-a', status: 'unconfirmed' }), /reconciliation_required/],
    [s => s.resident.workAttempts.push({ id: 'attempt', roomId: f.roomId, participantId: 'fake-a', status: 'running' }), /work_report_required/],
    [s => { s.jobs.push({ id: 'job', status: 'completed', discussionId: null }); s.resident.jobLinks.push({ jobId: 'job', participantId: 'fake-a', reported: false }); }, /job_report_required/],
    [s => { s.resident.rooms[0].topicLink = 'topic'; }, /topic_focus_active/],
    [s => { s.participants[0].kind = 'browser'; }, /existing_browser_context_preserved/],
  ];
  for (const [seed, reason] of cases) {
    f.store.transact(s => { Object.assign(s, structuredClone(pristine)); seed(s); });
    assert.throws(() => f.runner.handoff(f.roomId, { participantId: 'fake-a', expectedGeneration: 1, expectedEpoch: f.room().epoch }, crypto.randomUUID()), reason);
    assert.equal(f.store.read().resident.contextCheckpoints.length, 0); assert.equal(f.room().contexts?.[0]?.generation ?? 1, 1);
  }
});

test('other actor work/job references do not become this actor work when it rotates', async t => {
  const f = await residentFixture(t);
  const wiki = new Wiki(f.store, true); const source = f.resident.postMessage(f.roomId, { text: 'shared original' }, 'wiki-original').messageId;
  const shared = wiki.edit(f.roomId, { slug: 'shared', title: 'shared', body: 'never inline wiki body', sourceRefs: [{ kind: 'message', id: source }], expectedVersion: 0, scopeRef: 'room:' + f.roomId }, 'shared-wiki');
  f.store.transact(s => { s.bindings.push({ id: 'private-project' }); });
  wiki.edit(f.roomId, { slug: 'private-page', title: 'private-page', body: 'private wiki body', sourceRefs: [{ kind: 'message', id: source }], expectedVersion: 0, scopeRef: 'binding:private-project' }, 'private-wiki');
  wiki.pin(f.roomId, { expectedVersion: f.room().version, pins: [{ pageId: shared.pageId, version: 1 }] }, 'wiki-pin');
  f.store.transact(s => { s.resident.workItems.push({ id: 'other-work', roomId: f.roomId, participantId: 'fake-b', status: 'running' });
    s.jobs.push({ id: 'other-job', discussionId: null, status: 'running' }); s.resident.jobLinks.push({ jobId: 'other-job', participantId: 'fake-b', reported: false }); });
  const result = f.runner.handoff(f.roomId, { participantId: 'fake-a', expectedGeneration: 1, expectedEpoch: f.room().epoch }, 'other-actor-context');
  assert.equal(result.generation, 2); assert.equal(f.calls(), 0); assert.equal(f.store.read().resident.workItems[0].participantId, 'fake-b');
  assert.equal(JSON.parse(f.store.read().resident.contextCheckpoints[0].text).pendingWork[0].id, 'other-work');
  const pack = f.store.read().resident.contextCheckpoints[0].text; assert.equal(JSON.parse(pack).wikiVersions.length, 1); assert.doesNotMatch(pack, /private-page|private wiki body|never inline wiki body/);
});
