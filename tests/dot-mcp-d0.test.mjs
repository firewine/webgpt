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
  child.stdin.end([{ jsonrpc: '2.0', id: 0, method: 'initialize' }, { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: 2, method: 'events/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dot_turn_get', arguments: {} } }].map(value => JSON.stringify(value)).join('\n') + '\n');
  assert.equal(await closed, 0); const replies = Buffer.concat(output).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies.map(r => r.id), [0, 1, 2, 3]); assert.equal(replies[0].result.serverInfo.name, 'webjjoku-dot-D0-SYNTHETIC-ONLY');
  assert.equal(replies[1].result.tools.length, 3); assert.equal(replies[2].result.events.length, 1); assert.equal(Buffer.concat(errors).toString('utf8'), '');
  const info = JSON.parse(replies[3].result.content[0].text); assert.equal(info.diagnostics.initializedNotifications, 1); assert.equal(info.diagnostics.subscribeRequests, 0);
});

test('D0 read-only diagnostics distinguish verified callback, webhook receipt and accepted native reply', async () => {
  const f = await setup(); assert.equal(f.info.diagnostics.subscribeRequests, 0);
  await rpc(f.fixture, 'events/subscribe', f.params);
  const active = await call(f.fixture, 'dot_turn_get'); assert.equal(active.diagnostics.subscription, 'ACTIVE'); assert.equal(active.replyAccepted, false);
  assert.deepEqual(active.diagnostics.observations.at(-2), { sequence: 3, phase: 'CALLBACK_RETURNED', httpStatus: 200, challengePresent: true, challengeMatches: true });
  await f.fixture.deliver(); const received = await call(f.fixture, 'dot_turn_get'); assert.equal(received.diagnostics.deliveryStatus, 'WEBHOOK_RECEIVED'); assert.equal(received.replyAccepted, false);
  const claim = await call(f.fixture, 'dot_turn_claim', { requestId: f.info.requestId });
  const reply = await call(f.fixture, 'dot_turn_submit', { requestId: f.info.requestId, attemptId: claim.attemptId, text: 'synthetic-only' });
  const accepted = await call(f.fixture, 'dot_turn_get'); assert.equal(accepted.receipt, reply.receipt); assert.equal(accepted.replyAccepted, true);
  for (const sensitive of [secret, f.params.delivery.url, claim.attemptId, 'synthetic-only']) assert.equal(JSON.stringify(accepted).includes(sensitive), false);
  assert.equal(active.diagnostics.observations.length, 4); // A prior read stays a snapshot.
});

test('D0 diagnostics retain sanitized network failure and do not invent an active subscription', async () => {
  const f = createDotD0Fixture({ send: async url => { throw Object.assign(new Error(url + secret), { code: 'ENOTFOUND' }); } });
  const info = await call(f, 'dot_turn_get');
  const params = { name: 'webjjoku.turn_requested', arguments: { probeId: info.probeId }, delivery: { mode: 'webhook', url: 'https://private-callback.example.test/opaque', secret } };
  assert.equal((await rpc(f, 'events/subscribe', params)).error.code, -32015);
  const result = await call(f, 'dot_turn_get'); assert.equal(result.diagnostics.subscription, 'NONE'); assert.equal(result.diagnostics.deliveryStatus, 'NOT_RUN');
  assert.ok(result.diagnostics.observations.some(o => o.phase === 'CALLBACK_FAILED' && o.reason === 'ENOTFOUND'));
  for (const sensitive of [params.delivery.url, secret, 'opaque']) assert.equal(JSON.stringify(result).includes(sensitive), false);
});

test('D0 diagnostics distinguish callback rejection from wrong challenge and bound untrusted observations', async () => {
  for (const status of [401, 200]) {
    const f = createDotD0Fixture({ send: async () => ({ status, body: { challenge: 'wrong' } }) }); const info = await call(f, 'dot_turn_get');
    const params = { name: 'webjjoku.turn_requested', arguments: { probeId: info.probeId }, delivery: { mode: 'webhook', url: 'https://callback.example.test/private', secret } };
    assert.equal((await rpc(f, 'events/subscribe', params)).error.code, -32015);
    const d = (await call(f, 'dot_turn_get')).diagnostics; assert.ok(d.observations.some(o => o.phase === 'CALLBACK_RETURNED' && o.httpStatus === status && o.challengeMatches === false));
    for (let n = 0; n < 30; n++) await rpc(f, 'events/subscribe', { ...params, arguments: { probeId: 'untrusted-private-text' } });
    const bounded = await call(f, 'dot_turn_get'); assert.equal(bounded.diagnostics.subscribeRequests, 31); assert.equal(bounded.diagnostics.observations.length, 16); assert.equal(JSON.stringify(bounded).includes('untrusted-private-text'), false);
  }
});

test('D0 failed event delivery remains unconfirmed and a read or retry cannot resend it', async () => {
  let eventCalls = 0; const f = createDotD0Fixture({ send: async (_url, envelope) => {
    const body = JSON.parse(envelope.body); if (body.type === 'verification') return { status: 200, body: { challenge: body.challenge } };
    eventCalls++; throw Object.assign(new Error(secret), { code: 'ETIMEDOUT' });
  } }); const info = await call(f, 'dot_turn_get');
  await rpc(f, 'events/subscribe', { name: 'webjjoku.turn_requested', arguments: { probeId: info.probeId }, delivery: { mode: 'webhook', url: 'https://callback.example.test/events', secret } });
  assert.equal((await f.deliver()).status, 'DELIVERY_UNCONFIRMED'); const result = await call(f, 'dot_turn_get');
  assert.equal(result.replyAccepted, false); assert.ok(result.diagnostics.observations.some(o => o.phase === 'DELIVERY_FAILED' && o.reason === 'ETIMEDOUT'));
  assert.equal((await f.deliver()).status, 'NOT_SENT'); assert.equal(eventCalls, 1);
});

test('D0 catalogs survive process identity changes while handlers reject an earlier probe and request', async () => {
  const before = await setup(); const after = await setup(); assert.notEqual(before.info.probeId, after.info.probeId);
  for (const method of ['tools/list', 'events/list']) assert.deepEqual((await rpc(before.fixture, method)).result, (await rpc(after.fixture, method)).result);
  const catalog = (await rpc(after.fixture, 'events/list')).result.events[0];
  assert.ok(new RegExp(catalog.inputSchema.properties.probeId.pattern).test(after.info.probeId));
  assert.ok((await rpc(after.fixture, 'events/subscribe', { ...after.params, arguments: { probeId: before.info.probeId } })).error); assert.equal(after.sent.length, 0);
  assert.ok((await rpc(after.fixture, 'events/subscribe', after.params)).result);
  assert.ok((await call(after.fixture, 'dot_turn_claim', { requestId: before.info.requestId })).error);
  assert.ok((await call(after.fixture, 'dot_turn_claim', { requestId: after.info.requestId })).attemptId);
});

test('D0 explains subscription-before-reply and distinguishes missing subscription from a stale request', async () => {
  const f = await setup(); assert.equal(f.info.nextAction, 'SUBSCRIBE'); assert.deepEqual(f.info.event, { name: f.params.name, arguments: f.params.arguments });
  assert.equal((await call(f.fixture, 'dot_turn_claim', { requestId: f.info.requestId })).error.data.reason, 'subscription_required');
  assert.equal((await call(f.fixture, 'dot_turn_claim', { requestId: 'turn_' + '0'.repeat(24) })).error.data.reason, 'current_request_required');
  const rejected = await call(f.fixture, 'dot_turn_get'); assert.equal(rejected.replyAccepted, false); assert.equal(rejected.diagnostics.subscribeRequests, 0);
  assert.ok(rejected.diagnostics.observations.some(o => o.phase === 'TOOL_REJECTED' && o.reason === 'subscription_required'));
  await rpc(f.fixture, 'events/subscribe', f.params); assert.equal((await call(f.fixture, 'dot_turn_get')).nextAction, 'WAIT_FOR_EVENT');
  await f.fixture.deliver(); const claim = await call(f.fixture, 'dot_turn_claim', { requestId: f.info.requestId });
  await call(f.fixture, 'dot_turn_submit', { requestId: f.info.requestId, attemptId: claim.attemptId, text: 'synthetic test' });
  assert.equal((await call(f.fixture, 'dot_turn_get')).nextAction, 'STOP_MONITORING');
});
