import test from 'node:test';
import assert from 'node:assert/strict';
import { Providers } from '../dist/server/connections/providers.js';
import { storage } from './workspace-helpers.mjs';

const services = [{ name: 'legacy', base: 'https://api.deepseek.com' }, { name: 'coralbricks', base: 'https://inference.coralbricks.ai/v1' }, { name: 'river', base: 'https://api.river.ai/v1' }];
async function setup(t, service, request) {
  const f = await storage(t); const modelId = 'deepseek-fixture-' + service.name;
  f.store.transact(s => s.connections.push({ id: 'account', kind: 'deepseek', status: 'connected', label: 'Fixture', models: [{ id: modelId, label: modelId }], ...(service.name !== 'legacy' ? { apiService: service.name } : {}) })); f.vault.put('account', { key: 'key-for-' + service.name });
  const providers = new Providers(f.store, f.vault, { access: () => assert.fail('wrong OAuth') }, { complete: () => assert.fail('wrong browser') }, request);
  const input = { requestId: 'one', participant: { id: 'participant', kind: 'deepseek', connectionId: 'account', modelId, label: 'Fixture', role: '' }, prompt: '다시 검토', history: [{ role: 'user', content: '원래 질문' }, { role: 'assistant', content: '원래 응답' }], signal: AbortSignal.timeout(5000), hooks: { dispatched() {}, receipt() {}, delta() {} } };
  return { ...f, providers, modelId, input };
}
for (const service of services) test('DeepSeek service ' + service.name + ': original key/catalog/history/receipt/usage use only the selected HTTPS endpoint', async t => {
  let f; const requests = []; f = await setup(t, service, async (url, options) => {
    requests.push(url); assert.equal(options.headers.Authorization, 'Bearer key-for-' + service.name); assert.equal(options.redirect, 'error');
    if (url.endsWith('/models')) return Response.json({ data: [{ id: f.modelId }, ...(service.name !== 'legacy' ? [{ id: 'unrelated-model' }] : [])] });
    assert.equal(url, service.base + '/chat/completions'); const body = JSON.parse(options.body); assert.equal(body.model, f.modelId); assert.equal(body.messages[1].content, '원래 질문'); assert.equal(body.messages[2].content, '원래 응답'); assert.equal(body.stream, true);
    const events = [{ id: 'receipt-' + service.name, choices: [{ index: 0, delta: { content: '출처와 반론' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 9 } }, '[DONE]'];
    return new Response(events.map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  assert.deepEqual(await f.providers.models('account'), [{ id: f.modelId, label: f.modelId }]); const result = await f.providers.complete(f.input); assert.equal(result.text, '출처와 반론'); assert.equal(result.receipt, 'receipt-' + service.name); assert.deepEqual(result.usage, { input: 12, output: 9 }); assert.deepEqual(requests, [service.base + '/models', service.base + '/chat/completions']);
  assert.ok(!JSON.stringify(f.store.read()).includes('key-for-'));
});

test('DeepSeek service boundary: arbitrary URL/prototype presets never dispatch a credential and an empty DeepSeek catalog never invents a model', async t => {
  let calls = 0; const f = await setup(t, services[1], async () => { calls++; return Response.json({ data: [{ id: 'another-family' }] }); });
  await assert.rejects(f.providers.models('account'), /deepseek_model_unavailable/); assert.equal(calls, 1);
  for (const value of ['http://127.0.0.1:1', 'https://elsewhere.invalid', '__proto__', 'constructor']) {
    f.store.transact(s => { s.connections[0].apiService = value; });
    await assert.rejects(f.providers.models('account'), /invalid_api_service/); await assert.rejects(f.providers.complete({ ...f.input, hooks: { ...f.input.hooks, dispatched: () => assert.fail('invalid service dispatched') } }), /invalid_api_service/);
  }
  assert.equal(calls, 1);
});
