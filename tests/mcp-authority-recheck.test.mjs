import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { McpEndpoint } from '../dist/server/http/mcp.js';
import { workspace, topic, until } from './workspace-helpers.mjs';

const tools = ['task_get', 'context_get', 'result_submit', 'capabilities_get', 'codex_send', 'codex_status', 'codex_result', 'codex_cancel'];
const message = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const authError = error => error.code === 'mcp_authentication_required' && error.status === 401;
async function fixture(t) {
  const f = await workspace(t); f.app.engine.kick = () => {};
  f.app.engine.create(topic, crypto.randomUUID());
  f.app.store.transact(s => { s.discussions[0].executionBindingId = 'fixture-binding'; });
  const d = f.app.store.read().discussions[0], taskId = d.tasks.find(task => task.participantId === 'fake-a').id;
  const mcp = new McpEndpoint(f.app), access = mcp.createGrant({ discussionId: d.id, participantId: 'fake-a', tools });
  const captured = mcp.grant('Bearer ' + access.token);
  const revoke = async () => { assert.equal((await f.api('/api/grants/revoke', { id: access.id })).status, 200); };
  return { ...f, mcp, access, captured, taskId, revoke };
}

test('a captured general grant cannot read or cause effects after owner revocation', async t => {
  const f = await fixture(t); let submitted = 0, cancelled = 0;
  f.app.codex.submit = () => { submitted++; throw Error('unexpected dispatch'); };
  f.app.codex.cancel = async () => { cancelled++; };
  await f.revoke(); const before = f.app.store.read();
  await assert.rejects(f.mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, f.captured), authError);
  for (const name of tools) await assert.rejects(f.mcp.handle(message(name, {
    taskId: f.taskId, jobId: 'private-job', requestId: 'revoked-result', text: 'must not be published', prompt: 'must not execute',
  }), f.captured), authError);
  assert.deepEqual(f.app.store.read(), before); assert.equal(submitted, 0); assert.equal(cancelled, 0);
});

test('revocation denies an old grant before a cached result receipt can be returned', async t => {
  const f = await fixture(t), input = message('result_submit', { taskId: f.taskId, requestId: 'same', text: 'one reported result' });
  const first = await f.mcp.handle(input, f.captured); assert.equal(first.result.isError, false);
  assert.deepEqual(await f.mcp.handle(input, f.captured), first);
  assert.equal(f.app.store.read().discussions[0].evidence.length, 1);
  await f.revoke(); const before = f.app.store.read();
  await assert.rejects(f.mcp.handle(input, f.captured), authError);
  assert.deepEqual(f.app.store.read(), before);
});

test('a changed general grant identity, scope or tools cannot use a previously captured authority', async t => {
  for (const change of [g => { g.hash = 'replaced-hash'; }, g => { g.discussionId = 'foreign'; },
    g => { g.participantId = 'fake-b'; }, g => { g.tools = ['task_get']; }]) {
    const f = await fixture(t); f.app.store.transact(s => change(s.grants.find(g => g.id === f.access.id)));
    const before = f.app.store.read();
    await assert.rejects(f.mcp.handle(message('result_submit', { taskId: f.taskId, requestId: 'scope-change', text: 'must not publish' }), f.captured), authError);
    assert.deepEqual(f.app.store.read(), before);
  }
});

test('result mutation rechecks current authority within the state transaction', async t => {
  const f = await fixture(t), transact = f.app.store.transact.bind(f.app.store); let intercepted = false;
  f.app.store.transact = (callback, command) => {
    if (!intercepted && command?.id === `mcp:${f.access.id}:race`) {
      intercepted = true;
      transact(s => { s.grants.find(g => g.id === f.access.id).revoked = true; });
    }
    return transact(callback, command);
  };
  const response = await f.mcp.handle(message('result_submit', { taskId: f.taskId, requestId: 'race', text: 'must not publish' }), f.captured);
  assert.equal(intercepted, true); assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /mcp_authentication_required/);
  assert.equal(f.app.store.read().discussions[0].evidence.length, 0);
});

test('an asynchronous capability result is withheld when its grant is revoked while waiting', async t => {
  const f = await fixture(t); let release, entered = false;
  f.app.capabilities = async () => { entered = true; await new Promise(resolve => { release = resolve; }); return { secret: 'fixture-capability-must-not-leak' }; };
  const pending = f.mcp.handle(message('capabilities_get'), f.captured);
  await until(() => entered); await f.revoke(); release(); const response = await pending;
  assert.equal(response.result.isError, true); assert.doesNotMatch(JSON.stringify(response), /fixture-capability-must-not-leak/);
  assert.match(response.result.content[0].text, /mcp_authentication_required/);
});

test('HTTP body waiting does not preserve authority after a separate owner revocation', async t => {
  const f = await fixture(t), original = McpEndpoint.prototype.grant; let authenticated = false;
  McpEndpoint.prototype.grant = function (header) { const grant = original.call(this, header); if (grant.id === f.access.id) authenticated = true; return grant; };
  t.after(() => { McpEndpoint.prototype.grant = original; });
  const body = JSON.stringify(message('result_submit', { taskId: f.taskId, requestId: 'body-race', text: 'must not publish' }));
  let req;
  const response = new Promise((resolve, reject) => {
    req = request(f.url + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + f.access.token,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', part => { text += part; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    }); req.on('error', reject); req.write(body.slice(0, 10));
  });
  t.after(() => req.destroy()); await until(() => authenticated); await f.revoke(); req.end(body.slice(10));
  const result = await response; assert.equal(result.status, 401); assert.match(result.text, /mcp_authentication_required/);
  assert.equal(f.app.store.read().discussions[0].evidence.length, 0); assert.equal(f.app.store.read().jobs.length, 0);
});
