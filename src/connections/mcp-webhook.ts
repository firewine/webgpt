import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { publicAddress } from './sources.js';

export class CallbackError extends Error {
  constructor(readonly reason: string, readonly retryable = false) { super('CallbackEndpointError'); }
}
export function callbackUrl(raw: unknown): string {
  try {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\s\x00-\x1f\x7f]/.test(raw)) throw new Error();
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.port && u.port !== '443') throw new Error();
    return u.href;
  } catch { throw new CallbackError('invalid_url'); }
}
export function signingKey(secret: unknown): Buffer {
  if (typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/]{32,86}={0,2}$/.test(secret)) throw new CallbackError('invalid_secret');
  const raw = secret.slice(6); const key = Buffer.from(raw, 'base64');
  if (key.length < 24 || key.length > 64 || key.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) throw new CallbackError('invalid_secret');
  return key;
}
export function webhookHeaders(subscriptionId: string, eventId: string, body: string, secrets: string[], clock = Date.now()) {
  const timestamp = String(Math.floor(clock / 1000));
  return { 'Content-Type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': timestamp,
    'webhook-signature': secrets.map(secret => 'v1,' + createHmac('sha256', signingKey(secret)).update(`${eventId}.${timestamp}.${body}`).digest('base64')).join(' '),
    'X-MCP-Subscription-Id': subscriptionId };
}
export function challengeMatches(body: string, challenge: string): boolean {
  try { const value: unknown = JSON.parse(body).challenge; if (typeof value !== 'string') return false;
    const actual = Buffer.from(value); const expected = Buffer.from(challenge); return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
export interface WebhookRequest {
  url: string; body: string; subscriptionId: string; eventId: string; secrets: string[]; signal: AbortSignal;
  beforeSend: () => void;
}
export interface WebhookTransport { post(input: WebhookRequest): Promise<{ status: number; body: string }> }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new CallbackError('timeout', true)); signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
// No proxy, redirects or pooled sockets: every POST gets a fresh, public DNS pin.
export class McpWebhook implements WebhookTransport {
  constructor(private readonly resolve: (host: string) => Promise<LookupAddress[]> = host => lookup(host, { all: true }),
    private readonly send: typeof request = request, private readonly clock = Date.now) {}
  async post(input: WebhookRequest): Promise<{ status: number; body: string }> {
    const u = new URL(callbackUrl(input.url)); const host = u.hostname.replace(/^\[|\]$/g, '');
    if (Buffer.byteLength(input.body) > 262144) throw new CallbackError('payload_too_large');
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(10000)]);
    let addresses: LookupAddress[];
    try { addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await abortable(this.resolve(host), signal); }
    catch { throw new CallbackError(signal.aborted ? 'timeout' : 'dns_failed', true); }
    if (!addresses.length || addresses.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw new CallbackError('address_not_allowed');
    const address = addresses[0]!; signal.throwIfAborted(); input.beforeSend();
    const headers = webhookHeaders(input.subscriptionId, input.eventId, input.body, input.secrets, this.clock());
    try {
      return await new Promise((resolve, reject) => {
        const req = this.send(u, { method: 'POST', agent: false, signal, timeout: 10000, maxHeaderSize: 8192,
          headers: { ...headers, 'Content-Length': Buffer.byteLength(input.body), 'Accept-Encoding': 'identity' },
          // URL hostname stays intact for Host and TLS certificate verification.
          lookup: (_host, options, callback) => {
            if (typeof options === 'object' && options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [address]);
            else callback(null, address.address, address.family);
          },
        }, response => {
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 16384) req.destroy(new CallbackError('response_too_large')); else chunks.push(chunk); });
          response.once('error', reject);
          response.once('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.once('timeout', () => req.destroy(new CallbackError('timeout', true))); req.once('error', reject); req.end(input.body);
      });
    } catch (error) { if (error instanceof CallbackError) throw error; throw new CallbackError(signal.aborted ? 'timeout' : 'network_failed', true); }
  }
}
