import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { DispatchCoordinator } from '../dist/server/workspace/dispatch.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { ResidentRunner } from '../dist/server/workspace/resident-runner.js';
import { Wiki } from '../dist/server/workspace/wiki.js';
import { contextWiki } from '../dist/server/workspace/wiki-policy.js';
import { publishTopicWiki } from '../dist/server/workspace/topic-wiki.js';

for (const stage of ['before_commit', 'after_commit', 'notice_committed']) test('topic Wiki SIGKILL: ' + stage + ' recovers exactly one version and notice without another completion', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-topic-wiki-crash-'));
  let stateDirectory, store, runner, engine, child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    await runner?.close(); await engine?.close(); store?.close();
    if (!stateDirectory) {
      try { stateDirectory = JSON.parse(await readFile(join(directory, 'topic-wiki-crash.json'), 'utf8')).stateDirectory; } catch { /* Child may fail before fixture setup. */ }
    }
    if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  });
  child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/topic-wiki-crash.mjs', import.meta.url)), directory, stage], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, null, stderr); assert.equal(signal, 'SIGKILL', stderr);
  const info = JSON.parse(await readFile(join(directory, 'topic-wiki-crash.json'), 'utf8')); stateDirectory = info.stateDirectory;
  assert.ok(info.calls > 0); assert.equal(info.calls, info.turns.length);
  store = new Store(stateDirectory);
  let recoveryCalls = 0;
  const provider = { complete: async () => { recoveryCalls++; assert.fail('Recovering a terminal topic must never call a provider'); } };
  const resident = new ResidentStore(store, true); resident.dispatchAvailable = true;
  const dispatch = new DispatchCoordinator(), wiki = new Wiki(store, true);
  engine = new DiscussionEngine(store, provider, { sourceFetch: false, turnTimeoutMs: 1000 }, undefined, dispatch);
  // A fixed clock keeps the first future ambient turn ineligible, while real
  // runner ticks still exercise projection, focus return and recovery replay.
  runner = new ResidentRunner(store, resident, dispatch, provider, engine, 1000, { wiki, clock: () => 0, autoSchedule: false });
  const before = store.read(), d = before.discussions.find(d => d.id === info.discussionId);
  assert.deepEqual(d.turns, info.turns); assert.equal(d.status, 'completed');
  assert.equal(before.jobs.length, 0); assert.equal(before.resident.turns.length, 0);
  assert.equal(before.resident.wikiVersions.length, stage === 'before_commit' ? 0 : 1);
  assert.equal(before.resident.messages.filter(m => m.sourceKind === 'wiki').length, stage === 'before_commit' ? 0 : 1);
  assert.equal(d.wikiPublication.status, stage === 'before_commit' ? 'pending' : 'published');
  assert.equal(before.resident.rooms[0].topicLink, stage === 'before_commit' ? info.discussionId : null);
  const initialEvents = store.events(info.cursor, 5000);
  if (stage === 'before_commit') { assert.deepEqual(d.wikiPublication, info.publication); assert.equal(initialEvents.length, 0); }
  else assert.equal(initialEvents.filter(e => e.type === 'resident.wiki_edited').length, 1);
  runner.recover(); engine.recover();
  for (let n = 0; n < 20; n++) {
    await runner.tick();
    store.transact((s, emit) => publishTopicWiki(s, s.resident.rooms.find(r => r.id === info.roomId), s.discussions.find(d => d.id === info.discussionId), wiki, emit));
  }
  const s = store.read(), recovered = s.discussions.find(d => d.id === info.discussionId), room = s.resident.rooms.find(r => r.id === info.roomId);
  assert.deepEqual(recovered.turns, info.turns); assert.equal(recovered.wikiPublication.status, 'published');
  assert.equal(s.resident.wikiPages.length, 1); assert.equal(s.resident.wikiVersions.length, 1);
  const version = s.resident.wikiVersions[0], notices = s.resident.messages.filter(m => m.sourceKind === 'wiki');
  if (stage !== 'before_commit') {
    assert.deepEqual(s.resident.wikiVersions, before.resident.wikiVersions);
    assert.deepEqual(notices, before.resident.messages.filter(m => m.sourceKind === 'wiki'));
    assert.deepEqual(recovered.wikiPublication, d.wikiPublication);
  }
  assert.equal(version.editId, `topic:${info.discussionId}:1`); assert.equal(version.authoredBy, 'system');
  assert.equal(version.epistemicStatus, 'reported'); assert.equal(version.scopeRef, 'room:' + info.roomId);
  assert.equal(recovered.wikiPublication.pageId, version.pageId); assert.equal(recovered.wikiPublication.version, version.version);
  assert.equal(recovered.wikiPublication.digest, version.digest); assert.equal(recovered.wikiPublication.inputDigest, version.inputDigest);
  assert.equal(notices.length, 1); assert.equal(notices[0].sourceId, version.id);
  assert.equal(notices[0].visibility, 'room_public'); assert.equal(notices[0].authorId, 'system');
  const sources = s.resident.messages.filter(m => m.sourceKind === 'topic');
  assert.equal(sources.length, info.turns.length); assert.equal(new Set(sources.map(m => m.sourceId)).size, info.turns.length);
  for (const ref of version.sourceRefs) assert.ok(sources.some(m => m.id === ref.id && m.roomId === info.roomId && m.visibility === 'room_public'));
  assert.equal(room.topicLink, null); assert.equal(room.legacyDiscussionIds.filter(id => id === info.discussionId).length, 1);
  assert.equal(contextWiki(s, room)[0].digest, version.digest);
  const events = store.events(info.cursor, 5000);
  assert.equal(events.filter(e => e.type === 'resident.wiki_edited').length, 1);
  assert.equal(events.filter(e => e.type === 'resident.message_created' && e.data.messageId === notices[0].id).length, 1);
  assert.equal(events.filter(e => e.type === 'resident.topic_wiki_changed' && e.data.status === 'published').length, 1);
  assert.equal(events.filter(e => e.type === 'resident.focus_returned' && e.data.discussionId === info.discussionId).length, 1);
  assert.equal(s.resident.turns.length, 0); assert.equal(s.jobs.length, 0); assert.equal(recoveryCalls, 0);
});
