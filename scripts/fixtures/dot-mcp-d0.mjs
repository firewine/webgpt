import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { publicAddress } from '../../dist/server/connections/sources.js';

// Disposable D0 synthetic server ONLY. It cannot access a Workspace, owner key,
// provider credential, Chrome, room, real conversation, Wiki, filesystem or shell.
// No-auth plugin discovery is permitted here only behind the private Tunnel.
// This is not the production grant/identity/restart/approval implementation.
const digest = text => createHash('sha256').update(text).digest('hex');
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function destination(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') throw new Error('callback_not_allowed'); return url;
}
export function signedWebhook(secret, eventId, timestamp, value, subscriptionId) {
  if (typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/=_-]+$/.test(secret)) throw new Error('invalid_signing_key');
  const key = Buffer.from(secret.slice(6), 'base64'); if (key.length < 24 || key.length > 64) throw new Error('invalid_signing_key');
  const body = JSON.stringify(value);
  const signature = createHmac('sha256', key).update(eventId + '.' + timestamp + '.' + body).digest('base64');
  return { body, headers: { 'Content-Type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': String(timestamp),
    'webhook-signature': 'v1,' + signature, 'X-MCP-Subscription-Id': subscriptionId } };
}
export async function postPublicWebhook(raw, envelope) {
  const url = destination(raw); const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await Promise.race([lookup(hostname, { all: true }), delay(5000, null, { ref: false }).then(() => { throw new Error('callback_dns_timeout'); })]);
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('callback_not_allowed');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'POST', headers: envelope.headers, signal: AbortSignal.timeout(10_000),
      lookup: (_host, options, callback) => typeof options === 'object' && options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 16_384) req.destroy(new Error('callback_too_large')); else chunks.push(chunk); });
      res.on('error', reject); res.on('end', () => {
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        // No redirect is followed, and a redirect cannot verify the challenge.
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.once('error', reject); req.end(envelope.body);
  });
}

export function createDotD0Fixture({ send = postPublicWebhook, clock = Date.now } = {}) {
  const probeId = 'd0_' + randomBytes(12).toString('hex'); const requestId = 'turn_' + randomBytes(12).toString('hex');
  const eventId = 'event_' + randomBytes(12).toString('hex'); const occurredAt = new Date(clock()).toISOString();
  let subscription = null; let attemptId = null; let accepted = null; let deliveryAttempted = false;
  const eventName = 'webjjoku.turn_requested';
  const toolNames = ['dot_turn_get', 'dot_turn_claim', 'dot_turn_submit'];
  const inputSchema = name => ({ type: 'object', properties: name === 'dot_turn_get' ? {} : { requestId: { type: 'string', enum: [requestId] },
    ...(name === 'dot_turn_submit' ? { attemptId: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 2000 } } : {}) },
    required: name === 'dot_turn_get' ? [] : name === 'dot_turn_submit' ? ['requestId', 'attemptId', 'text'] : ['requestId'], additionalProperties: false });
  const checkSubscription = params => {
    if (params.name !== eventName || !object(params.arguments) || Object.keys(params.arguments).length !== 1 || params.arguments.probeId !== probeId || !object(params.delivery) || params.delivery.mode !== 'webhook') throw new Error('probe_not_in_scope');
    destination(params.delivery.url);
  };
  async function handle(message) {
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    if (message.id === undefined) return null;
    const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
    try {
      const p = message.params ?? {}; if (!object(p)) throw new Error('invalid_params');
      if (message.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {}, events: {} }, serverInfo: { name: 'webjjoku-dot-D0-SYNTHETIC-ONLY', version: '0.1.0' },
        instructions: 'Disposable synthetic connection test only. No workspace access. Monitor webjjoku.turn_requested for the advertised probeId; use dot_turn_get, claim, then submit one short test reply. Do not use other apps or tools.' });
      if (message.method === 'ping') return reply({});
      if (message.method === 'tools/list') return reply({ tools: toolNames.map(name => ({ name, description: 'D0 synthetic probe only: ' + name + '. Not a real chat room or task.',
        inputSchema: inputSchema(name), annotations: { readOnlyHint: name === 'dot_turn_get', destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
      if (message.method === 'events/list') return reply({ events: [{ name: eventName, description: 'One synthetic D0 turn, isolated from all real workspace data.', delivery: ['webhook'],
        inputSchema: { type: 'object', properties: { probeId: { type: 'string', enum: [probeId] } }, required: ['probeId'], additionalProperties: false },
        payloadSchema: { type: 'object', properties: { probeId: { type: 'string' }, requestId: { type: 'string' } }, required: ['probeId', 'requestId'], additionalProperties: false } }] });
      if (message.method === 'events/subscribe') {
        checkSubscription(p);
        const id = 'sub_' + digest(JSON.stringify(['D0-synthetic-service-principal', p.delivery.url, eventName, { probeId }])).slice(0, 32);
        if (subscription && subscription.id !== id) throw new Error('single_subscription_only');
        const ttl = p.ttlMs === undefined || p.ttlMs === null ? 600_000 : p.ttlMs;
        if (!Number.isSafeInteger(ttl) || ttl < 1) throw new Error('invalid_ttl');
        const challenge = randomBytes(32).toString('base64url');
        let response;
        const envelope = signedWebhook(p.delivery.secret, 'verification_' + randomBytes(12).toString('hex'), Math.floor(clock() / 1000), { type: 'verification', challenge }, id);
        try { response = await send(p.delivery.url, envelope); } catch { throw new Error('challenge_failed'); }
        const returned = typeof response.body?.challenge === 'string' ? Buffer.from(response.body.challenge) : Buffer.alloc(0); const expected = Buffer.from(challenge);
        if (response.status < 200 || response.status >= 300 || returned.length !== expected.length || !timingSafeEqual(returned, expected)) throw new Error('challenge_failed');
        subscription = { id, url: p.delivery.url, secret: p.delivery.secret, expiresAt: clock() + Math.min(ttl, 600_000) };
        return reply({ id, refreshBefore: new Date(subscription.expiresAt).toISOString(), cursor: null, truncated: false });
      }
      if (message.method === 'events/unsubscribe') { checkSubscription(p); if (subscription?.url !== p.delivery.url) throw new Error('probe_not_in_scope'); subscription = null; return reply({}); }
      if (message.method === 'tools/call') {
        const args = p.arguments ?? {}; if (!toolNames.includes(p.name) || !object(args)) throw new Error('unknown_tool');
        const allowed = Object.keys(inputSchema(p.name).properties); if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('probe_not_in_scope');
        let value;
        if (p.name === 'dot_turn_get') value = { probeId, requestId, syntheticOnly: true, replyAccepted: !!accepted, instruction: 'Submit one short D0 connection test reply. Do not include personal information or perform other work.' };
        else {
          if (args.requestId !== requestId || !subscription || subscription.expiresAt <= clock()) throw new Error('probe_not_in_scope');
          if (p.name === 'dot_turn_claim') { attemptId ??= randomBytes(24).toString('base64url'); value = { requestId, attemptId, syntheticOnly: true }; }
          else {
            if (!attemptId || args.attemptId !== attemptId || typeof args.text !== 'string' || !args.text.trim() || args.text.length > 2000) throw new Error('probe_not_in_scope');
            const textDigest = digest(args.text); if (accepted && accepted.digest !== textDigest) throw new Error('idempotency_conflict');
            accepted ??= { receipt: 'd0_reply_' + randomBytes(12).toString('hex'), digest: textDigest }; value = { accepted: true, ...accepted, syntheticOnly: true };
          }
        }
        return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
      }
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported' } };
    } catch (error) {
      const code = error?.message === 'challenge_failed' ? -32015 : -32602;
      // Never reflect callback URLs, keys, arbitrary input or native reply text.
      return { jsonrpc: '2.0', id: message.id, error: { code, message: code === -32015 ? 'CallbackEndpointError' : 'D0 request not accepted', ...(code === -32015 ? { data: { reason: 'challenge_failed' } } : {}) } };
    }
  }
  async function deliver() {
    if (!subscription || subscription.expiresAt <= clock() || deliveryAttempted) return { status: 'NOT_SENT', nativeReply: accepted ? 'ACCEPTED' : 'NOT_RUN' };
    deliveryAttempted = true;
    const event = { eventId, name: eventName, timestamp: occurredAt, data: { probeId, requestId }, cursor: null };
    const result = await send(subscription.url, signedWebhook(subscription.secret, eventId, Math.floor(clock() / 1000), event, subscription.id));
    return { status: result.status >= 200 && result.status < 300 ? 'WEBHOOK_RECEIVED' : 'DELIVERY_UNCONFIRMED', nativeReply: accepted ? 'ACCEPTED' : 'NOT_RUN' };
  }
  return { handle, deliver };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = createDotD0Fixture(); let timer; let replyLogged = false;
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      if (Buffer.byteLength(line) > 32_768) throw new Error('request_too_large');
      const message = JSON.parse(line); const reply = await fixture.handle(message);
      if (reply) process.stdout.write(JSON.stringify(reply) + '\n');
      if (message.method === 'events/subscribe' && reply?.result && !timer) timer = setTimeout(() => {
        fixture.deliver().then(result => process.stderr.write(JSON.stringify({ d0Synthetic: true, ...result }) + '\n')).catch(() => process.stderr.write('D0 delivery unconfirmed\n'));
      }, 2000);
      if (!replyLogged && message.method === 'tools/call' && message.params?.name === 'dot_turn_submit' && reply?.result) { replyLogged = true; process.stderr.write('D0_SYNTHETIC_REPLY_ACCEPTED\n'); }
    } catch { process.stderr.write('D0 request unconfirmed\n'); }
  }
  if (timer) clearTimeout(timer);
}
