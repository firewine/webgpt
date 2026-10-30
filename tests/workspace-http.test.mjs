import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { workspace, ownerKey, topic, until } from './workspace-helpers.mjs';
test('owner authentication, Host and Origin policy protect all state and mutations', async t => {
  const f = await workspace(t); assert.equal((await fetch(`${f.url}/`)).status, 200); assert.equal((await fetch(`${f.url}/api/state`)).status, 401);
  const hostStatus = await new Promise((resolve, reject) => { const req = request(`${f.url}/api/state`, { headers: { Host: 'attacker.example', Authorization: `Bearer ${ownerKey}` } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(`${f.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ token: ownerKey }) })).status, 403);
  const login = await fetch(`${f.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.url }, body: JSON.stringify({ token: ownerKey }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0]; assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(`${f.url}/api/state`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${f.url}/api/discussions`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(topic) })).status, 403);
  const state = await (await f.api('/api/state')).json(); assert.equal('sessions' in state, false); assert.doesNotMatch(JSON.stringify(state), new RegExp(ownerKey));
});
test('SSE replay uses durable cursors and closing a client never cancels a discussion', async t => {
  const f = await workspace(t); const start = await (await f.api('/api/discussions', topic, { headers: { 'Idempotency-Key': 'same-create' } })).json();
  const again = await (await f.api('/api/discussions', topic, { headers: { 'Idempotency-Key': 'same-create' } })).json(); assert.equal(start.id, again.id);
  const abort = new AbortController(); const stream = await f.api('/api/events?after=0', undefined, { signal: abort.signal }); assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const reader = stream.body.getReader(); let chunk = new TextDecoder().decode((await reader.read()).value); assert.match(chunk, /connected/); if (!chunk.includes('id: ')) chunk += new TextDecoder().decode((await reader.read()).value); assert.match(chunk, /event: change/);
  abort.abort(); await reader.cancel().catch(() => {}); await until(() => f.app.store.read().discussions[0].status === 'completed');
  const d = (await (await f.api(`/api/discussions/${start.id}`)).json()).discussion; assert.equal(d.turns.length, 12);
  assert.equal((await f.api('/api/events?after=999999')).status, 409);
});
test('browser connection saves its side-chat guard and rejects changing the registered thread', async t => {
  const f = await workspace(t); let probed;
  f.app.browser.probe = async binding => { probed = binding; };
  const binding = { pageId: 7, url: 'https://muse.ai/', accountLabel: 'fixture account', agentLabel: 'fixture agent', identitySelector: '#identity', identityText: 'fixture', inputSelector: '#input', sendSelector: '#send', userSelector: '.user', assistantSelector: '.assistant', busySelector: '#busy', readySelector: '#ready', sendAppearsAfterInput: true,
    thread: { selector: '[data-thread]', attribute: 'data-thread', jsonKey: 'thread_id', value: 'thread-a' } };
  const response = await f.api('/api/connections/browser', { label: 'side chat', binding }); assert.equal(response.status, 201);
  const { id } = await response.json(); assert.deepEqual(probed.thread, binding.thread); assert.equal(probed.sendAppearsAfterInput, true);
  const state = await (await f.api('/api/state')).json(); const saved = state.connections.find(c => c.id === id);
  assert.deepEqual(saved.browser.thread, binding.thread);
  assert.equal((await f.api('/api/connections/browser', { connectionId: id, label: 'same chat', binding: { ...binding, pageId: 8 } })).status, 201);
  assert.equal((await f.api('/api/connections/browser', { connectionId: id, label: 'different chat', binding: { ...binding, thread: { ...binding.thread, value: 'thread-b' } } })).status, 409);
  const { thread, ...withoutThread } = binding;
  assert.equal((await f.api('/api/connections/browser', { connectionId: id, label: 'remove guard', binding: withoutThread })).status, 409);
  assert.equal((await f.api('/api/connections/browser', { label: 'invalid', binding: { ...binding, sendAppearsAfterInput: 'true' } })).status, 400);
});
test('MCP bearer grants are independent of owner keys and cannot cross participant scope', async t => {
  const f = await workspace(t); f.app.engine.create(topic, 'mcp-topic'); f.app.engine.control(f.app.store.read().discussions[0].id, { action: 'pause', expectedRevision: 1 }, 'pause-mcp');
  const d = f.app.store.read().discussions[0]; const grant = await (await f.api('/api/grants', { discussionId: d.id, participantId: 'fake-a', tools: ['task_get', 'context_get', 'result_submit'] })).json();
  const call = (method, params = {}, token = grant.token) => f.api('/mcp', { jsonrpc: '2.0', id: 1, method, params }, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await call('tools/list', {}, ownerKey)).status, 401); const own = await (await call('tools/call', { name: 'task_get', arguments: {} })).json(); assert.equal(own.result.isError, false);
  const data = JSON.parse(own.result.content[0].text); const context = await (await call('tools/call', { name: 'context_get', arguments: { taskId: data.task.id } })).json(); assert.ok(!JSON.parse(context.result.content[0].text).prompt.includes('모의 참여자 B의'));
  const other = d.tasks.find(t => t.participantId === 'fake-b'); const forbidden = await (await call('tools/call', { name: 'context_get', arguments: { taskId: other.id } })).json(); assert.equal(forbidden.result.isError, true);
  const first = await (await call('tools/call', { name: 'result_submit', arguments: { taskId: data.task.id, requestId: 'submission', text: '보고된 의견' } })).json(); const second = await (await call('tools/call', { name: 'result_submit', arguments: { taskId: data.task.id, requestId: 'submission', text: '보고된 의견' } })).json(); assert.deepEqual(first, second); assert.equal(f.app.store.read().discussions[0].evidence[0].status, 'reported');
  await f.api('/api/grants/revoke', { id: grant.id }); assert.equal((await call('tools/list')).status, 401);
});
test('noVNC HTTP and WebSocket require owner policy and manual lease; upstream gets no credential', async t => {
  const upstream = createServer((_req, res) => res.end('display fixture')); let upstreamHeaders;
  upstream.on('upgrade', (req, socket) => { upstreamHeaders = req.headers; socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: fixture\r\n\r\n'); socket.end(); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); t.after(() => upstream.close());
  const f = await workspace(t, { noVncPort: upstream.address().port }); assert.equal((await f.api('/browser/vnc.html')).status, 403); await f.api('/api/browser/control', { paused: true }); assert.equal(await (await f.api('/browser/vnc.html')).text(), 'display fixture');
  const upgrade = headers => new Promise((resolve, reject) => { const req = request(`${f.url}/browser/websockify`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'fixture', 'Sec-WebSocket-Version': '13', ...headers } }); req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); }); req.on('response', res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(await upgrade({ Origin: f.url }), 403); assert.equal(await upgrade({ Origin: 'https://evil.example', Authorization: `Bearer ${ownerKey}` }), 403);
  assert.equal(await upgrade({ Origin: f.url, Authorization: `Bearer ${ownerKey}`, Cookie: 'private-cookie' }), 101); assert.equal(upstreamHeaders.authorization, undefined); assert.equal(upstreamHeaders.cookie, undefined);
});
