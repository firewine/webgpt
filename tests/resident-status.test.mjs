import test from 'node:test';
import assert from 'node:assert/strict';
import { residentFixture } from './resident-fixture.mjs';
import { projectResidentStatus } from '../dist/server/workspace/resident-status.js';

test('R3-F: response/tool/observation/generation axes retain evidence times without exposing private records', async t => {
  const f = await residentFixture(t, { configure: false }); const at = '2026-10-30T01:02:03.000Z';
  f.store.transact(s => {
    const r = s.resident.rooms[0]; r.contexts = [{ participantId: 'fake-a', generation: 2, history: [], checkpointId: null, lastSeenSequence: 0 }];
    s.resident.turns.push({ id: 'old-turn', roomId: r.id, participantId: 'fake-a', generation: 1, epoch: r.epoch, status: 'running', startedAt: at, finishedAt: null, text: 'PRIVATE RESPONSE', prompt: 'PRIVATE PROMPT', participant: { id: 'fake-a' }, error: null });
    const d = { id: 'focus', contexts: [{ participantId: 'fake-b', generation: 1, observation: { connection: 'ready', response: 'waiting', tool: 'running', work: 'pending', observedAt: at, lastProgressAt: at, source: 'fixture-observation', reason: 'observation_stopped' } }], tasks: [{ id: 'task-b', participantId: 'fake-b' }] };
    s.discussions.push(d); r.topicLink = d.id;
    s.jobs.push({ id: 'job-b', discussionId: d.id, taskId: 'task-b', status: 'running', createdAt: at, finishedAt: null, error: null, activities: [{ observedAt: at }], prompt: 'PRIVATE SHELL', text: 'PRIVATE JOB OUTPUT' });
  });
  const state = f.store.read(); const before = JSON.stringify(state);
  const result = projectResidentStatus(state, f.roomId);
  const a = result.members.find(m => m.participantId === 'fake-a'); const b = result.members.find(m => m.participantId === 'fake-b');
  assert.equal(a.previousGeneration, true); assert.equal(a.response.state, 'stale'); assert.equal(a.response.observedAt, at); assert.equal(a.lastProgressAt, null);
  assert.equal(b.response.state, 'waiting'); assert.equal(b.tool.state, 'running'); assert.equal(b.tool.observedAt, at); assert.equal(b.response.reason, 'observation_stopped');
  assert.equal(b.lastProgressAt, at); assert.equal(b.lastSpeechAt, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/); assert.equal(JSON.stringify(state), before);
  assert.deepEqual(projectResidentStatus(state, 'another-room'), { members: [], notices: [] });
});

test('R3-F: repeated source event makes one notice; 100 self notifications and heartbeat make none', async t => {
  const f = await residentFixture(t, { configure: false }); const s = f.store.read(); const before = f.store.cursor();
  const event = { id: 10, type: 'resident.status_changed', at: '2026-10-30T01:02:03.000Z', discussionId: null, data: { roomId: f.roomId, status: 'budget_exhausted', private: 'DO NOT COPY' } };
  const notice = projectResidentStatus(s, f.roomId, Array(20).fill(event));
  assert.equal(notice.notices.length, 1); assert.equal(notice.notices[0].eventId, 10); assert.equal(notice.notices[0].at, event.at);
  const own = Array.from({ length: 100 }, (_, n) => ({ id: 11 + n, at: event.at, type: 'resident.status_notice', discussionId: null, data: { ...notice.notices[0], status: 'blocked' } }));
  assert.equal(projectResidentStatus(s, f.roomId, own).notices.length, 0);
  assert.equal(projectResidentStatus(s, f.roomId, [{ ...event, type: 'heartbeat' }, { ...event, data: { ...event.data, roomId: 'other-room' } }]).notices.length, 0);
  assert.equal(f.calls(), 0); assert.equal(f.store.cursor(), before); assert.doesNotMatch(JSON.stringify(notice), /DO NOT COPY/);
});

test('R3 status API is a read projection: 100 reads never create turns, journal events or notices', async t => {
  const f = await residentFixture(t, { configure: false }); const before = f.store.cursor();
  for (let n = 0; n < 100; n++) {
    const value = f.resident.room(f.roomId); assert.equal(value.status.members.length, 2); assert.equal(value.status.notices.length, 0);
  }
  assert.equal(f.calls(), 0); assert.equal(f.store.cursor(), before); assert.equal(f.store.read().resident.turns.length, 0);
});
