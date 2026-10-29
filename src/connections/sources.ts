import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { AppError, digest, now } from '../workspace/util.js';

export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(ip) === 6) {
    // Only global unicast. IPv4-mapped, loopback, link-local, ULA, multicast,
    // transition and documentation ranges are not evidence-fetch destinations.
    const v = ip.toLowerCase();
    return /^[23]/.test(v) && !v.startsWith('2001:db8:') && !(v.startsWith('2001:') && parseInt(v.split(':')[1] || '0', 16) < 0x200) && !v.startsWith('2002:');
  }
  return false;
}
export async function fetchSource(raw: string, signal: AbortSignal): Promise<{ source: string; text: string; digest: string; observedAt: string }> {
  let url = new URL(raw);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new AppError('source_url_not_allowed');
    url.hash = '';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    signal.throwIfAborted();
    const addresses = await Promise.race([lookup(host, { all: true }), new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new AppError('source_dns_timeout')), 5000); timer.unref();
    })]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new AppError('source_address_not_allowed');
    const address = addresses[0]!;
    const result = await new Promise<{ status: number; location: string | undefined; type: string; body: Buffer }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        signal, timeout: 15_000, headers: { 'User-Agent': 'Webjjoku/0.2 evidence-reader', Accept: 'text/html,text/plain,application/json', 'Accept-Encoding': 'identity' },
        // Pin the vetted address; a second DNS resolution cannot rebind to a private service.
        lookup: (_host, options, callback) => { if (typeof options === 'object' && options.all) (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, [address]); else callback(null, address.address, address.family); },
      }, response => {
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 512_000) request.destroy(new AppError('source_too_large')); else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode ?? 0, location: response.headers.location,
          type: response.headers['content-type'] ?? '', body: Buffer.concat(chunks) }));
      });
      request.once('timeout', () => request.destroy(new AppError('source_timeout'))); request.once('error', reject); request.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status) && result.location) { url = new URL(result.location, url); continue; }
    if (result.status !== 200 || !/^(text\/(html|plain)|application\/json)(;|$)/i.test(result.type)) throw new AppError('source_unavailable');
    const rawText = result.body.toString('utf8');
    const text = result.type.startsWith('text/html') ? rawText.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : rawText;
    if (!text) throw new AppError('source_empty');
    return { source: url.href, text: text.slice(0, 16_000) + (text.length > 16_000 ? '\n[원문 앞 16,000자 발췌 · 전체 원문은 출처 URL에서 확인]' : ''), digest: digest(rawText), observedAt: now() };
  }
  throw new AppError('source_redirect_limit');
}
