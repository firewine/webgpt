import test from 'node:test';
import assert from 'node:assert/strict';
import { residentFixture, reply } from './resident-fixture.mjs';
import { until, topic, response } from './workspace-helpers.mjs';

test('R2-A: 100 topic/resident/work reservation competitors share one live call and duplicate invocation is denied', async t => {
  let release; let active = 0; let maximum = 0;
  const f = await residentFixture(t, { complete: async input => {
    active++; maximum = Math.max(maximum, active); input.hooks.dispatched(); await new Promise(r => { release = r; }); active--;
    return { text: reply(), receipt: 'one', usage: null };
  } });
  const running = f.runner.tick(); await until(() => release);
  const outcomes = await Promise.all(Array.from({ length: 100 }, (_, i) => Promise.resolve().then(() => f.store.transact(state => f.dispatch.reserve(state,
    { requestId: 'competitor-' + i, kind: ['topic', 'resident', 'work'][i % 3], participantId: 'fake-b', generation: 1, roomId: f.roomId })))));
  assert.ok(outcomes.every(reason => reason === 'dispatch_busy'));
  const turn = f.store.read().resident.turns[0];
  await assert.rejects(f.dispatch.perform(f.store, f.provider, { requestId: turn.id, participant: turn.participant, prompt: turn.prompt, history: [], signal: new AbortController().signal,
    hooks: { dispatched() {}, receipt() {}, delta() {} } }), /dispatch_not_reserved/);
  assert.equal(f.store.read().resident.dispatchLeases[0].state, 'running'); assert.equal(f.calls(), 1);
  release(); await running; assert.equal(maximum, 1); assert.equal(f.store.read().resident.dispatchLeases[0].state, 'released');
  const duplicate = f.store.transact(s => f.dispatch.reserve(s, { requestId: turn.id, kind: 'resident', participantId: turn.participantId, generation: 1, roomId: f.roomId }));
  assert.equal(duplicate, 'request_already_dispatched'); assert.equal(f.calls(), 1);
});

test('R2-A: a running legacy topic keeps the ambient loop waiting without busy kicks', async t => {
  let f; let release; let active = 0; let maximum = 0; let first = true;
  f = await residentFixture(t, { maxRequests: 100, complete: async input => {
    active++; maximum = Math.max(maximum, active); input.hooks.dispatched();
    if (first) { first = false; await new Promise(r => { release = r; }); }
    const text = input.prompt.startsWith('웹쫀쿠 상주') ? reply() : response(input.prompt, input.participant);
    active--; return { text, receipt: 'shared', usage: { input: 1, output: 1 } };
  } });
  const did = f.engine.create(topic, 'legacy-first'); await until(() => release);
  for (let i = 0; i < 100; i++) await f.runner.tick(); assert.equal(f.calls(), 1);
  release(); await until(() => f.store.read().discussions.find(d => d.id === did)?.status === 'completed');
  const before = f.calls(); await f.runner.tick(); assert.equal(f.calls(), before + 1); assert.equal(maximum, 1);
});

test('R2-E: three participants keep both topic round barriers, settle the same room ledger and return once', async t => {
  let f; const paused = new Set(); const inputs = [];
  f = await residentFixture(t, { configure: false, maxRequests: 60, members: ['fake-a', 'fake-b', 'fake-c'], pacing: { minIntervalMs: 1000 }, complete: async input => {
    input.hooks.dispatched(); inputs.push(input);
    if (input.prompt.startsWith('웹쫀쿠 상주')) return { text: reply(), receipt: 'ambient', usage: null };
    const current = f.store.read().discussions[0];
    if (current.phase === 'cross_review' && !paused.has(current.round)) { paused.add(current.round); f.engine.control(current.id, { action: 'pause', expectedRevision: 1 }, 'pause-round-' + current.round); }
    const answer = JSON.parse(response(input.prompt, input.participant)); answer.verifications = [];
    return { text: JSON.stringify(answer), receipt: 'topic-fixture', usage: { input: 1, output: 2 } };
  } });
  f.store.transact(s => { s.participants.push({ ...s.participants[0], id: 'fake-c', label: 'C' }); }); f.configure();
  const did = f.runner.focus(f.roomId, { ...topic, participantIds: ['fake-a', 'fake-b', 'fake-c'], limits: { maxRequests: 60, maxRounds: 2, maxVerificationTasks: 0 } }, 'focus');
  assert.equal(f.runner.focus(f.roomId, { ...topic, participantIds: ['fake-a', 'fake-b', 'fake-c'], limits: { maxRequests: 60, maxRounds: 2, maxVerificationTasks: 0 } }, 'focus'), did);
  await until(() => { const d = f.store.read().discussions[0]; return d.status === 'paused' && d.turns.every(t => t.status === 'completed'); });
  await f.runner.tick(); let messages = f.store.read().resident.messages; assert.equal(messages.length, 3); assert.ok(messages.every(m => f.store.read().discussions[0].turns.find(t => t.id === m.sourceId).phase === 'independent'));
  f.engine.control(did, { action: 'resume', expectedRevision: 1 }, 'resume-one');
  await until(() => { const d = f.store.read().discussions[0]; return d.status === 'paused' && d.round === 2 && d.turns.every(t => t.status === 'completed'); });
  await f.runner.tick(); messages = f.store.read().resident.messages; assert.equal(messages.length, 6);
  assert.ok(messages.every(m => { const t = f.store.read().discussions[0].turns.find(t => t.id === m.sourceId); return t.phase === 'independent' || t.round === 1; }));
  const reviewInputs = inputs.filter(i => i.prompt.includes('· cross_review ·'));
  for (const input of reviewInputs.slice(0, 3)) { const data = JSON.parse(input.prompt.split('\n\n').find(s => s.startsWith('{"topic":'))); assert.equal(data.sharedReplies.length, 3); }
  const roundTwo = JSON.parse(reviewInputs[3].prompt.split('\n\n').find(s => s.startsWith('{"topic":'))); assert.equal(roundTwo.sharedReplies.length, 6);
  f.engine.control(did, { action: 'resume', expectedRevision: 1 }, 'resume-two'); await until(() => f.store.read().discussions[0].status === 'completed');
  for (let i = 0; i < 100; i++) await f.runner.tick();
  const state = f.store.read(); assert.equal(f.room().id, f.roomId); assert.equal(f.room().topicLink, null); assert.deepEqual(f.room().legacyDiscussionIds, [did]);
  assert.equal(state.resident.messages.length, state.discussions[0].turns.length); assert.equal(f.room().ledger.length, state.discussions[0].turns.length);
  assert.equal(f.store.events(0).filter(e => e.type === 'resident.focus_returned').length, 1);
  f.advance(1001); await f.runner.tick(); assert.equal(f.store.read().resident.turns.length, 1);
});

test('focus return waits for the original live job receipt instead of treating partial topic completion as job completion', async t => {
  const f = await residentFixture(t); f.engine.kick = () => {};
  const did = f.runner.focus(f.roomId, topic, 'held-focus');
  f.store.transact(s => { s.discussions[0].status = 'partial'; s.jobs.push({ id: 'original-job', discussionId: did, status: 'reconciling' }); });
  for (let i = 0; i < 100; i++) await f.runner.tick(); assert.equal(f.room().topicLink, did); assert.equal(f.calls(), 0);
  f.store.transact(s => { s.jobs[0].status = 'completed'; }); await f.runner.tick();
  assert.equal(f.room().topicLink, null); assert.equal(f.store.read().jobs[0].id, 'original-job');
  assert.equal(f.store.events(0).filter(e => e.type === 'resident.focus_returned').length, 1); assert.equal(f.calls(), 0);
});
