import test from 'node:test';
import assert from 'node:assert/strict';
import { Providers } from '../dist/server/connections/providers.js';
import { publicAddress, fetchSource } from '../dist/server/connections/sources.js';
import { storage } from './workspace-helpers.mjs';
function stream(events, terminate = true) { const bytes = Buffer.from(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`).join('') + (terminate ? '' : 'data: unfinished'));
  let at = 0; return new Response(new ReadableStream({ pull(controller) { if (at >= bytes.length) { controller.close(); return; } controller.enqueue(bytes.subarray(at, at + 3)); at += 3; } }), { headers: { 'Content-Type': 'text/event-stream' } }); }
async function provider(t, kind, request) { const { store, vault } = await storage(t); store.transact(s => s.connections.push({ id: 'one', kind, label: 'test', status: 'connected', models: [{ id: 'actual-catalog-model', label: '실제 카탈로그' }] })); vault.put('one', { key: 'fixture-secret-key' });
  const providers = new Providers(store, vault, { access: async () => 'fixture-oauth-token' }, { complete: async () => { throw new Error('wrong adapter'); } }, request, 0);
  const seen = { dispatched: 0, receipts: [], deltas: [] }; const input = { requestId: 'request-one', participant: { id: 'member', kind, connectionId: 'one', label: 'p', modelId: 'actual-catalog-model', role: '' },
    prompt: '현재 요청', history: [{ role: 'user', content: '내 이전 질문' }, { role: 'assistant', content: '내 이전 응답' }], signal: AbortSignal.timeout(5000), hooks: { dispatched: () => seen.dispatched++, receipt: id => seen.receipts.push(id), delta: text => seen.deltas.push(text) } };
  return { providers, input, seen };
}
test('OAuth public Responses contract uses owned history and requires actual completed event', async t => {
  const f = await provider(t, 'openai-oauth', async (url, options) => { assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.headers.Authorization, 'Bearer fixture-oauth-token'); const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.input.length, 3); assert.equal(body.input[0].content, '내 이전 질문');
    for (const unsupported of ['temperature', 'max_output_tokens', 'previous_response_id', 'conversation']) assert.equal(unsupported in body, false);
    return stream([{ type: 'response.created', response: { id: 'resp-observed' } }, { type: 'response.output_text.delta', delta: '한글 응답' }, { type: 'response.completed', response: { id: 'resp-observed', status: 'completed', usage: { input_tokens: 11, output_tokens: 7 } } }]); });
  const result = await f.providers.complete(f.input); assert.equal(result.text, '한글 응답'); assert.deepEqual(result.usage, { input: 11, output: 7 }); assert.equal(f.seen.deltas.join(''), '한글 응답');
});
test('DeepSeek requires stop and DONE, and reports real usage; early EOF remains uncertain', async t => {
  const f = await provider(t, 'deepseek', async (url, options) => { assert.equal(url, 'https://api.deepseek.com/chat/completions'); const body = JSON.parse(options.body); assert.equal(body.messages[0].role, 'system'); assert.equal(body.stream_options.include_usage, true);
    return stream([{ id: 'deepseek-id', choices: [{ index: 0, delta: { content: '서로 다른 의견' }, finish_reason: null }] }, { id: 'deepseek-id', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 4 } }, '[DONE]']); });
  const result = await f.providers.complete(f.input); assert.equal(result.text, '서로 다른 의견'); assert.deepEqual(result.usage, { input: 9, output: 4 });
  const early = await provider(t, 'openai-oauth', async () => stream([{ type: 'response.output_text.delta', delta: '완료처럼 보이는 문장' }]));
  await assert.rejects(early.providers.complete(early.input), e => e.code === 'stream_unconfirmed' && e.uncertain);
  const malformed = await provider(t, 'deepseek', async () => stream([{ choices: [{ index: 0, delta: { content: '부분 응답' }, finish_reason: 'stop' }] }], false)); await assert.rejects(malformed.providers.complete(malformed.input));
});
test('model discovery uses provider-specific catalog and never invents available models', async t => {
  const oauth = await provider(t, 'openai-oauth', async url => { assert.equal(url, 'https://api.openai.com/v1/models'); return Response.json({ models: [{ slug: 'visible', display_name: '이름', visibility: 'list' }, { slug: 'hidden', display_name: '숨김', visibility: 'hide' }] }); }); assert.deepEqual(await oauth.providers.models('one'), [{ id: 'visible', label: '이름' }]);
  const deepseek = await provider(t, 'deepseek', async url => { assert.equal(url, 'https://api.deepseek.com/models'); return Response.json({ data: [{ id: 'catalog-model' }] }); }); assert.deepEqual(await deepseek.providers.models('one'), [{ id: 'catalog-model', label: 'catalog-model' }]);
});
test('source reader blocks loopback, private, Tailnet, metadata and transition IPs before HTTP', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '172.16.0.1', '192.168.2.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001::1', '2002::1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true); assert.equal(publicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(fetchSource('http://127.0.0.1/latest/meta-data', AbortSignal.timeout(1000)), /source_address_not_allowed/);
  await assert.rejects(fetchSource('file:///etc/passwd', AbortSignal.timeout(1000)), /source_url_not_allowed/);
});
