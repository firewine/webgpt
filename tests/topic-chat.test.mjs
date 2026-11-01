import test from 'node:test';
import assert from 'node:assert/strict';
import { topicPublishedTurns, unregisteredConnections } from '../dist/client/web/topic-chat-view.js';
import { workspace, topic } from './workspace-helpers.mjs';

function discussion() {
  return { revision: 2, tasks: ['a', 'b'].map(participantId => ({ participantId, revision: 2, phase: 'independent', round: 1, status: 'completed' })), turns: ['a', 'b'].map(participantId => ({ id: participantId, participantId, revision: 2, phase: 'independent', round: 1, status: 'completed', reply: { text: participantId } })) };
}
test('topic projection withholds an unfinished or unconfirmed round, including an already completed speaker', () => {
  for (const status of ['pending', 'running', 'unconfirmed']) { const d = discussion(); d.tasks[1].status = status; assert.deepEqual(topicPublishedTurns(d), []); }
});
test('topic projection does not publish stale/failed/missing replies, prior revisions or an earlier successful retry twice', () => {
  const d = discussion(); const original = JSON.stringify(d); assert.deepEqual(topicPublishedTurns(d).map(t => t.id), ['a', 'b']); assert.equal(JSON.stringify(d), original);
  d.turns.push({ ...d.turns[0], id: 'new-a' }, { ...d.turns[1], id: 'old-b', revision: 1 }); assert.deepEqual(topicPublishedTurns(d).map(t => t.id), ['new-a', 'b']);
  for (const status of ['failed', 'stale', 'unconfirmed']) { const copy = discussion(); copy.turns[1].status = status; assert.deepEqual(topicPublishedTurns(copy), []); }
  const missing = discussion(); missing.turns[1].reply = null; assert.deepEqual(topicPublishedTurns(missing), []);
});
test('topic projection keeps a settled synthesis visible while the separate summary review waits', () => {
  const d = discussion(); d.tasks.forEach(t => { t.phase = 'synthesis'; }); d.turns.forEach(t => { t.phase = 'synthesis'; });
  d.tasks.push({ participantId: 'b', revision: 2, phase: 'summary_review', round: 1, status: 'running' });
  d.turns.push({ id: 'private-review', participantId: 'b', revision: 2, phase: 'summary_review', round: 1, status: 'running', reply: null, text: 'UNPUBLISHED' });
  assert.deepEqual(topicPublishedTurns(d).map(t => t.id), ['a', 'b']);
});
test('connection-only AI remains visible for explicit registration, including login/error states, without creating a participant', () => {
  const participants = [{ id: 'gpt', connectionId: 'account' }, { id: 'gpt-other', connectionId: 'account' }];
  const connections = [{ id: 'account', status: 'connected' }, { id: 'river', status: 'connected' }, { id: 'browser', status: 'error' }, { id: 'login', status: 'auth_required' }];
  const original = JSON.stringify([participants, connections]); assert.deepEqual(unregisteredConnections(participants, connections).map(c => c.id), ['river', 'browser', 'login']); assert.equal(JSON.stringify([participants, connections]), original);
});
test('topic summaries add room scope without copying raw messages or assigning an old standalone discussion to a room', async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); f.app.engine.kick = () => {};
  const id = f.app.engine.create(topic, 'topic-summary'); f.app.store.transact(s => { s.discussions[0].status = 'completed'; s.discussions[0].materials = 'PRIVATE_TOPIC_RAW'; });
  const before = JSON.stringify(f.app.store.read().discussions); const old = f.app.snapshot().discussions.find(d => d.id === id); assert.equal(old.roomId, null); assert.equal(JSON.stringify(old).includes('PRIVATE_TOPIC_RAW'), false);
  f.app.store.transact(s => { s.discussions[0].roomId = s.resident.rooms[0].id; }); const linked = f.app.snapshot().discussions.find(d => d.id === id); assert.equal(linked.roomId, f.app.store.read().resident.rooms[0].id);
  f.app.store.transact(s => { delete s.discussions[0].roomId; }); assert.equal(JSON.stringify(f.app.store.read().discussions), before);
  const response = await f.api('/topic-chat-view.js'); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
});
