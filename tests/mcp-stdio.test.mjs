import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const failure = id => ({ jsonrpc: '2.0', id, error: { code: -32603,
  message: 'MCP request not confirmed; inspect the durable workspace before retrying.' } });
const pong = id => ({ jsonrpc: '2.0', id, result: {} });
const ping = id => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' });
const submit = (text, id) => JSON.stringify({ jsonrpc: '2.0', method: 'tools/call',
  params: { name: 'dot_turn_submit', arguments: { text } }, ...(id === undefined ? {} : { id }) });
function sizedRequest(bytes, id, character = '가') {
  const remaining = bytes - Buffer.byteLength(submit('', id));
  const width = Buffer.byteLength(character);
  const line = submit(character.repeat(Math.floor(remaining / width)) + 'x'.repeat(remaining % width), id);
  assert.equal(Buffer.byteLength(line), bytes); return line;
}

// Only an ephemeral loopback mock and a private, synthetic grant; no workspace server.
async function runBridge(t, lines, { keepStdinOpen = false, trace, respond, preload, readStderr = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-mcp-stdio-'));
  const token = 'fixture_stdio_grant_never_used_outside_tests';
  const grant = join(directory, 'grant');
  let child, closed;
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8'), message = JSON.parse(body);
    requests.push({ body, message, path: req.url, method: req.method, authorization: req.headers.authorization });
    if (message.method === 'fixture/disconnect') { req.socket.destroy(); return; }
    if (message.method === 'fixture/http-failure') { res.writeHead(503); res.end('private upstream detail'); return; }
    if (message.method === 'fixture/invalid-json') { res.end('private invalid JSON'); return; }
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    if (respond) { respond(message, res); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(pong(message.id)));
  });
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    child?.stderr.resume();
    if (closed) await closed;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(grant, token, { mode: 0o600 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const args = [];
  if (preload) { const path = join(directory, 'preload.mjs'); await writeFile(path, preload); args.push('--import', path); }
  child = spawn(process.execPath, [...args, fileURLToPath(new URL('../scripts/mcp-stdio.mjs', import.meta.url))], {
    env: { WJ_PORT: String(server.address().port), WJ_MCP_GRANT_FILE: grant, ...(trace === undefined ? {} : { WJ_MCP_TRACE: trace }) }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  closed = once(child, 'close');
  const exited = readStderr ? null : once(child, 'exit', { signal: AbortSignal.timeout(8000) });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  const collectStderr = chunk => { stderr += chunk; };
  if (readStderr) child.stderr.on('data', collectStderr);
  else child.stderr.once('data', chunk => { collectStderr(chunk); child.stderr.pause(); });
  child.stdin.on('error', () => {}); // A deliberate bridge close may interrupt the test writer.
  child.stdin.write(lines.join('\n') + '\n');
  if (!keepStdinOpen) child.stdin.end();
  if (!readStderr) { try { await exited; } finally {
    child.stderr.removeAllListeners('data'); child.stderr.on('data', collectStderr); child.stderr.resume();
  } }
  const [code, signal] = await closed;
  assert.equal(signal, null); if (trace !== 'summary') assert.equal(stderr, '');
  for (const request of requests) {
    assert.equal(request.path, '/mcp'); assert.equal(request.method, 'POST');
    assert.equal(request.authorization, 'Bearer ' + token);
    assert.ok(Buffer.byteLength(request.body) <= 256_000, 'oversized input must never be forwarded');
  }
  return { code, stdout, stderr, replies: stdout.trim() ? stdout.trim().split('\n').map(line => JSON.parse(line)) : [], requests };
}

test('stdio: multibyte reply gets its own error ID and the next ping still works', { timeout: 10_000 }, async t => {
  const ascii = submit('a'.repeat(90_011), 40), multibyte = submit('가'.repeat(90_011), 41);
  assert.equal(ascii.length, multibyte.length);
  assert.ok(multibyte.length < 256_000); assert.ok(Buffer.byteLength(multibyte) > 256_000);
  const result = await runBridge(t, [ascii, multibyte, ping(42)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [pong(40), failure(41), pong(42)]);
  assert.deepEqual(result.requests.map(r => r.body), [ascii, ping(42)]);
});

test('stdio: the forwarding boundary remains exactly 256000 UTF-8 bytes', { timeout: 10_000 }, async t => {
  const below = sizedRequest(255_999, 1), at = sizedRequest(256_000, 2), over = sizedRequest(256_001, 3);
  const result = await runBridge(t, [below, at, over, ping(4)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [pong(1), pong(2), failure(3), pong(4)]);
  assert.deepEqual(result.requests.map(r => r.body), [below, at, ping(4)]);
});

test('stdio: correlation uses the top-level string or integer ID, including escaped keys', { timeout: 10_000 }, async t => {
  const ids = [0, -7, '', 'reply-"\\\n한'];
  const lines = ids.map(id => JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: {
    id: 999, nested: [{ id: 'wrong' }], text: '가'.repeat(90_011) + ' "id":123 ',
  }, id }));
  lines.push(sizedRequest(256_001, 9).replace('"id":9', '"\\u0069d":9'));
  const result = await runBridge(t, [...lines, ping(10)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [...ids.map(failure), failure(9), pong(10)]);
  assert.deepEqual(result.requests.map(r => r.body), [ping(10)]);
});

test('stdio: oversized and ordinary notifications never receive an error response', { timeout: 10_000 }, async t => {
  const oversized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {
    id: 'nested-is-not-a-request-id', progressToken: 'fixture', progress: 1, message: '가'.repeat(90_011),
  } });
  const ordinary = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const failed = JSON.stringify({ jsonrpc: '2.0', method: 'fixture/disconnect' });
  const result = await runBridge(t, [oversized, ordinary, failed, ping(42)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [pong(42)]);
  assert.deepEqual(result.requests.map(r => r.body), [ordinary, failed, ping(42)]);
});

test('stdio: malformed JSON produces a bounded parse error without guessing a nested or partial ID', { timeout: 10_000 }, async t => {
  const malformed = '{"jsonrpc":"2.0","id":41,"params":{"id":99,"text":"' + '가'.repeat(90_011);
  const result = await runBridge(t, [malformed, '{"id":2,', ping(42)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [
    { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
    { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, pong(42),
  ]);
  assert.ok(Buffer.byteLength(result.stdout) < 500); assert.deepEqual(result.requests.map(r => r.body), [ping(42)]);
});

test('stdio: invalid IDs and non-request JSON never get reflected as response IDs', { timeout: 10_000 }, async t => {
  const ids = [{ private: 'must-not-be-reflected', id: 41 }, [41], true, null, 1.5];
  const lines = ids.map(id => sizedRequest(256_001, id));
  lines.push(JSON.stringify([{ jsonrpc: '2.0', id: 41, method: 'ping', params: { text: '가'.repeat(90_011) } }]));
  lines.push(JSON.stringify({ params: { id: 41, text: '가'.repeat(90_011) } }));
  const result = await runBridge(t, [...lines, ping(42)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [...lines.map(() => failure(null)), pong(42)]);
  assert.deepEqual(result.requests.map(r => r.body), [ping(42)]);
});

test('stdio: ordinary transport failures retain the existing error contract and processing continues', { timeout: 10_000 }, async t => {
  const methods = ['fixture/disconnect', 'fixture/http-failure', 'fixture/invalid-json'];
  const lines = methods.map((method, id) => JSON.stringify({ jsonrpc: '2.0', id, method }));
  const result = await runBridge(t, [...lines, ping(42)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [...methods.map((_, id) => failure(id)), pong(42)]);
  assert.deepEqual(result.requests.map(r => r.body), [...lines, ping(42)]);
});

test('stdio: the bounded inspection limit still recovers an ID at the end of a request', { timeout: 10_000 }, async t => {
  const result = await runBridge(t, [sizedRequest(1_024_000, 41), ping(42)]);
  assert.equal(result.code, 0); assert.deepEqual(result.replies, [failure(41), pong(42)]);
  assert.deepEqual(result.requests.map(r => r.body), [ping(42)]);
});

for (const kind of ['request', 'notification', 'malformed']) {
  test('stdio: input beyond the inspection budget closes promptly without replying or forwarding: ' + kind, { timeout: 10_000 }, async t => {
    let line = sizedRequest(1_024_001, kind === 'notification' ? undefined : 41, kind === 'request' ? 'x' : '가');
    if (kind === 'malformed') line = line.slice(0, -1) + '!';
    assert.ok(Buffer.byteLength(line) > 1_024_000);
    const result = await runBridge(t, [line, ping(42)], { keepStdinOpen: true });
    assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.deepEqual(result.requests, []);
  });
}

test('stdio: optional observations preserve byte-identical RPC output and forwarded requests for success and failures', { timeout: 10_000 }, async t => {
  const privateText = 'fixture-secret-token-original-email@example.invalid';
  const call = (id, name, extra = {}) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name,
    arguments: { requestId: 'turn-' + privateText, attemptToken: privateText, commandId: privateText, text: privateText, ...extra } } });
  const lines = [call(1, 'dot_turn_get'), ...[0, 1, 2].map((inputPage, i) => call(i + 2, 'dot_turn_get', { inputPage })),
    call(5, 'dot_turn_claim'), call(6, 'dot_turn_submit'), call(7, 'dot_turn_get'), call(8, 'dot_turn_get'),
    sizedRequest(256_001, 9), '{bad-json', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'fixture/disconnect' }), JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'fixture/invalid-json' })];
  const respond = (message, res) => {
    if ([7, 8].includes(message.id)) { res.writeHead(message.id === 7 ? 401 : 429); res.end(privateText); return; }
    const inputPage = message.params.arguments.inputPage;
    const value = { request: { requestId: 'turn-' + privateText, input: { pageIndex: inputPage, pageCount: 3, text: privateText } } };
    res.end(JSON.stringify(message.id === 6 ? { jsonrpc: '2.0', id: 6, error: { code: -32602, message: 'dot_request_stale', data: privateText } }
      : { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }));
  };
  const off = await runBridge(t, lines, { respond }), on = await runBridge(t, lines, { respond, trace: 'summary' });
  assert.equal(on.code, off.code); assert.equal(on.stdout, off.stdout); assert.deepEqual(on.requests, off.requests);
  const records = on.stderr.trim().split('\n').map(JSON.parse), ends = records.filter(v => v.phase === 'end');
  assert.equal(records.length, lines.length * 2);
  assert.deepEqual(ends.slice(1, 4).map(v => [v.inputPage, v.pageIndex, v.pageCount]), [[0, 0, 3], [1, 1, 3], [2, 2, 3]]);
  assert.equal(ends[5].outcome, 'rpc_error'); assert.equal(ends[5].errorKind, 'dot_request_stale');
  assert.deepEqual(ends.slice(6, 8).map(v => v.httpStatus), [401, 429]);
  assert.deepEqual(ends.slice(8).map(v => v.outcome), ['request_too_large', 'parse_error', 'notification', 'transport_error', 'invalid_json']);
  assert.ok(!on.stderr.includes(privateText)); assert.ok(!on.stderr.includes('fixture_stdio_grant'));
});

test('stdio: timeout is classified without waiting or retrying, and broken stderr cannot change RPC output', { timeout: 10_000 }, async t => {
  const result = await runBridge(t, [ping(1)], { trace: 'summary', preload: "globalThis.fetch = async () => { throw new DOMException('private timeout detail', 'TimeoutError'); };" });
  assert.deepEqual(result.replies, [failure(1)]); assert.equal(result.requests.length, 0);
  assert.equal(JSON.parse(result.stderr.trim().split('\n').at(-1)).outcome, 'timeout');
  assert.doesNotMatch(result.stderr, /private timeout detail/);
  // fetch's body reader can report AbortError while the original deadline's
  // reason is TimeoutError; do not misclassify that as malformed JSON.
  const bodyTimeout = await runBridge(t, [ping(4)], { trace: 'summary', preload: `
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException('private deadline', 'TimeoutError'));
    globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => { throw new DOMException('private body detail', 'AbortError'); } });` });
  assert.deepEqual(bodyTimeout.replies, [failure(4)]); assert.equal(bodyTimeout.requests.length, 0);
  const timed = JSON.parse(bodyTimeout.stderr.trim().split('\n').at(-1));
  assert.equal(timed.outcome, 'timeout'); assert.equal(timed.httpStatus, 200);
  assert.doesNotMatch(bodyTimeout.stderr, /private deadline|private body detail/);
  const broken = await runBridge(t, [ping(2)], { trace: 'summary', preload: "import { closeSync } from 'node:fs'; closeSync(2);" });
  assert.deepEqual(broken.replies, [pong(2)]); assert.equal(broken.requests.length, 1); assert.equal(broken.stderr, '');
  const unknown = await runBridge(t, [ping(3)], { trace: 'true' }); assert.equal(unknown.stderr, '');
});

test('stdio: a stalled diagnostic reader cannot keep the process alive after all RPC replies finish', { timeout: 10_000 }, async t => {
  // Read the first chunk to confirm tracing, then pause the reader until exit.
  // Reading nothing would let Node's exit cleanup discard all buffered evidence.
  const lines = Array.from({ length: 3000 }, (_, id) => ping(id));
  const preload = `globalThis.fetch = async (_url, { body }) => ({ status: 200, ok: true,
    json: async () => ({ jsonrpc: '2.0', id: JSON.parse(body).id, result: {} }) });`;
  const off = await runBridge(t, lines, { preload, readStderr: false });
  const on = await runBridge(t, lines, { preload, readStderr: false, trace: 'summary' });
  assert.equal(on.code, 0); assert.equal(on.stdout, off.stdout); assert.equal(on.replies.length, lines.length);
  assert.equal(on.requests.length, 0); assert.ok(on.stderr.includes('mcp.call_observation'));
});
