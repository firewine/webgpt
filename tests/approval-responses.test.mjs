import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import test from 'node:test';
import { startApprovalResponses } from '../src/execution/approval-responses.ts';

const command = 'printf "%s" \'approval fixture $(never-execute)\'\nprintf "한글\\n"';
const cwd = '/tmp/approval fixture';
const execTool = {
  type: 'function', name: 'exec_command', strict: false,
  parameters: { type: 'object', properties: {
    cmd: { type: 'string' }, workdir: { type: 'string' },
    yield_time_ms: { type: 'number' }, max_output_tokens: { type: 'number' },
    sandbox_permissions: { type: 'string' },
  }, required: ['cmd'], additionalProperties: false },
};
const input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Local fixture only.' }] }];
const body = (tools = [execTool]) => ({ model: 'local-fixture', stream: true, tools, input });
async function fixture(t) {
  const server = await startApprovalResponses({ command, cwd });
  t.after(() => server.close());
  assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  return server;
}
function post(server, payload = body(), path = '/responses') {
  return fetch(server.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
}
async function events(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.ok(text.endsWith('\n\n'));
  return text.trim().split('\n\n').map(frame => {
    const [kind, data] = frame.split('\n');
    const value = JSON.parse(data.slice('data: '.length));
    assert.equal(kind, `event: ${value.type}`);
    return value;
  });
}
function raw(server, { path = '/responses', method = 'POST', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(server.baseUrl + path, { method, headers, agent: false }, response => {
      const parts = [];
      response.on('data', part => parts.push(part));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(parts).toString('utf8') }));
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('local HTTP timeout')));
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}
const output = (callId = 'call_approval_fixture') => ({ type: 'function_call_output', call_id: callId, output: 'local result' });

test('emits the pinned native SSE protocol, one declared command, then a short assistant message', async t => {
  const server = await fixture(t);
  const firstBody = body([{ type: 'function', name: 'unrelated_tool' }, execTool]);
  const first = await events(await post(server, firstBody));
  assert.deepEqual(first.map(event => event.type), ['response.created', 'response.output_item.done', 'response.completed']);
  const call = first[1].item;
  assert.deepEqual(call, { type: 'function_call', call_id: 'call_approval_fixture', name: 'exec_command',
    arguments: JSON.stringify({ cmd: command, workdir: cwd, yield_time_ms: 1000, max_output_tokens: 2000 }) });
  assert.equal(first[0].response.id, first[2].response.id);
  assert.equal(first[2].response.usage.total_tokens, 0);
  const secondBody = { ...firstBody, previous_response_id: first[2].response.id, input: [...input, call, output(call.call_id)] };
  const second = await events(await post(server, secondBody, '/v1/responses'));
  assert.deepEqual(second.map(event => event.type), first.map(event => event.type));
  assert.equal(second[1].item.type, 'message');
  assert.equal(second[1].item.role, 'assistant');
  assert.equal(second[1].item.content[0].text, 'Fixture complete.');
  assert.notEqual(first[0].response.id, second[0].response.id);
  assert.equal(second[0].response.id, second[2].response.id);
  assert.equal((await post(server)).status, 429);
  assert.deepEqual(server.requests, [firstBody, secondBody]);
});

test('adversarial mode emits only fixed native escalation arguments and never executes them', async t => {
  const server = await startApprovalResponses({ command, cwd, requestEscalation: true }); t.after(() => server.close());
  const first = await events(await post(server)), args = JSON.parse(first[1].item.arguments);
  assert.equal(args.cmd, command); assert.equal(args.workdir, cwd); assert.equal(args.sandbox_permissions, 'require_escalated');
  assert.equal(args.justification, 'Synthetic containment probe only.');
  await assert.rejects(startApprovalResponses({ command, cwd, requestEscalation: 'yes' }), /invalid_approval_responses_config/);
});

test('uses a declared namespace and prefers exec_command over shell_command', async t => {
  const server = await fixture(t);
  const tool = { type: 'namespace', name: 'functions', tools: [execTool] };
  const shell = { type: 'function', name: 'shell_command' };
  const first = await events(await post(server, body([shell, tool]), '/v1/responses'));
  assert.equal(first[1].item.name, 'exec_command');
  assert.equal(first[1].item.namespace, 'functions');
  const second = await events(await post(server, { ...body([shell, tool]), input: [output()] }));
  assert.equal(second[1].item.type, 'message');
});

test('shell_command fallback uses only its declared command and working directory', async t => {
  const server = await fixture(t);
  const shell = { type: 'function', name: 'shell_command', parameters: { type: 'object', properties: {
    command: { type: 'string' }, workdir: { type: 'string' }, timeout_ms: { type: 'number' },
  }, required: ['command'], additionalProperties: false } };
  const first = await events(await post(server, body([shell])));
  assert.equal(first[1].item.name, 'shell_command');
  assert.deepEqual(JSON.parse(first[1].item.arguments), { command, workdir: cwd });
});

test('overlapping first requests cannot emit a second command call', async t => {
  const server = await fixture(t);
  const responses = await Promise.all([post(server), post(server)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  const first = await events(responses.find(response => response.status === 200));
  assert.equal(first.filter(event => event.item?.type === 'function_call').length, 1);
  assert.equal((await events(await post(server, { ...body(), input: [output()] })))[1].item.type, 'message');
});

test('rejects a missing or mismatched command output and changed tools without advancing', async t => {
  const server = await fixture(t);
  await events(await post(server));
  for (const next of [body(), { ...body(), input: [output('wrong-call')] },
    { ...body([{ type: 'namespace', name: 'other', tools: [execTool] }]), input: [output()] }]) {
    const response = await post(server, next);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'expected_command_output');
  }
  assert.equal((await events(await post(server, { ...body(), input: [output()] })))[1].item.type, 'message');
});

test('unknown routes, proxy-style targets and methods are rejected without consuming the command', async t => {
  const server = await fixture(t);
  for (const path of ['/', '/v1/models', '/responses?query=1', '/v1/responses/']) {
    const response = await post(server, body(), path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'unknown_route');
  }
  const response = await raw(server, { method: 'GET' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'POST');
  const proxy = await new Promise((resolve, reject) => {
    const request = httpRequest(server.baseUrl, { method: 'POST', path: 'http://127.0.0.1:1/responses', agent: false }, result => {
      result.resume(); result.on('end', () => resolve(result.statusCode));
    });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(proxy, 404);
  assert.deepEqual(server.requests, []);
  await events(await post(server));
});

test('malformed JSON, non-object bodies and unsupported request configurations fail closed', async t => {
  const server = await fixture(t);
  assert.equal((await raw(server, { chunks: ['{'] })).status, 400);
  for (const payload of [null, [], { ...body(), stream: false }, { ...body(), input: 'text' },
    { ...body(), tool_choice: 'none' }, { ...body(), tool_choice: { type: 'function', name: 'other' } }]) {
    assert.equal((await post(server, payload)).status, 400);
  }
  await events(await post(server));
});

test('unsupported or ambiguous tool declarations and schemas are rejected', async t => {
  const invalid = [
    [], [{ type: 'function', name: 'shell' }], [execTool, execTool], [{ ...execTool, type: 'custom' }],
    [{ ...execTool, parameters: { type: 'object', properties: {}, required: ['cmd'] } }],
    [{ ...execTool, parameters: { ...execTool.parameters, required: ['cmd', 'sandbox_permissions'] } }],
    [{ ...execTool, parameters: { ...execTool.parameters, properties: { ...execTool.parameters.properties,
      workdir: { type: 'number' } } } }],
    [{ ...execTool, parameters: { ...execTool.parameters, allOf: [] } }],
    [{ ...execTool, parameters: { ...execTool.parameters, properties: { ...execTool.parameters.properties,
      cmd: { type: 'string', enum: ['other command'] } } } }],
    [{ type: 'namespace', name: 'invalid.name', tools: [execTool] }],
    [{ type: 'namespace', tools: [execTool] }],
    [{ ...execTool, defer_loading: true }],
    null,
  ];
  for (const [index, tools] of invalid.entries()) await t.test(`unsupported declaration ${index + 1}`, async t => {
    const server = await fixture(t);
    const response = await post(server, body(tools));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.code, /^unsupported_/);
    await events(await post(server));
  });
});

test('caps declared and chunked UTF-8 bodies at two MiB and rejects encoded bodies', async t => {
  const server = await fixture(t);
  const declared = await raw(server, { headers: { 'Content-Length': 2 * 1024 * 1024 + 1 } });
  assert.equal(declared.status, 413);
  const chunked = await raw(server, { chunks: ['{"padding":"', '한'.repeat(Math.ceil(2 * 1024 * 1024 / 3)), '"}'] });
  assert.equal(chunked.status, 413);
  assert.equal(JSON.parse(chunked.body).error.code, 'body_too_large');
  assert.equal((await raw(server, { headers: { 'Content-Encoding': 'gzip' }, chunks: ['{}'] })).status, 415);
  assert.deepEqual(server.requests, []);
  await events(await post(server));
});

test('limits all HTTP requests and retained request history', async t => {
  const server = await fixture(t);
  for (let i = 0; i < 8; i++) assert.equal((await post(server, { ...body(), tools: [] })).status, 400);
  assert.equal(server.requests.length, 8);
  const response = await post(server);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'fixture_exhausted');
  assert.equal(server.requests.length, 8);
});

test('close is idempotent and clears keep-alive, idle and unfinished HTTP sockets', async t => {
  const server = await fixture(t);
  await events(await post(server));
  const sockets = [connect(new URL(server.baseUrl).port, '127.0.0.1'), connect(new URL(server.baseUrl).port, '127.0.0.1')];
  t.after(() => sockets.forEach(socket => socket.destroy()));
  await Promise.all(sockets.map(socket => once(socket, 'connect')));
  const errors = [];
  const closed = sockets.map(socket => new Promise(resolve => {
    socket.on('error', error => errors.push(error));
    socket.once('close', resolve);
  }));
  sockets[1].write('POST /responses HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{');
  await Promise.all([server.close(), server.close(), ...closed]);
  await server.close();
  assert.ok(errors.every(error => error.code === 'ECONNRESET'));
  await assert.rejects(raw(server), error => error.code === 'ECONNREFUSED');
});

test('invalid startup options never create a listener', async () => {
  for (const config of [null, {}, { command: '', cwd }, { command: '  ', cwd }, { command: 'x\0y', cwd },
    { command: 'x'.repeat(65_537), cwd }, { command, cwd: 'relative' }, { command, cwd: '/tmp/\0x' },
    { command, cwd, baseUrl: 'http://127.0.0.1:1' }]) {
    await assert.rejects(startApprovalResponses(config), /invalid_approval_responses_config/);
  }
});
