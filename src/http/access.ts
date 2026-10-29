import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Workspace } from '../workspace/runtime.js';
import { AppError, digest } from '../workspace/util.js';
export class Access {
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(private readonly app: Workspace) {}
  host(req: IncomingMessage): void {
    const configured = new URL(this.app.config.origin);
    const local = req.socket.localAddress?.includes(':') ? `[::1]:${req.socket.localPort}` : `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== configured.host && req.headers.host !== local) throw new AppError('host_not_allowed', 403);
  }
  origin(req: IncomingMessage, required = true): void {
    if (!req.headers.origin && !required) return;
    if (req.headers.origin !== this.app.config.origin) throw new AppError('origin_not_allowed', 403);
  }
  authenticate(req: IncomingMessage): boolean {
    if (req.headers.authorization?.startsWith('Bearer ')) return equal(digest(req.headers.authorization.slice(7)), this.app.accessHash);
    const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('wj_session='))?.slice(11);
    if (!cookie) return false;
    const hash = digest(cookie);
    return this.app.store.read().sessions.some(s => s.expiresAt > Date.now() && equal(s.hash, hash));
  }
  require(req: IncomingMessage, mutation = false): void {
    if (!this.authenticate(req)) throw new AppError('authentication_required', 401);
    if (mutation) this.origin(req, !req.headers.authorization?.startsWith('Bearer '));
    else if (req.headers.origin) this.origin(req);
  }
  login(req: IncomingMessage, token: string): string {
    this.origin(req);
    const key = req.socket.remoteAddress ?? 'local'; const prior = this.failures.get(key);
    if (prior && prior.until > Date.now() && prior.count >= 5) throw new AppError('login_rate_limited', 429);
    if (!equal(digest(token), this.app.accessHash)) {
      const failure = prior && prior.until > Date.now() ? prior : { count: 0, until: Date.now() + 60_000 };
      failure.count++; this.failures.set(key, failure); throw new AppError('authentication_required', 401);
    }
    this.failures.delete(key); const session = randomBytes(32).toString('base64url');
    this.app.store.transact(s => { s.sessions = s.sessions.filter(x => x.expiresAt > Date.now()).slice(-19); s.sessions.push({ hash: digest(session), expiresAt: Date.now() + 12 * 3600_000 }); });
    return this.cookie(session, 12 * 3600);
  }
  logout(req: IncomingMessage): string {
    const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('wj_session='))?.slice(11);
    if (cookie) this.app.store.transact(s => { s.sessions = s.sessions.filter(x => x.hash !== digest(cookie)); });
    return this.cookie('', 0);
  }
  private cookie(value: string, seconds: number): string { return `wj_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.app.config.origin.startsWith('https:') ? '; Secure' : ''}`; }
}
function equal(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
