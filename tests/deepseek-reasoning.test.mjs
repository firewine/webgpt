import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace, until, topic, response } from './workspace-helpers.mjs';
import { coralModel, deepseekStream } from './anthropic-fixture.mjs';

const catalogs = [
  { service: 'deepseek', row: { id: 'deepseek-flash', name: 'DeepSeek', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } }, source: 'catalog' },
  { service: 'coralbricks', row: coralModel, source: 'catalog' },
  { service: 'river', row: { id: 'deepseek-ai/DeepSeek-V4.1-Flash' }, source: 'provider_docs' },
];
for (const item of catalogs) test('DeepSeek effort ' + item.service + ': actual model capability, explicit depth/off/default and unchanged GPT vocabulary', async t => {
  const f = await workspace(t); const calls = []; f.app.providers.request = async (url, options) => { if (url.endsWith('/models')) return Response.json({ data: [item.row] }); calls.push({ url, body: JSON.parse(options.body) }); return deepseekStream('final answer'); };
  const cid = await f.app.addDeepSeek({ label: item.service, key: 'fixture-only-key', apiService: item.service }); const model = f.app.store.read().connections[0].models[0]; assert.deepEqual(model.reasoningEfforts, ['none', 'low', 'high', 'max']); assert.equal(model.reasoningSource, item.source);
  const pid = f.app.participant({ connectionId: cid, label: 'DeepSeek', modelId: item.row.id }); assert.equal(f.app.store.read().participants.find(p => p.id === pid).reasoningEffort, undefined);
  for (const effort of ['default', 'none', 'low', 'high', 'max']) {
    f.app.participant({ connectionId: cid, label: 'DeepSeek', modelId: item.row.id, reasoningEffort: effort }, pid); const p = f.app.store.read().participants.find(p => p.id === pid); assert.equal(p.reasoningEffort, effort === 'default' ? undefined : effort);
    const result = await f.app.providers.complete({ requestId: crypto.randomUUID(), participant: p, prompt: 'fixture', history: [], signal: AbortSignal.timeout(5000), hooks: { dispatched() {}, receipt() {}, delta() {} } }); assert.equal(result.text, 'final answer'); assert.doesNotMatch(result.text, /private reasoning/); assert.deepEqual(result.usage, { input: 11, output: 22 });
    const body = calls.at(-1).body; assert.equal(body.max_tokens, 4096);
    if (effort === 'default') { assert.equal(body.reasoning_effort, undefined); assert.equal(body.thinking, undefined); }
    else if (item.service === 'deepseek') { assert.deepEqual(body.thinking, { type: effort === 'none' ? 'disabled' : 'enabled' }); assert.equal(body.reasoning_effort, effort === 'none' ? undefined : effort); }
    else { assert.equal(body.reasoning_effort, effort); assert.equal(body.thinking, undefined); }
  }
  for (const invalid of ['xhigh', 'medium', 'ultra', '', null]) assert.throws(() => f.app.participant({ connectionId: cid, modelId: item.row.id, label: 'Invalid', reasoningEffort: invalid }), /invalid_reasoning_effort/);
  assert.equal(calls.length, 5);
});

test('missing/malformed effort capability never invents support; unknown River model is not assigned a preset', async t => {
  const f = await workspace(t); let calls = 0;
  for (const [apiService, row] of [['deepseek', { id: 'deepseek-legacy' }], ['coralbricks', { ...coralModel, reasoning: { supported_efforts: ['unrecognized'], mandatory: true } }], ['river', { id: 'deepseek-ai/unknown-model' }]]) {
    f.app.providers.request = async url => { calls++; assert.ok(url.endsWith('/models')); return Response.json({ data: [row] }); };
    const cid = await f.app.addDeepSeek({ label: 'Unknown capability', key: 'fixture-key', apiService }); const c = f.app.store.read().connections.find(c => c.id === cid); assert.equal(c.models[0].reasoningEfforts, undefined);
    assert.throws(() => f.app.participant({ connectionId: cid, modelId: row.id, label: 'Unknown', reasoningEffort: 'max' }), /reasoning_effort_not_supported/);
    const p = { id: 'bad-stored-participant', kind: 'deepseek', connectionId: cid, modelId: row.id, label: 'Unknown', role: '', reasoningEffort: 'max' };
    await assert.rejects(f.app.providers.complete({ requestId: 'no-send', participant: p, prompt: '', history: [], signal: AbortSignal.timeout(1000), hooks: { dispatched() { assert.fail('unsupported effort dispatched'); }, receipt() {}, delta() {} } }), /reasoning_effort_not_supported/);
  }
  assert.equal(calls, 3);
});

test('a paused topic changes only later DeepSeek turns; default clears explicit override and GPT never inherits max/none', async t => {
  const f = await workspace(t); let release; const held = new Promise(r => { release = r; }); let generations = 0; const sent = [];
  let pid; f.app.providers.request = async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [coralModel] }); const body = JSON.parse(options.body); sent.push(body); if (++generations === 1) await held;
    return deepseekStream(response(body.messages.at(-1).content, { id: pid, label: 'DeepSeek' }));
  };
  const cid = await f.app.addDeepSeek({ label: 'Coral', key: 'fixture-key', apiService: 'coralbricks' }); pid = f.app.participant({ connectionId: cid, modelId: coralModel.id, label: 'DeepSeek', reasoningEffort: 'max' });
  const id = f.app.engine.create({ ...topic, participantIds: [pid, 'fake-a'] }, 'depth-topic'); await until(() => generations === 1); f.app.engine.control(id, { action: 'pause', expectedRevision: 1 }, 'pause');
  assert.throws(() => f.app.engine.control(id, { action: 'configure_participant', participantId: pid, reasoningEffort: 'low', expectedRevision: 1 }, 'unsafe-change'), /participant_settings_require_pause/); release();
  await until(() => f.app.discussion(id).discussion.turns[0]?.status === 'completed'); const original = structuredClone(f.app.discussion(id).discussion.turns[0]); assert.equal(original.reasoningEffort, 'max');
  f.app.engine.control(id, { action: 'configure_participant', participantId: pid, reasoningEffort: 'low', expectedRevision: 1 }, 'change'); f.app.engine.control(id, { action: 'resume', expectedRevision: 1 }, 'resume'); await until(() => f.app.discussion(id).discussion.status === 'completed', 10000);
  assert.deepEqual(f.app.discussion(id).discussion.turns[0], original); assert.ok(f.app.discussion(id).discussion.turns.filter(t => t.participantId === pid).slice(1).every(t => t.reasoningEffort === 'low')); assert.equal(sent[0].reasoning_effort, 'max'); assert.ok(sent.slice(1).every(b => b.reasoning_effort === 'low'));
  f.app.participant({ connectionId: cid, modelId: coralModel.id, label: 'DeepSeek', reasoningEffort: 'default' }, pid); assert.equal(f.app.store.read().participants.find(p => p.id === pid).reasoningEffort, undefined);
  f.app.store.transact(s => s.connections.push({ id: 'gpt', kind: 'openai-oauth', label: 'GPT', status: 'connected', models: [{ id: 'gpt-fixture', label: 'GPT' }] }));
  for (const reasoningEffort of ['max', 'none']) assert.throws(() => f.app.participant({ connectionId: 'gpt', label: 'GPT', modelId: 'gpt-fixture', reasoningEffort }), /invalid_reasoning_effort/);
  const gpt = f.app.participant({ connectionId: 'gpt', label: 'GPT', modelId: 'gpt-fixture' }); assert.equal(f.app.store.read().participants.find(p => p.id === gpt).reasoningEffort, 'xhigh');
});
