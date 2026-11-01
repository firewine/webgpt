import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Workspace } from '../workspace/runtime.js';
import type { WorkspaceState } from '../workspace/model.js';
import { AppError, digest, object } from '../workspace/util.js';
import { confirmedPassword, createPassword, passwordValue, verifyPassword } from '../workspace/password.js';
export class Access {
  private readonly failures = new Map<string, { count: number; until: number }>();
  private hashing = false;
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
    const state = this.app.store.read();
    return state.sessions.some(s => s.expiresAt > Date.now() && equal(s.hash, hash) && (!state.ownerPassword || s.credentialId === state.ownerPassword.id));
  }
  require(req: IncomingMessage, mutation = false): void {
    if (!this.authenticate(req)) throw new AppError('authentication_required', 401);
    if (mutation) this.origin(req, !req.headers.authorization?.startsWith('Bearer '));
    else if (req.headers.origin) this.origin(req);
  }
  private attempt(req: IncomingMessage): string {
    const key = req.socket.remoteAddress ?? 'local'; const prior = this.failures.get(key);
    if (prior && prior.until > Date.now() && prior.count >= 5) throw new AppError('login_rate_limited', 429);
    const failure = prior && prior.until > Date.now() ? prior : { count: 0, until: Date.now() + 60_000 };
    failure.count++; this.failures.set(key, failure); return key;
  }
  private async hash<T>(operation: () => Promise<T>): Promise<T> {
    if (this.hashing) throw new AppError('login_rate_limited', 429);
    this.hashing = true; try { return await operation(); } finally { this.hashing = false; }
  }
  private session(state: WorkspaceState): string {
    const session = randomBytes(32).toString('base64url');
    state.sessions = state.sessions.filter(s => s.expiresAt > Date.now()).slice(-19);
    state.sessions.push({ hash: digest(session), expiresAt: Date.now() + 12 * 3600_000, ...(state.ownerPassword ? { credentialId: state.ownerPassword.id } : {}) });
    return this.cookie(session, 12 * 3600);
  }
  status(req: IncomingMessage) { return { passwordConfigured: !!this.app.store.read().ownerPassword, canSetup: this.authenticate(req) }; }
  async login(req: IncomingMessage, input: unknown): Promise<string> {
    this.origin(req); const key = this.attempt(req), b = object(input), credential = this.app.store.read().ownerPassword;
    if (Object.keys(b).some(k => !['password', 'token'].includes(k)) || ('password' in b) === ('token' in b)) throw new AppError('invalid_login');
    // Existing operator clients retain their high-entropy owner key. The web UI
    // has no key input; a failed password is never retried through that channel.
    const valid = 'token' in b ? typeof b.token === 'string' && b.token.length <= 4096 && equal(digest(b.token), this.app.accessHash)
      : credential ? await this.hash(() => verifyPassword(passwordValue(b.password), credential)) : false;
    if (!valid) throw new AppError('authentication_required', 401);
    const cookie = this.app.store.transact(s => {
      if (s.ownerPassword?.id !== credential?.id) throw new AppError('authentication_required', 401);
      return this.session(s);
    }); this.failures.delete(key); return cookie;
  }
  setupLink(req: IncomingMessage, input: unknown) {
    this.require(req, true);
    if (!req.headers.authorization?.startsWith('Bearer ')) throw new AppError('password_setup_not_authorized', 403);
    const b = object(input); if (Object.keys(b).some(k => k !== 'reset') || b.reset !== undefined && typeof b.reset !== 'boolean') throw new AppError('invalid_input');
    const token = randomBytes(32).toString('base64url'), expiresAt = Date.now() + 600000;
    this.app.store.transact(s => {
      if (s.ownerPassword && b.reset !== true) throw new AppError('password_already_set', 409);
      s.passwordSetup = { hash: digest(token), expiresAt, credentialId: s.ownerPassword?.id ?? null };
    });
    return { url: this.app.config.origin + '/#password-setup=' + token, expiresAt };
  }
  private grant(state: WorkspaceState, token: unknown): boolean {
    return typeof token === 'string' && /^[\w-]{43}$/.test(token) && !!state.passwordSetup && state.passwordSetup.expiresAt > Date.now() &&
      state.passwordSetup.credentialId === (state.ownerPassword?.id ?? null) && equal(state.passwordSetup.hash, digest(token));
  }
  async setup(req: IncomingMessage, input: unknown): Promise<string> {
    this.origin(req); const key = this.attempt(req), b = object(input), before = this.app.store.read();
    if (Object.keys(b).some(k => !['password', 'confirmPassword', 'setupToken'].includes(k))) throw new AppError('invalid_input');
    const linked = this.grant(before, b.setupToken);
    if (!linked && (before.ownerPassword || !this.authenticate(req))) throw new AppError('password_setup_not_authorized', 403);
    const password = confirmedPassword(b.password, b.confirmPassword), credential = await this.hash(() => createPassword(password));
    const cookie = this.app.store.transact(s => {
      if (s.ownerPassword?.id !== before.ownerPassword?.id || (linked ? !this.grant(s, b.setupToken) : !this.authenticate(req))) throw new AppError('password_setup_changed', 409);
      s.ownerPassword = credential; s.passwordSetup = null; s.sessions = []; return this.session(s);
    }); this.failures.delete(key); return cookie;
  }
  async change(req: IncomingMessage, input: unknown): Promise<string> {
    this.origin(req); this.require(req, true); const key = this.attempt(req), b = object(input), before = this.app.store.read().ownerPassword;
    if (Object.keys(b).some(k => !['currentPassword', 'password', 'confirmPassword'].includes(k))) throw new AppError('invalid_input');
    if (!before) throw new AppError('password_not_set', 409);
    const password = confirmedPassword(b.password, b.confirmPassword);
    const credential = await this.hash(async () => {
      if (!await verifyPassword(passwordValue(b.currentPassword), before)) throw new AppError('password_verification_failed', 403);
      return createPassword(password);
    });
    const cookie = this.app.store.transact(s => {
      if (s.ownerPassword?.id !== before.id || !this.authenticate(req)) throw new AppError('password_setup_changed', 409);
      s.ownerPassword = credential; s.passwordSetup = null; s.sessions = []; return this.session(s);
    }); this.failures.delete(key); return cookie;
  }
  logout(req: IncomingMessage): string {
    const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('wj_session='))?.slice(11);
    if (cookie) this.app.store.transact(s => { s.sessions = s.sessions.filter(x => x.hash !== digest(cookie)); });
    return this.cookie('', 0);
  }
  private cookie(value: string, seconds: number): string { return `wj_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.app.config.origin.startsWith('https:') ? '; Secure' : ''}`; }
}
function equal(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
