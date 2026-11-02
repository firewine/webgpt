import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { usageFor } from '../dist/server/workspace/dispatch.js';
import { actorScope } from '../dist/server/workspace/wiki-policy.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { acceptanceFixture, evidence } from './resident-acceptance-fixture.mjs';
import { storage, ownerKey } from './workspace-helpers.mjs';
import { topic } from './workspace-helpers.mjs';

test('R8-A/B: three speakers autonomously propose, pick up, reject/rework, review, publish/cite Wiki and start a topic before returning to the same room without owner relay', async t => {
  const f = await acceptanceFixture(t, { autoTopic: true }); const s = await f.runUnattended(); const r = s.resident.rooms[0];
  assert.equal(r.members.filter(m => m.enabled).length, 3); assert.deepEqual(s.resident.turns.slice(0, 3).map(v => v.participantId), ['fake-a', 'fake-b', 'fake-c']);
  assert.equal(s.resident.workItems.length, 1); const task = s.resident.workItems[0]; assert.equal(task.proposedBy, 'fake-c'); assert.equal(task.status, 'done');
  assert.equal(task.reports.length, 2); assert.deepEqual(task.reviews.map(v => v.decision), ['rework', 'accept']); assert.ok(task.reviews.every(v => v.reviewerId !== task.reports[0].authorId));
  const attempts = s.resident.workAttempts.filter(a => a.purpose === 'work'); assert.equal(attempts.length, 2); assert.equal(attempts[1].input.previousReportId, task.reports[0].id);
  const rework = s.resident.turns.find(v => v.workAttemptId === attempts[1].id); assert.ok(rework.prompt.includes(task.reviews[0].reason));
  assert.equal(s.resident.wikiPages.length, 1); assert.equal(s.resident.wikiVersions.length, 2); const wiki = s.resident.wikiVersions.at(-1);
  const next = s.resident.turns.at(-1); assert.equal(next.wikiCitations[0].digest, wiki.digest); assert.equal(wiki.sourceRefs[0].id, task.reports[1].id);
  assert.equal(s.resident.messages.filter(m => m.authorId === 'owner').length, 1); assert.equal(f.maximum(), 1); assert.equal(f.calls.length, 8); assert.equal(usageFor(r).requests, 8);
  const did = await f.focusAndReturn(); const end = f.app.store.read(); const d = end.discussions.find(d => d.id === did);
  assert.equal(d.status, 'completed'); assert.equal(d.wikiCitations[0].digest, wiki.digest); assert.ok(d.turns.every(v => v.wikiCitations[0].digest === wiki.digest));
  assert.equal(f.room().topicLink, null); assert.equal(f.room().id, f.roomId); assert.equal(f.app.store.events(0).filter(e => e.type === 'resident.focus_returned').length, 1);
  assert.equal(f.maximum(), 1); assert.equal(new Set(f.calls.map(v => v.requestId)).size, f.calls.length); assert.equal(end.jobs.length, 0);
  assert.equal(end.resident.topicIntents.length, 1); assert.equal(end.resident.topicIntents[0].discussionId, did); assert.equal(next.reply.proposals[0].kind, 'topic_propose');
  await evidence('flow', { roomId: f.roomId, memberIds: r.members.map(m => m.participantId), taskId: task.id, attempts: s.resident.workAttempts.map(a => a.id), reports: task.reports.map(v => ({ id: v.id, digest: v.digest })), reviews: task.reviews.map(v => ({ id: v.id, decision: v.decision })), wiki: { pageId: wiki.pageId, version: wiki.version, digest: wiki.digest }, nextTurn: next.id, topicIntentId: end.resident.topicIntents[0].id, discussionId: did, focusReturns: 1, maximumProviderCalls: f.maximum(), transportRequests: f.calls.length, codexJobs: 0, explicitOwnerFocusRequests: 0, realAccounts: 'NOT_RUN' });
});

test('R8-E: G0, flag-off legacy operation and re-enable preserve room/Wiki/raw records/commands/receipts with zero transport replay', async t => {
  const f = await acceptanceFixture(t); await f.runUnattended(); const r = f.room(); f.control({ action: 'off' });
  assert.ok(f.app.store.read().resident.dispatchLeases.every(l => l.state === 'released')); assert.ok(f.app.store.read().resident.turns.every(v => !['prepared', 'running', 'unconfirmed'].includes(v.status)));
  f.app.engine.kick = () => {}; const did = f.app.engine.create({ ...topic, materials: 'legacy original retained' }, 'legacy-e2e'); f.app.engine.control(did, { action: 'pause', expectedRevision: 1 }, 'legacy-paused');
  const db = new DatabaseSync(join(f.directory, 'workspace.sqlite')); const receipts = () => db.prepare('SELECT * FROM commands ORDER BY id').all();
  const before = f.app.store.read(); const commands = receipts(); const events = f.app.store.events(0, 10000); const cursor = f.app.store.cursor(); const config = f.app.config;
  await f.app.close(); let calls = 0;
  let reopened;
  try {
  const off = reopened = new Workspace({ ...config, residentEnabled: false }, 1, { residentAutoSchedule: false, residentProvider: { complete: async () => { calls++; assert.fail('flag off replay'); } } });
  off.start(); const preserved = off.store.read().resident;
  assert.deepEqual(preserved, before.resident); assert.equal(off.wiki.get(f.roomId, before.resident.wikiPages[0].id).version.body, before.resident.wikiVersions.at(-1).body);
  assert.throws(() => off.wiki.edit(f.roomId, {}, 'disabled-edit'), /resident_disabled/); for (let i = 0; i < 100; i++) await off.residentRunner.tick();
  assert.deepEqual(off.store.events(0, 10000), events); assert.equal(off.store.cursor(), cursor); assert.deepEqual(receipts(), commands);
  assert.equal(off.engine.create({ ...topic, materials: 'legacy original retained' }, 'legacy-e2e'), did); assert.equal(calls, 0); await off.close();
  const on = reopened = new Workspace({ ...config, residentEnabled: true }, 1, { residentAutoSchedule: false, residentProvider: { complete: async () => { calls++; assert.fail('off room replay after re-enable'); } } });
  on.start(); for (let i = 0; i < 100; i++) await on.residentRunner.tick();
  assert.deepEqual(on.store.read().resident, preserved); assert.deepEqual(receipts(), commands); assert.deepEqual(on.store.events(0, 10000), events); assert.equal(calls, 0); assert.equal(on.store.read().discussions[0].id, did);
  assert.equal(on.resident.snapshot().rooms[0].id, r.id); assert.equal(on.resident.snapshot().enabled, true);
  await evidence('rollback', { cursor, commandCount: commands.length, originalRoomId: r.id, legacyDiscussionId: did, wikiVersions: preserved.wikiVersions.length, transportReplay: calls, flagOffTicks: 100, reEnabledOffTicks: 100, deployment: 'NOT_RUN' });
  } finally { await reopened?.close(); db.close(); }
});

test('R8-G: accepted reports survive actor handoff and two duplicate registrations while ready/review work, Wiki and budgets retain their IDs', async t => {
  const f = await acceptanceFixture(t); f.control({ action: 'on' }); for (let i = 0; i < 4; i++) await f.step();
  const first = f.app.store.read().resident.workItems[0]; assert.equal(first.status, 'review'); const readyId = f.propose({ title: '인계 후에도 남는 ready 일감' });
  const actor = actorScope(f.app.store.read(), f.roomId, 'fake-a', 'room:' + f.roomId);
  const grant = f.app.residentMcp.createGrant({ roomId: f.roomId, participantId: 'fake-a', scopeRef: actor.scopeRef, scopeVersion: actor.scopeVersion, contextGeneration: actor.contextGeneration, expectedEpoch: actor.epoch, tools: ['resident_wiki_get'], expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const before = f.app.store.read(); const r = f.room(); const input = { participantId: 'fake-a', expectedEpoch: r.epoch, expectedGeneration: 1 };
  const receipt = f.app.residentRunner.handoff(f.roomId, input, 'r8-handoff');
  for (let i = 0; i < 2; i++) assert.deepEqual(f.app.residentRunner.handoff(f.roomId, input, 'r8-handoff'), receipt);
  for (let i = 0; i < 2; i++) assert.equal(f.control({ action: 'set_member', participantId: 'fake-a', enabled: true }).changed, false);
  const after = f.app.store.read(); assert.equal(receipt.generation, 2); assert.equal(after.resident.contextCheckpoints.length, 1);
  assert.deepEqual(after.resident.workItems, before.resident.workItems); assert.deepEqual(after.resident.workAttempts, before.resident.workAttempts); assert.deepEqual(after.resident.wikiVersions, before.resident.wikiVersions);
  assert.deepEqual(f.room().budgets, r.budgets); assert.deepEqual(f.room().ledger, r.ledger); assert.deepEqual(f.room().seats, r.seats); assert.equal(f.task(readyId).status, 'ready');
  assert.throws(() => f.app.residentMcp.authenticate(grant.token), /resident_scope_changed/);
  const pack = JSON.parse(after.resident.contextCheckpoints[0].text); assert.ok(pack.pendingWork.some(v => v.id === readyId)); assert.equal(pack.wikiVersions[0].digest, after.resident.wikiVersions[0].digest); assert.ok(pack.policy.includes('권한'));
  await f.step(); const reviewed = f.task(first.id); assert.equal(reviewed.reviews[0].reviewerId, 'fake-b'); assert.equal(reviewed.reviews[0].decision, 'rework'); assert.equal(reviewed.reports[0].digest, first.reports[0].digest);
  assert.equal(f.app.store.read().resident.workAttempts.filter(a => a.taskId === first.id && a.purpose === 'work').length, 1); assert.equal(f.app.store.read().jobs.length, 0);
  await evidence('handoff', { roomId: f.roomId, taskId: first.id, readyId, checkpointId: receipt.checkpointId, generation: 2, duplicateMemberRegistrations: 2, duplicateHandoffCommands: 2, originalReportDigest: first.reports[0].digest, reviewer: reviewed.reviews[0].reviewerId, budgetReset: false, codexJobs: 0 });
});

for (const variant of ['legacy-v1', 'r1-resident']) test('R8 migration: ' + variant + ' upgrades through R7 without importing private history or changing legacy records', async t => {
  const f = await storage(t); const engine = new DiscussionEngine(f.store, { complete: () => assert.fail('migration provider') }, { sourceFetch: false, turnTimeoutMs: 1000 }); engine.kick = () => {};
  const did = engine.create({ ...topic, materials: 'original legacy material' }, 'r8-legacy-create'); engine.control(did, { expectedRevision: 1, action: 'pause' }, 'r8-legacy-pause');
  let rid; if (variant === 'r1-resident') { const r1 = new ResidentStore(f.store, true); rid = r1.snapshot().rooms[0].id; r1.postMessage(rid, { text: 'R1 room original' }, 'r8-r1-message'); }
  const before = f.store.read(); f.store.close();
  const config = loadWorkspaceConfig({ WJ_STATE_DIR: f.directory, WJ_CHROME_PROFILE_DIR: join(f.directory, 'fixture-chrome'), WJ_ACCESS_TOKEN: ownerKey, WJ_RESIDENT_ENABLED: 'true' });
  const app = new Workspace(config, 1, { residentAutoSchedule: false });
  try { const { resident, dotMcp, ...legacy } = app.store.read(); const { resident: oldResident, ...oldLegacy } = before;
    assert.equal(dotMcp.schemaVersion, 1); assert.deepEqual(dotMcp.bindings, []); assert.deepEqual(dotMcp.grants, []);
    assert.deepEqual(legacy, oldLegacy); assert.equal(resident.workSchemaVersion, 1); assert.equal(resident.workExecutionSchemaVersion, 1); assert.equal(resident.wikiSchemaVersion, 1);
    assert.equal(resident.wikiPages.length, 0); assert.equal(resident.residentGrants.length, 0); assert.equal(resident.workItems.length, 0);
    if (rid) { assert.equal(resident.rooms[0].id, rid); assert.deepEqual(resident.messages, oldResident.messages); }
    assert.equal(app.engine.create({ ...topic, materials: 'original legacy material' }, 'r8-legacy-create'), did);
    assert.equal(app.store.read().discussions[0].status, 'paused');
  } finally { await app.close(); }
});
