import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomBytes, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpWebhook } from '../dist/server/connections/mcp-webhook.js';
import { RpcProcess } from '../dist/server/connections/rpc.js';
import { saveDotGrant } from '../scripts/dot-mcp-ops.mjs';
import { workFixture } from './work-fixture.mjs';
import { response } from './workspace-helpers.mjs';
import { reply } from './resident-fixture.mjs';

export const key = () => crypto.randomUUID();
export const dataOf = (prompt, field) => JSON.parse(prompt.split('\n\n').find(v => v.startsWith('{"' + field + '":')));
export async function evidence(name, value) {
  await mkdir('test-results/dot-D5', { recursive: true });
  await writeFile('test-results/dot-D5/' + name + '.json', JSON.stringify({ evidence: 'isolated_fixture', realAccounts: 'NOT_RUN', ...value }, null, 2));
}
export function topicReply(input) {
  const value = JSON.parse(response(input.prompt, input.participant)); value.verifications = [];
  return JSON.stringify(value);
}

// Runs the installed application's private stdio forwarder, HTTP endpoint,
// signer, event outbox and mailbox. Only DNS/TLS transport and the external dot
// actor are substituted. No Tunnel, account, model or production state is used.
export async function nativeFixture(t, options = {}) {
  const secret = randomBytes(32), errors = [], callbacks = [], inputs = [], answers = [];
  let f, rpc, timer;
  const receiver = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8'), body = JSON.parse(raw);
      const signature = createHmac('sha256', secret).update(`${req.headers['webhook-id']}.${req.headers['webhook-timestamp']}.${raw}`).digest('base64');
      assert.equal(req.headers['webhook-signature'], 'v1,' + signature);
      assert.ok(req.headers['x-mcp-subscription-id']);
      assert.ok(Math.abs(Date.now() / 1000 - Number(req.headers['webhook-timestamp'])) < 30);
      callbacks.push({ type: body.type, eventId: req.headers['webhook-id'], requestId: body.data?.requestId });
      if (body.type === 'verification') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ challenge: body.challenge })); }
      else { assert.ok(body.data.requestId); await f.onEvent(body.data.requestId); res.end('{}'); }
    } catch (error) { errors.push(error); res.writeHead(500); res.end('{}'); }
  });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
  t.after(async () => { clearInterval(timer); rpc?.close(); receiver.closeAllConnections(); await new Promise(resolve => receiver.close(resolve)); });
  const transport = new McpWebhook(async host => {
    assert.equal(host, 'receiver.example'); return [{ address: '93.184.216.34', family: 4 }];
  }, (url, requestOptions, callback) => {
    assert.equal(url.href, 'https://receiver.example/d5'); assert.equal(requestOptions.agent, false);
    return httpRequest('http://127.0.0.1:' + receiver.address().port + '/d5', requestOptions, callback);
  });
  f = await (options.factory ?? workFixture)(t, { ...options, on: false, runtimeOptions: { webhookTransport: transport } });
  Object.assign(f, { inputs, answers, callbacks, errors, state: () => f.app.store.read(), room: () => f.app.store.read().resident.rooms[0] });
  const registered = await f.api('/api/dot/connections', { roomId: f.roomId, label: 'D5 native dot fixture' });
  assert.equal(registered.status, 201); Object.assign(f, await registered.json());
  const confirmed = await f.api('/api/dot/connections/' + f.connectionId + '/confirm', {
    expectedVersion: 1, ownerConfirmed: true, expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(confirmed.status, 201); const access = await confirmed.json();
  const file = join(f.directory, 'd5-grant'); await saveDotGrant(file, access.token);
  const env = join(f.directory, 'd5-stdio.env');
  await writeFile(env, `WJ_PORT=${new URL(f.url).port}\nWJ_MCP_GRANT_FILE=${file}\nWJ_MCP_EXPECT_DOT=true\n`, { mode: 0o600 });
  const reconnect = async () => {
    rpc?.close(); rpc = new RpcProcess([process.execPath, '--env-file=' + env, fileURLToPath(new URL('../scripts/mcp-stdio.mjs', import.meta.url))]);
    await rpc.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'D5-fixture', version: '1' } });
    rpc.notify('notifications/initialized');
  };
  await reconnect();
  Object.assign(f, { access, reconnect,
    request: (method, params = {}) => rpc.request(method, params),
    call: async (name, args = {}) => (await rpc.request('tools/call', { name, arguments: args })).structuredContent,
    replyFor: input => input.prompt.startsWith('웹쫀쿠 상주') ? reply() : topicReply(input),
    respond: async (requestId, text, repeats = 1) => {
      const attempt = await f.call('dot_turn_claim', { requestId, commandId: 'claim-' + requestId });
      const frozen = (await f.call('dot_turn_get', { requestId, ...attempt })).request;
      const input = { ...frozen, participant: f.state().participants.find(p => p.id === f.participantId) }; inputs.push(input);
      const body = { requestId, ...attempt, commandId: 'submit-' + requestId, text: text ?? await f.replyFor(input) };
      const results = []; for (let i = 0; i < repeats; i++) results.push(await f.call('dot_turn_submit', { ...body, commandId: i % 2 ? body.commandId : body.commandId + '-' + i }));
      answers.push({ body, results }); return results[0];
    },
    assertClean: () => { assert.deepEqual(errors.map(e => e.message), []); },
  });
  f.onEvent = id => f.respond(id);
  const meta = await f.call('dot_turn_get');
  f.subscriptionParams = { name: meta.event.name, arguments: meta.event.arguments,
    delivery: { mode: 'webhook', url: 'https://receiver.example/d5', secret: 'whsec_' + secret.toString('base64') } };
  f.subscribe = () => f.request('events/subscribe', f.subscriptionParams);
  await f.subscribe();
  f.control({ action: 'configure', pacing: { ...f.room().pacing, minIntervalMs: 1, idleNudgeMs: 1, sleepAfterPasses: 100 } });
  f.control({ action: 'set_member', participantId: f.participantId, enabled: true });
  f.q.seat(f.roomId, { participantId: f.participantId, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, key());
  timer = setInterval(() => { void f.app.mcpEvents.pump().catch(error => errors.push(error)); }, 5);
  return f;
}
