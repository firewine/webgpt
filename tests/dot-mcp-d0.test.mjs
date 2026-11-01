import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createDotD0Fixture, postPublicWebhook } from '../scripts/fixtures/dot-mcp-d0.mjs';
const secret = 'whsec_' + Buffer.alloc(32, 2).toString('base64');
const rpc = (fixture, method, params) => fixture.handle({ jsonrpc: '2.0', id: 1, method, params });
const call = async (f, name, args = {}) => {
  const res = await rpc(f, 'tools/call', { name, arguments: args });
  return res.error ? res : JSON.parse(res.result.content[0].text);
};
async function setup(options = {}) {
  const sent = []; const fixture = createDotD0Fixture({ ...options, send: async (url, envelope) => {
    const value = JSON.parse(envelope.body); sent.push(value);
    assert.equal(envelope.headers['webhook-signature'], 'v1,' + createHmac('sha256', Buffer.alloc(32, 2)).update(envelope.headers['webhook-id'] + '.' + envelope.headers['webhook-timestamp'] + '.' + envelope.body).digest('base64'));
    return { status: 200, body: value.type === 'verification' ? { challenge: value.challenge } : {} };
  } });
  const info = await call(fixture, 'dot_turn_get'); const params = { name: 'webjjoku.turn_requested', arguments: { probeId: info.probeId }, delivery: { mode: 'webhook', url: 'https://callback.example.test/events', secret } };
  return { fixture, info, params, sent };
}

test('D0 synthetic fixture: verified event, input and one accepted response; webhook alone is not a native reply', async () => {
  const f = await setup(); const init = await rpc(f.fixture, 'initialize'); assert.deepEqual(init.result.capabilities.events, {});
  assert.equal((await rpc(f.fixture, 'events/list')).result.events.length, 1);
  const sub = await rpc(f.fixture, 'events/subscribe', f.params); assert.ok(sub.result.id); assert.equal(sub.result.cursor, null);
  const delivery = await f.fixture.deliver(); assert.equal(delivery.status, 'WEBHOOK_RECEIVED'); assert.equal(delivery.nativeReply, 'NOT_RUN');
  assert.deepEqual(f.sent[1].data, { probeId: f.info.probeId, requestId: f.info.requestId });
  const claim = await call(f.fixture, 'dot_turn_claim', { requestId: f.info.requestId });
  const args = { requestId: f.info.requestId, attemptId: claim.attemptId, text: 'D0 synthetic test reply' };
  const first = await call(f.fixture, 'dot_turn_submit', args);
  for (let i = 0; i < 20; i++) assert.deepEqual(await call(f.fixture, 'dot_turn_submit', args), first);
  assert.equal((await call(f.fixture, 'dot_turn_submit', { ...args, text: 'different' })).error.code, -32602);
  assert.equal((await f.fixture.deliver()).status, 'NOT_SENT'); assert.equal(f.sent.filter(v => v.name).length, 1);
});

test('D0 synthetic fixture: repeated subscribe preserves ID; foreign scope, unsupported actions and replies after unsubscribe are rejected', async () => {
  const f = await setup(); const sub = await rpc(f.fixture, 'events/subscribe', f.params);
  assert.equal((await rpc(f.fixture, 'events/subscribe', f.params)).result.id, sub.result.id);
  assert.ok((await rpc(f.fixture, 'events/subscribe', { ...f.params, arguments: { probeId: 'foreign' } })).error);
  assert.ok((await call(f.fixture, 'codex_send', {})).error); assert.ok((await call(f.fixture, 'dot_turn_get', { roomId: 'real-room' })).error);
  const claim = await call(f.fixture, 'dot_turn_claim', { requestId: f.info.requestId });
  await rpc(f.fixture, 'events/unsubscribe', { ...f.params, delivery: { mode: 'webhook', url: f.params.delivery.url } });
  assert.equal((await f.fixture.deliver()).status, 'NOT_SENT');
  assert.ok((await call(f.fixture, 'dot_turn_submit', { requestId: f.info.requestId, attemptId: claim.attemptId, text: 'late' })).error);
});

test('D0 synthetic fixture: bad challenge, key, private destination and expiry never produce accepted work or leak secrets', async () => {
  const failed = createDotD0Fixture({ send: async () => ({ status: 200, body: { challenge: 'wrong' } }) });
  const info = await call(failed, 'dot_turn_get'); const params = { name: 'webjjoku.turn_requested', arguments: { probeId: info.probeId }, delivery: { mode: 'webhook', url: 'https://callback.example.test/events', secret } };
  const failure = await rpc(failed, 'events/subscribe', params); assert.equal(failure.error.code, -32015); assert.equal(JSON.stringify(failure).includes(secret), false);
  assert.ok((await rpc(failed, 'events/subscribe', { ...params, delivery: { ...params.delivery, secret: 'whsec_bad' } })).error);
  for (const url of ['http://127.0.0.1/events', 'https://127.0.0.1/events', 'https://169.254.169.254/events', 'https://100.64.0.1/events']) await assert.rejects(postPublicWebhook(url, { body: '{}', headers: {} }));
  let clock = 1700000000000; const f = await setup({ clock: () => clock });
  await rpc(f.fixture, 'events/subscribe', { ...f.params, ttlMs: 1 }); clock += 2;
  assert.equal((await f.fixture.deliver()).status, 'NOT_SENT'); assert.ok((await call(f.fixture, 'dot_turn_claim', { requestId: f.info.requestId })).error);
});

test('D0 synthetic stdio process advertises the fixture contract without workspace access or an event trigger', async () => {
  const child = spawn(process.execPath, [new URL('../scripts/fixtures/dot-mcp-d0.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
  const output = []; const errors = []; child.stdout.on('data', chunk => output.push(chunk)); child.stderr.on('data', chunk => errors.push(chunk));
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  child.stdin.end(['initialize', 'tools/list', 'events/list'].map((method, id) => JSON.stringify({ jsonrpc: '2.0', id, method })).join('\n') + '\n');
  assert.equal(await closed, 0); const replies = Buffer.concat(output).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies.map(r => r.id), [0, 1, 2]); assert.equal(replies[0].result.serverInfo.name, 'webjjoku-dot-D0-SYNTHETIC-ONLY');
  assert.equal(replies[1].result.tools.length, 3); assert.equal(replies[2].result.events.length, 1); assert.equal(Buffer.concat(errors).toString('utf8'), '');
});
