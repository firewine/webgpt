import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';
import type { JSONWebKeySet } from 'jose';
import type { Store } from '../workspace/store.js';
import type { Vault } from '../workspace/vault.js';
import { AppError, id, now, object, string } from '../workspace/util.js';

const ISSUER = 'https://auth.openai.com';
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
interface TokenSet { accessToken: string; refreshToken: string; idToken: string; expiresAt: number; scopes: string[]; clientId: string; subject: string }
interface Attempt { id: string; connectionId: string; state: string; nonce: string; verifier: string; redirect: string; clientId: string | null; expiresAt: number }
type Fetch = typeof fetch;
export class OAuthService {
  private server: Server | null = null;
  private starting: Promise<void> | null = null;
  private readonly attempts = new Map<string, Attempt>();
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(private readonly store: Store, private readonly vault: Vault, private readonly port = 1455, private readonly request: Fetch = fetch) {}

  private async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.locks.set(key, current);
    try { return await current; } finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  async begin(label: string, existingId?: string): Promise<{ attemptId: string; connectionId: string; authorizationUrl: string }> {
    await this.listen();
    for (const [key, a] of this.attempts) if (a.expiresAt <= Date.now()) this.attempts.delete(key);
    if (this.attempts.size >= 8) throw new AppError('too_many_signins', 429);
    const state = this.store.read();
    const existing = existingId ? state.connections.find(c => c.id === existingId && c.kind === 'openai-oauth') : undefined;
    if (existingId && !existing) throw new AppError('connection_not_found', 404);
    if ([...this.attempts.values()].some(a => a.connectionId === existingId)) throw new AppError('signin_pending', 409);
    const connectionId = existing?.id ?? id('connection');
    const attempt: Attempt = { id: id('signin'), connectionId, state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'),
      redirect: `http://127.0.0.1:${this.port}/auth/callback`, clientId: existing?.clientId ?? null, expiresAt: Date.now() + 600_000 };
    if (!existing) this.store.transact((s, emit) => {
      s.connections.push({ id: connectionId, kind: 'openai-oauth', label: string(label, 80), status: 'auth_required', models: [] });
      emit({ type: 'connection.added', discussionId: null, data: { connectionId } });
    });
    this.attempts.set(attempt.state, attempt);
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    const params: Record<string, string> = { client_id: attempt.clientId ?? 'dynamic_agent_client', ext_agent_host_id: state.hostId,
      response_type: 'code', redirect_uri: attempt.redirect, scope: SCOPES, resource: RESOURCE,
      state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') };
    if (!attempt.clientId) params.agent_name_hint = 'Webjjoku';
    // Deliberately omit retained ID tokens from URLs returned to the web client.
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return { attemptId: attempt.id, connectionId, authorizationUrl: url.href };
  }
  private async listen(): Promise<void> {
    if (this.server?.listening) return;
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        if (req.headers.host !== `127.0.0.1:${this.port}` || req.method !== 'GET') { res.writeHead(400); res.end('Invalid callback.'); return; }
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
        if (url.pathname !== '/auth/callback') { res.writeHead(404); res.end(); return; }
        void this.finish(url.searchParams).then(() => res.end('로그인 처리가 끝났습니다. 웹쫀쿠 연결 화면으로 돌아가세요.'))
          .catch(() => { res.writeHead(400); res.end('로그인을 완료하지 못했습니다. 웹쫀쿠에서 연결 상태를 확인하고 다시 시작하세요.'); });
      });
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
    try { await this.starting; } finally { this.starting = null; }
  }
  async finish(params: URLSearchParams): Promise<void> {
    const key = params.get('state') ?? ''; const a = this.attempts.get(key);
    if (!a || a.expiresAt < Date.now() || !equal(a.state, key)) throw new AppError('invalid_oauth_state');
    this.attempts.delete(key); // callback codes and state are single-use, including failures.
    await this.locked(a.connectionId, async () => {
      try {
        if (params.has('error')) throw new AppError('oauth_consent_denied');
        const clientId = params.get('client_id') ?? a.clientId;
        if (!clientId || clientId === 'dynamic_agent_client' || (a.clientId && clientId !== a.clientId)) throw new AppError('oauth_client_mismatch');
        this.store.transact(s => { const c = s.connections.find(x => x.id === a.connectionId)!; c.clientId = clientId; });
        const value = await this.post(TOKEN, { grant_type: 'authorization_code', client_id: clientId,
          code: string(params.get('code'), 8192), code_verifier: a.verifier, redirect_uri: a.redirect, resource: RESOURCE });
        const identity = await this.identity(string(value.id_token, 32000), clientId, a.nonce);
        const current = this.store.read().connections.find(c => c.id === a.connectionId)!;
        if (current.subject && current.subject !== identity.sub) throw new AppError('oauth_account_mismatch');
        const scopes = string(value.scope, 4000).split(/\s+/);
        const tokens = this.tokens(value, clientId, identity.sub, scopes);
        this.vault.put(a.connectionId, tokens);
        this.store.transact((s, emit) => {
          const c = s.connections.find(x => x.id === a.connectionId)!;
          c.subject = identity.sub; if (identity.email) c.email = identity.email;
          c.status = scopes.includes('chatgpt.tokens.use.direct') && scopes.includes('resource.invoke') ? 'connected' : 'auth_required';
          c.error = c.status === 'connected' ? '' : 'plan_permission_missing'; c.lastCheckedAt = now();
          emit({ type: 'connection.authenticated', discussionId: null, data: { connectionId: c.id, status: c.status } });
        });
      } catch (error) {
        this.store.transact((s, emit) => {
          const c = s.connections.find(x => x.id === a.connectionId)!;
          c.status = 'auth_required'; c.error = error instanceof AppError ? error.code : 'oauth_validation_failed';
          emit({ type: 'connection.auth_failed', discussionId: null, data: { connectionId: c.id, code: c.error } });
        });
        throw error;
      }
    });
  }
  private tokens(value: Record<string, unknown>, clientId: string, subject: string, scopes: string[], previous?: TokenSet): TokenSet {
    const seconds = value.expires_in;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || String(value.token_type).toLowerCase() !== 'bearer') throw new AppError('invalid_token_response');
    return { accessToken: string(value.access_token, 32000), refreshToken: string(value.refresh_token ?? previous?.refreshToken, 32000),
      idToken: string(value.id_token ?? previous?.idToken, 32000), expiresAt: Date.now() + seconds * 1000, scopes, clientId, subject };
  }
  async access(connectionId: string): Promise<string> {
    return this.locked(connectionId, async () => {
      const c = this.store.read().connections.find(x => x.id === connectionId);
      let tokens = this.vault.get<TokenSet>(connectionId);
      if (!c || c.kind !== 'openai-oauth' || c.status === 'auth_required' || !tokens || tokens.clientId !== c.clientId || tokens.subject !== c.subject
        || !tokens.scopes.includes('resource.invoke') || !tokens.scopes.includes('chatgpt.tokens.use.direct')) throw new AppError('auth_required', 409);
      if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
      try {
        const value = await this.post(TOKEN, { grant_type: 'refresh_token', client_id: tokens.clientId, refresh_token: tokens.refreshToken, resource: RESOURCE });
        if (value.id_token) {
          const identity = await this.identity(string(value.id_token, 32000), tokens.clientId);
          if (identity.sub !== tokens.subject) throw new AppError('oauth_account_mismatch');
        }
        const scopes = value.scope === undefined ? tokens.scopes : string(value.scope, 4000).split(/\s+/);
        if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw new AppError('plan_permission_missing');
        tokens = this.tokens(value, tokens.clientId, tokens.subject, scopes, tokens);
        this.vault.put(connectionId, tokens); return tokens.accessToken;
      } catch {
        this.store.transact((s, emit) => { const connection = s.connections.find(x => x.id === connectionId)!;
          connection.status = 'auth_required'; connection.error = 'refresh_failed';
          emit({ type: 'connection.auth_required', discussionId: null, data: { connectionId } }); });
        throw new AppError('auth_required', 409);
      }
    });
  }
  async signOut(connectionId: string): Promise<{ revoked: boolean }> {
    for (const [key, a] of this.attempts) if (a.connectionId === connectionId) this.attempts.delete(key);
    return this.locked(connectionId, async () => {
      this.store.transact(s => { const c = s.connections.find(x => x.id === connectionId && x.kind === 'openai-oauth'); if (!c) throw new AppError('connection_not_found', 404); c.status = 'auth_required'; });
      const tokens = this.vault.get<TokenSet>(connectionId); let revoked = !tokens;
      try {
        if (tokens) {
          const metadata = await this.metadata(); const endpoint = authUrl(metadata.revocation_endpoint);
          const res = await this.request(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: 'refresh_token', client_id: tokens.clientId }) });
          revoked = res.status === 200;
        }
      } catch { revoked = false; }
      this.vault.remove(connectionId);
      this.store.transact((s, emit) => { const c = s.connections.find(x => x.id === connectionId)!; c.models = []; c.error = revoked ? '' : 'remote_revocation_unconfirmed';
        emit({ type: 'connection.signed_out', discussionId: null, data: { connectionId, revoked } }); });
      return { revoked };
    });
  }
  private async metadata(): Promise<Record<string, unknown>> {
    const res = await this.request(`${ISSUER}/.well-known/openid-configuration`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new AppError('oidc_discovery_failed', 502);
    const metadata = object(await res.json()); if (metadata.issuer !== ISSUER) throw new AppError('invalid_issuer'); return metadata;
  }
  private async identity(token: string, clientId: string, nonce?: string): Promise<{ sub: string; email: string | undefined }> {
    const metadata = await this.metadata();
    const res = await this.request(authUrl(metadata.jwks_uri), { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new AppError('jwks_failed', 502);
    const keys = object(await res.json());
    if (!Array.isArray(keys.keys)) throw new AppError('invalid_jwks');
    const { payload } = await jwtVerify(token, createLocalJWKSet(keys as unknown as JSONWebKeySet), {
      issuer: ISSUER, audience: clientId, algorithms: ['RS256', 'PS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
    });
    if (nonce !== undefined && (typeof payload.nonce !== 'string' || !equal(payload.nonce, nonce))) throw new AppError('invalid_nonce');
    if (typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 5 || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new AppError('invalid_identity_claims');
    return { sub: string(payload.sub), email: typeof payload.email === 'string' ? payload.email : undefined };
  }
  private async post(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.request(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    if (!response.ok) throw new AppError('oauth_exchange_failed', 502);
    return object(await response.json());
  }
  close(): void { this.attempts.clear(); this.server?.close(); this.server?.closeAllConnections(); }
}
function equal(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function authUrl(value: unknown): string { const url = new URL(string(value, 2000)); if (url.origin !== ISSUER || url.username || url.password) throw new AppError('invalid_oidc_endpoint'); return url.href; }
