import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace, until, topic, response } from './workspace-helpers.mjs';
import { anthropicStream, deepseekStream, coralModel } from './anthropic-fixture.mjs';
import { budget, pacing, reply } from './resident-fixture.mjs';

async function setup(t, extra = {}) {
  const f = await workspace(t, extra, { residentAutoSchedule: false }); const requests = [];
  const handler = value => { f.app.providers.request = async (url, options) => { requests.push({ url, options }); return value(url, options); }; };
  handler((url, options) => url.includes('/models') ? Response.json({ data: [{ id: 'claude-fixture', display_name: 'Claude Fixture' }], has_more: false }) : anthropicStream('first and second'));
  const add = (label = 'Claude', workspaceId = 'wrkspc_fixture') => f.app.addAnthropic({ label, workspaceId, key: 'sk-ant-api-fixture-' + label });
  const input = cid => ({ requestId: crypto.randomUUID(), participant: { id: 'claude', kind: 'anthropic', connectionId: cid, modelId: 'claude-fixture', label: 'Claude', role: '' }, prompt: 'independent prompt', history: [{ role: 'user', content: 'previous question' }, { role: 'assistant', content: 'previous answer' }], signal: AbortSignal.timeout(5000), hooks: { dispatched() {}, receipt() {}, delta() {} } });
  return { ...f, requests, handler, add, input };
}

test('Anthropic per-key/workspace discovery and Messages SSE preserve history, exact whitespace, receipt and cumulative reported/cache usage', async t => {
  const f = await setup(t); const a = await f.add('A'), b = await f.add('B', 'wrkspc_other'); let dispatches = 0, receipt;
  f.handler(() => anthropicStream('', { parts: [' first ', 'and\n second '], usage: { input_tokens: 14, cache_creation_input_tokens: 3, cache_read_input_tokens: 8, output_tokens: 34 } }));
  const result = await f.app.providers.complete({ ...f.input(a), hooks: { dispatched() { dispatches++; }, receipt(id) { receipt = id; }, delta() {} } });
  assert.equal(result.text, ' first and\n second '); assert.equal(result.receipt, 'msg_fixture'); assert.equal(receipt, result.receipt); assert.equal(dispatches, 1); assert.deepEqual(result.usage, { input: 25, output: 34 });
  const last = f.requests.at(-1); assert.equal(last.url, 'https://api.anthropic.com/v1/messages'); assert.equal(last.options.headers.Authorization, 'Bearer sk-ant-api-fixture-A'); assert.equal(last.options.headers['anthropic-workspace-id'], 'wrkspc_fixture'); assert.equal(last.options.headers['anthropic-version'], '2026-10-21'); assert.equal(last.options.redirect, 'error');
  const body = JSON.parse(last.options.body); assert.equal(body.max_tokens, 4096); assert.equal(body.stream, true); assert.deepEqual(body.messages, [...f.input(a).history, { role: 'user', content: 'independent prompt' }]); assert.equal(body.tools, undefined); assert.equal(body.reasoning, undefined);
  assert.equal(f.app.vault.get(b).key, 'sk-ant-api-fixture-B'); assert.doesNotMatch(JSON.stringify(f.app.snapshot()) + JSON.stringify(f.app.store.events(0)), /sk-ant-api-fixture/);
});

test('Anthropic catalog follows bounded same-host cursor pages, deduplicates IDs and never uses a supplied next URL or retired model', async t => {
  const f = await setup(t); let pages = 0; f.handler((url, options) => { pages++; assert.ok(url.startsWith('https://api.anthropic.com/v1/models?limit=100')); assert.equal(options.method, undefined); assert.equal(options.headers['anthropic-workspace-id'], 'wrkspc_fixture');
    return Response.json(pages === 1 ? { data: [{ id: 'claude-one', display_name: 'One' }], has_more: true, last_id: 'claude-one', next_url: 'https://untrusted.example/' } : { data: [{ id: 'claude-one', display_name: 'One' }, { id: 'claude-two', display_name: 'Two' }, { id: 'retired', display_name: 'Retired', lifecycle: 'retired' }], has_more: false }); });
  const cid = await f.add(); assert.equal(pages, 2); assert.ok(f.requests[1].url.includes('after_id=claude-one')); assert.deepEqual(f.app.store.read().connections.find(c => c.id === cid).models.map(m => m.id), ['claude-one', 'claude-two']);
  f.handler(() => Response.json({ data: [{ id: 'loop', display_name: 'Loop' }], has_more: true, last_id: 'loop' })); await assert.rejects(f.app.refreshModels(cid), /invalid_model_catalog/);
});

for (const [status, code, uncertain] of [[401, 'auth_required', false], [403, 'auth_required', false], [429, 'usage_limit', false], [500, 'provider_http_error', true], [529, 'provider_http_error', true]]) test('Anthropic HTTP ' + status + ' sends once, keeps credentials and does not choose another model/account', async t => {
  const f = await setup(t); const cid = await f.add(); let calls = 0; f.handler(() => { calls++; return Response.json({ error: { message: 'private provider details' } }, { status }); });
  await assert.rejects(f.app.providers.complete(f.input(cid)), e => e.code === code && e.uncertain === uncertain); assert.equal(calls, 1); assert.ok(f.app.vault.get(cid));
});

for (const reason of ['max_tokens', 'tool_use', 'refusal', 'pause_turn']) test('Anthropic stop_reason ' + reason + ' never becomes a completed response', async t => {
  const f = await setup(t); const cid = await f.add(); f.handler(() => anthropicStream('partial', { reason })); await assert.rejects(f.app.providers.complete(f.input(cid)), /response_not_completed/);
});

test('Anthropic incomplete/error/malformed streams remain uncertain, ignore non-text reasoning, and never invent usage', async t => {
  const f = await setup(t); const cid = await f.add();
  f.handler(() => anthropicStream('partial', { end: false })); await assert.rejects(f.app.providers.complete(f.input(cid)), e => e.code === 'stream_unconfirmed' && e.uncertain);
  f.handler(() => anthropicStream('', { events: [{ type: 'error', error: { message: 'private text' } }] })); await assert.rejects(f.app.providers.complete(f.input(cid)), /stream_unconfirmed/);
  f.handler(() => new Response('data: not-json\n\n')); await assert.rejects(f.app.providers.complete(f.input(cid)), /stream_unconfirmed/);
  const deltas = []; f.handler(() => anthropicStream('', { events: [
    { type: 'message_start', message: { id: 'msg_thinking', usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private reasoning fixture' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'private signature fixture' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' final answer ' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }, { type: 'message_stop' },
  ] })); const final = await f.app.providers.complete({ ...f.input(cid), hooks: { ...f.input(cid).hooks, delta(text) { deltas.push(text); } } });
  assert.equal(final.text, ' final answer '); assert.deepEqual(deltas, [' final answer ']); assert.deepEqual(final.usage, { input: 5, output: 9 });
  f.handler(() => anthropicStream('answer', { initialUsage: {}, usage: false })); assert.equal((await f.app.providers.complete(f.input(cid))).usage, null);
  f.handler(() => anthropicStream('answer', { initialUsage: { input_tokens: 0 }, usage: { output_tokens: 0 } })); assert.deepEqual((await f.app.providers.complete(f.input(cid))).usage, { input: 0, output: 0 });
  f.handler(() => anthropicStream('answer', { initialUsage: { input_tokens: -1 } })); assert.equal((await f.app.providers.complete(f.input(cid))).usage, null);
});

test('Anthropic owner registration validates workspace/fields, keeps key-specific failures, supports renewal/removal, and rejects foreign Origin', async t => {
  const f = await setup(t); const bad = await f.api('/api/connections/anthropic', { label: 'A', key: 'fixture', workspaceId: 'bad\r\nheader' }); assert.equal(bad.status, 400); assert.equal(f.requests.length, 0);
  assert.equal((await f.api('/api/connections/anthropic', { label: 'A', key: 'fixture', baseUrl: 'https://untrusted.example' })).status, 400); assert.equal((await fetch(f.url + '/api/connections/anthropic', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await f.api('/api/connections/anthropic', { label: 'A', key: 'fixture' }, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  f.handler(() => Response.json({ error: { message: 'This key must include the anthropic-workspace-id header.' } }, { status: 400 })); const cid = await f.app.addAnthropic({ label: 'A', key: 'fixture' }); const failed = f.app.store.read().connections.find(c => c.id === cid); assert.equal(failed.error, 'anthropic_workspace_required'); assert.equal(failed.modelError.httpStatus, 400); assert.ok(f.app.vault.get(cid));
  f.handler(() => Response.json({ data: [{ id: 'claude-fixture', display_name: 'Claude' }] })); await f.app.replaceKey(cid, 'renewed-fixture-key'); assert.equal(f.app.vault.get(cid).key, 'renewed-fixture-key'); assert.equal(f.app.store.read().connections.find(c => c.id === cid).status, 'connected');
  assert.throws(() => f.app.participant({ connectionId: cid, modelId: 'claude-fixture', label: 'Claude', reasoningEffort: 'xhigh' }), /reasoning_requires_supported_model/);
  f.app.removeConnection(cid, 'remove-anthropic'); assert.equal(f.app.vault.get(cid), null); await assert.rejects(f.app.refreshModels(cid), /connection_not_found/);
});

test('Anthropic and DeepSeek Max complete the original structured topic engine with independent histories, then participate in the existing resident loop', async t => {
  const f = await setup(t, { residentEnabled: true }); let claude, deepseek; const sends = [];
  f.handler((url, options) => {
    if (url.includes('anthropic.com') && url.includes('/models')) return Response.json({ data: [{ id: 'claude-fixture', display_name: 'Claude' }] });
    if (url.endsWith('/models')) return Response.json({ data: [coralModel] }); const body = JSON.parse(options.body), anthropic = url.endsWith('/messages'), prompt = body.messages.at(-1).content;
    sends.push({ anthropic, body }); const text = prompt.includes('{"roomId":') ? reply() : response(prompt, { id: anthropic ? claude : deepseek, label: anthropic ? 'Claude' : 'DeepSeek' });
    if (!anthropic) assert.equal(body.reasoning_effort, 'max'); return anthropic ? anthropicStream(text) : deepseekStream(text);
  });
  const a = await f.add(), d = await f.app.addDeepSeek({ label: 'DS', apiService: 'coralbricks', key: 'fixture-DS' }); claude = f.app.participant({ connectionId: a, modelId: 'claude-fixture', label: 'Claude' }); deepseek = f.app.participant({ connectionId: d, modelId: coralModel.id, label: 'DS', reasoningEffort: 'max' });
  const id = f.app.engine.create({ ...topic, participantIds: [claude, deepseek] }, 'mixed'); await until(() => f.app.discussion(id).discussion.status === 'completed', 10000); const discussion = f.app.discussion(id).discussion;
  assert.ok(discussion.turns.some(t => t.participantId === claude && t.receipt === 'msg_fixture')); assert.ok(discussion.turns.filter(t => t.participantId === deepseek).every(t => t.reasoningEffort === 'max')); assert.equal(discussion.used.unknownUsage, 0); assert.equal(discussion.evidence.some(e => e.status === 'observed'), false);
  assert.ok(sends.slice(0, 2).every(s => s.body.messages.length === (s.anthropic ? 1 : 2))); assert.equal(f.app.store.read().jobs.length, 0);
  f.app.configureApiDaily({ expectedVersion: 0, maxRequests: 100, maxTokens: 1000000 }, 'fixture-api-policy');
  const room = f.app.resident.snapshot().rooms[0].id; const control = b => f.app.resident.control(room, { ...b, expectedVersion: f.app.resident.room(room).room.version }, crypto.randomUUID());
  control({ action: 'configure', budgets: budget(Date.now()), pacing }); control({ action: 'set_member', participantId: claude, enabled: true }); control({ action: 'on' }); await f.app.residentRunner.tick(); const turn = f.app.store.read().resident.turns[0]; assert.equal(turn.status, 'completed'); assert.equal(turn.participant.kind, 'anthropic'); assert.equal(turn.reply.text, '공개 원문에 대한 독립적인 재분석');
});
