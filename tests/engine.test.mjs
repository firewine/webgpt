import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { AppError } from '../dist/server/workspace/util.js';
import { storage, until, topic, response } from './workspace-helpers.mjs';
function create(t, store, complete, options = {}, reader) { const engine = new DiscussionEngine(store, { complete }, { sourceFetch: false, turnTimeoutMs: 2000, ...options }, reader); t.after(() => engine.close()); return engine; }
test('full discussion enforces draft/review barriers and preserves NOT_RUN evidence and dissent', async t => {
  const { store } = await storage(t); const inputs = []; let active = 0;
  const engine = create(t, store, async input => { active++; assert.equal(active, 1); inputs.push(input); input.hooks.dispatched(); const text = response(input.prompt, input.participant); input.hooks.delta(text); active--; return { text, receipt: `receipt:${inputs.length}`, usage: { input: 10, output: 20 } }; });
  const id = engine.create(topic, 'first'); assert.equal(engine.create(topic, 'first'), id); assert.throws(() => engine.create(topic, 'second'), /root_workflow_busy/);
  const d = await until(() => { const d = store.read().discussions[0]; return d.status === 'completed' && d; });
  assert.equal(d.turns.length, 12); assert.equal(d.used.requests, 12); assert.equal(d.used.inputTokens, 120); assert.equal(d.checkpoints.length, 2);
  assert.deepEqual(new Set(d.turns.map(t => t.phase)), new Set(['independent', 'cross_review', 'verification', 'revision', 'synthesis', 'summary_review']));
  for (const input of inputs.filter(i => i.prompt.includes('· independent ·'))) { const data = JSON.parse(input.prompt.split('\n\n').find(s => s.startsWith('{"topic":'))); assert.equal(data.sharedReplies.length, 0); assert.equal(data.claims.length, 0); }
  const roundOne = d.turns.filter(t => t.phase === 'cross_review' && t.round === 1);
  for (const turn of roundOne) { const data = JSON.parse(turn.prompt.split('\n\n').find(s => s.startsWith('{"topic":'))); assert.ok(data.sharedReplies.every(s => s.phase === 'independent')); assert.ok(turn.reply.reviews.length); }
  assert.ok(d.evidence.every(e => e.status === 'not_run')); assert.ok(d.turns.every(t => t.reply.uncertainty.length)); assert.ok(d.tasks.filter(t => t.phase !== 'independent').every(t => t.dependencyIds.length));
  assert.ok(d.contexts[0].history.every(h => h.role !== 'assistant' || !h.content.includes('모의 참여자 B:')));
  for (const turn of d.turns.filter(t => ['verification', 'revision', 'summary_review'].includes(t.phase))) { const data = JSON.parse(turn.prompt.split('\n\n').find(s => s.startsWith('{"topic":'))); assert.ok(data.sharedReplies.every(r => r.phase !== turn.phase)); }
});
test('three talkers receive full long replies from the previous closed rounds and review every other talker', async t => {
  const { store } = await storage(t); store.transact(s => { s.participants.push({ id: 'fake-c', label: 'Talker C', kind: 'fake', connectionId: null, modelId: 'fixture', role: '' }); });
  const inputs = []; const longText = '긴 발언 본문 ' + '장'.repeat(16020); let id; let engine;
  engine = create(t, store, async input => {
    const data = JSON.parse(input.prompt.split('\n\n').find(s => s.startsWith('{"topic":')));
    const phase = input.prompt.includes('· independent ·') ? 'independent' : 'cross_review';
    inputs.push({ id: input.participant.id, phase, data });
    const answer = JSON.parse(response(input.prompt, input.participant)); answer.verifications = [];
    if (phase === 'independent') answer.text = longText + input.participant.id;
    if (phase === 'cross_review' && inputs.filter(i => i.phase === 'cross_review').length === 6) engine.control(id, { action: 'pause', expectedRevision: 1 }, 'long-round-pause');
    return { text: JSON.stringify(answer), receipt: 'long-fixture', usage: null };
  });
  id = engine.create({ ...topic, participantIds: ['fake-a', 'fake-b', 'fake-c'], limits: { maxRequests: 60, maxRounds: 3, maxVerificationTasks: 0 } }, 'long-rounds');
  const d = await until(() => { const d = store.read().discussions[0]; return d.status === 'paused' && d.turns.every(t => t.status === 'completed') && d; });
  const reviews = inputs.filter(i => i.phase === 'cross_review'); assert.equal(reviews.length, 6);
  for (const input of reviews) {
    const initial = input.data.sharedReplies.filter(r => r.phase === 'independent'); assert.equal(initial.length, 3);
    assert.ok(initial.every(r => r.text.startsWith(longText) && r.text.length > 16000));
    assert.equal(input.data.assignedClaimIds.length, 2);
  }
  assert.ok(reviews.slice(0, 3).every(i => i.data.sharedReplies.length === 3));
  assert.ok(reviews.slice(3).every(i => i.data.sharedReplies.length === 6));
  assert.ok(d.turns.filter(t => t.phase === 'cross_review').every(t => t.reply.reviews.length === 2));
});
test('reasoning changes apply after a confirmed turn boundary and preserve the effort of past turns', async t => {
  const { store } = await storage(t); store.transact(s => { s.connections.push({ id: 'web', kind: 'openai-oauth', label: 'Web account', status: 'connected', models: [{ id: 'fixture', label: 'Fixture' }] }); s.participants.push({ id: 'gpt', label: 'Web GPT', kind: 'openai-oauth', connectionId: 'web', modelId: 'fixture', role: '', reasoningEffort: 'xhigh' }); });
  let release; let did; let engine;
  engine = create(t, store, async input => {
    input.hooks.dispatched();
    if (input.participant.id === 'gpt' && input.prompt.includes('· independent ·')) await new Promise(r => { release = r; });
    if (input.participant.id === 'gpt' && input.prompt.includes('· cross_review ·')) engine.control(did, { action: 'pause', expectedRevision: 1 }, 'reasoning-second-pause');
    return { text: response(input.prompt, input.participant), receipt: 'reasoning-fixture', usage: null };
  });
  did = engine.create({ ...topic, participantIds: ['fake-a', 'gpt'] }, 'reasoning-boundary'); await until(() => release);
  engine.control(did, { action: 'pause', expectedRevision: 1 }, 'reasoning-pause');
  assert.throws(() => engine.control(did, { action: 'configure_participant', expectedRevision: 1, participantId: 'gpt', reasoningEffort: 'low' }, 'reasoning-too-early'), /participant_settings_require_pause/);
  release(); await until(() => store.read().discussions[0].turns.every(t => t.status === 'completed'));
  engine.control(did, { action: 'configure_participant', expectedRevision: 1, participantId: 'gpt', reasoningEffort: 'high' }, 'reasoning-change');
  engine.control(did, { action: 'resume', expectedRevision: 1 }, 'reasoning-resume');
  const d = await until(() => { const d = store.read().discussions[0]; return d.status === 'paused' && d.turns.filter(t => t.participantId === 'gpt').length === 2 && d.turns.every(t => t.status === 'completed') && d; });
  assert.deepEqual(d.turns.filter(t => t.participantId === 'gpt').map(t => t.reasoningEffort), ['xhigh', 'high']);
});
test('source observation is shared equally with revised answers, without turning retrieval into truth', async t => {
  const { store } = await storage(t); let retrieved = 0;
  const engine = create(t, store, async input => ({ text: response(input.prompt, input.participant, { verify: 'source' }), receipt: 'source-fixture', usage: null }), { sourceFetch: true }, async () => { retrieved++; return { text: '관측한 테스트 원문', source: 'https://example.com/evidence', digest: 'raw-digest', observedAt: new Date().toISOString() }; });
  engine.create(topic, 'sources'); const d = await until(() => store.read().discussions.find(d => d.status === 'completed'));
  assert.equal(retrieved, 2); assert.ok(d.evidence.every(e => e.status === 'observed')); for (const turn of d.turns.filter(t => t.phase === 'revision')) assert.ok(turn.prompt.includes('관측한 테스트 원문'));
});
test('pause is a turn boundary; revision makes a late old reply stale; checkpoint generation is independent', async t => {
  const { store } = await storage(t); let release; let calls = 0;
  const engine = create(t, store, async input => { calls++; input.hooks.dispatched(); if (calls === 1) await new Promise(resolve => { release = resolve; }); return { text: response(input.prompt, input.participant), receipt: 'late', usage: null }; });
  const id = engine.create(topic, 'pause'); await until(() => release); engine.control(id, { action: 'pause', expectedRevision: 1 }, 'pause-1');
  engine.control(id, { action: 'revise', text: '오프라인 복구 조건도 검토', expectedRevision: 1 }, 'revise-1'); release(); await until(() => store.read().discussions[0].turns[0].status === 'stale');
  let d = store.read().discussions[0]; assert.equal(calls, 1); assert.equal(d.status, 'paused'); assert.equal(d.revision, 2); assert.equal(d.claims.length, 0);
  engine.control(id, { action: 'handoff', participantId: 'fake-a', expectedGeneration: 1, expectedRevision: 2 }, 'handoff'); d = store.read().discussions[0]; assert.equal(d.contexts[0].generation, 2); assert.equal(d.revision, 2);
  assert.throws(() => engine.control(id, { action: 'resume', expectedRevision: 1 }, 'stale-control'), /revision_conflict/);
  engine.control(id, { action: 'resume', expectedRevision: 2 }, 'resume'); await until(() => store.read().discussions[0].status === 'completed');
});
test('uncertain transmission is durable, blocks blind retry and requires explicit reconciliation', async t => {
  const { store } = await storage(t); let calls = 0;
  const engine = create(t, store, async input => { calls++; input.hooks.dispatched(); input.hooks.receipt('remote-id'); throw new AppError('stream_unconfirmed', 502, true); });
  const id = engine.create(topic, 'uncertain'); let d = await until(() => store.read().discussions.find(d => d.status === 'blocked'));
  engine.kick(); assert.throws(() => engine.control(id, { action: 'resume', expectedRevision: 1 }, 'resume-unsafe'), /reconciliation_required/);
  engine.recover(); assert.equal(calls, 1); assert.equal(d.turns[0].receipt, 'remote-id');
  engine.control(id, { action: 'reconcile', turnId: d.turns[0].id, resolution: 'completed', text: response(d.turns[0].prompt, d.members[0]), receipt: 'verified-conversation-url', expectedRevision: 1 }, 'reconcile');
  d = store.read().discussions[0]; assert.equal(d.status, 'blocked'); assert.equal(d.turns[0].status, 'completed'); assert.equal(calls, 1);
});
test('restart marks journalled work unconfirmed; small request budget reserves comparison and labels partial', async t => {
  const { store } = await storage(t);
  const engine = create(t, store, async input => ({ text: response(input.prompt, input.participant), receipt: 'fixture', usage: null }));
  engine.create({ ...topic, limits: { maxRequests: 6 } }, 'budget'); const d = await until(() => store.read().discussions.find(d => d.status === 'partial'));
  assert.equal(d.used.requests, 6); assert.equal(d.reason, 'budget_exhausted'); assert.equal(d.turns.at(-1).phase, 'summary_review');
  store.transact(s => { const d = s.discussions[0]; d.status = 'running'; d.turns[0].status = 'running'; }); engine.recover(); assert.equal(store.read().discussions[0].status, 'blocked'); assert.equal(store.read().discussions[0].turns[0].status, 'unconfirmed');
});
