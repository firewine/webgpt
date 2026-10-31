import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Store } from '../workspace/store.js';
import type { Vault } from '../workspace/vault.js';
import type { Connection, DeviceSignin } from '../workspace/model.js';
import type { OAuthService } from './oauth.js';
import { AppError, code, id, now, object, string } from '../workspace/util.js';

// Codex's public OAuth client/grant, distinct from the SIWC dynamic client.
// Protocol sources and approval: docs/reviews/opencodex-login-review-20261031.md.
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const AUTH = 'https://auth.openai.com', TTL = 15 * 60_000;
type Status = NonNullable<Connection['deviceSignin']>['status'];
interface Tokens { kind: 'codex-oauth'; accessToken: string; refreshToken: string; idToken: string; subject: string; accountId: string; expiresAt: number }
interface Attempt { connectionId: string; id: string; status: Status; deadline: number; interval: number; deviceId: string; userCode: string; controller: AbortController; error: string | null; ready: Promise<void>; run?: Promise<void> }

export class CodexOAuth {
  private readonly attempts = new Map<string, Attempt>(); private readonly locks = new Map<string, Promise<unknown>>(); private closed = false;
  private readonly shutdown = new AbortController();
  constructor(private readonly store: Store, private readonly vault: Vault, private readonly verifier: Pick<OAuthService, 'identity'>,
    private readonly request: typeof fetch = fetch, private readonly options: { clock?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<void> } = {}) {}
  private clock() { return (this.options.clock ?? Date.now)(); }
  private async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const last = this.locks.get(key) ?? Promise.resolve(); const next = last.catch(() => {}).then(action); this.locks.set(key, next);
    try { return await next; } finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }
  async begin(input: unknown, requestId: string): Promise<DeviceSignin> {
    if (this.closed) throw new AppError('device_login_interrupted', 409);
    const b = object(input); if (Object.keys(b).some(k => !['label', 'expectedEmail', 'connectionId'].includes(k))) throw new AppError('invalid_input');
    const email = typeof b.expectedEmail === 'string' ? b.expectedEmail.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('account_email_required');
    const label = string(b.label, 80), existingId = b.connectionId ? string(b.connectionId, 100) : null;
    const key = 'codex:signin:' + string(requestId, 200), commandInput = { label, email, existingId };
    const cached = this.store.readCommand<{ connectionId: string; attemptId: string }>(key, commandInput);
    if (cached.found) {
      const a = this.attempts.get(cached.result.connectionId);
      if (!a || a.id !== cached.result.attemptId) throw new AppError('device_login_interrupted', 409);
      await a.ready; return this.public(a);
    }
    const live = existingId ? this.attempts.get(existingId) : [...this.attempts.values()].find(a => ['starting', 'pending'].includes(a.status) && a.deadline > this.clock() && this.store.read().connections.some(c => c.id === a.connectionId && c.expectedEmail === email));
    if (live && ['starting', 'pending'].includes(live.status) && this.clock() >= live.deadline) { live.controller.abort(); this.transition(live, 'expired', 'device_login_expired'); }
    if ((!live || !['starting', 'pending'].includes(live.status)) && [...this.attempts.values()].filter(a => ['starting', 'pending'].includes(a.status)).length >= 8) throw new AppError('too_many_signins', 429);
    const result = this.store.transact((s, emit) => {
      const c = existingId || live ? s.connections.find(c => c.id === (existingId ?? live?.connectionId) && c.kind === 'codex-oauth') : undefined;
      if (existingId && !c) throw new AppError('connection_not_found', 404);
      if (c?.expectedEmail && c.expectedEmail !== email || c?.email && c.email.toLowerCase() !== email) throw new AppError('oauth_account_mismatch', 409);
      if (live && ['starting', 'pending'].includes(live.status)) return { connectionId: live.connectionId, attemptId: live.id };
      const connectionId = c?.id ?? id('connection'), attemptId = id('device_signin');
      const connection: Connection = c ?? { id: connectionId, kind: 'codex-oauth', label, status: 'auth_required', models: [] };
      connection.expectedEmail = email; connection.deviceSignin = { attemptId, status: 'starting' }; connection.error = '';
      if (!c) s.connections.push(connection);
      emit({ type: 'connection.signin_started', discussionId: null, data: { connectionId, attemptId } }); return { connectionId, attemptId };
    }, { id: key, input: commandInput });
    if (live?.id === result.attemptId) { await live.ready; return this.public(live); }
    while (this.attempts.size >= 32) { const old = [...this.attempts.entries()].find(([, a]) => !['starting', 'pending'].includes(a.status)); if (!old) break; this.attempts.delete(old[0]); }
    const a: Attempt = { connectionId: result.connectionId, id: result.attemptId, status: 'starting', deadline: this.clock() + TTL, interval: 5000,
      deviceId: '', userCode: '', controller: new AbortController(), error: null, ready: Promise.resolve() };
    this.attempts.set(a.connectionId, a);
    a.ready = (async () => {
      try {
        const res = await this.fetch('/api/accounts/deviceauth/usercode', { client_id: CODEX_CLIENT_ID }, a);
        if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new AppError(res.status === 403 || res.status === 404 ? 'device_login_unavailable' : 'device_login_start_failed', 502); }
        const value = await readCodexJson(res); this.current(a);
        a.deviceId = string(value.device_auth_id, 4096); a.userCode = string(value.user_code ?? value.usercode, 100);
        const interval = Number(value.interval); a.interval = Number.isFinite(interval) && interval > 0 ? Math.max(1000, Math.min(TTL, Math.round(interval * 1000))) : 5000;
        this.transition(a, 'pending'); a.run = this.run(a);
      } catch (e) { if (!this.closed && !a.controller.signal.aborted) this.transition(a, 'failed', code(e)); throw new AppError(a.error ?? 'device_login_start_failed', 502); }
    })();
    await a.ready; return this.public(a);
  }
  status(connectionId: string, attemptId?: string): DeviceSignin {
    const c = this.connection(connectionId), a = this.attempts.get(connectionId);
    if (!a || attemptId && a.id !== attemptId) return { connectionId, attemptId: attemptId ?? c.deviceSignin?.attemptId ?? '', status: 'interrupted', expiresAt: 0, error: 'device_login_interrupted' };
    return this.public(a);
  }
  cancel(connectionId: string, attemptId: string): void {
    this.connection(connectionId); const a = this.attempts.get(connectionId);
    if (!a || a.id !== attemptId || !['starting', 'pending'].includes(a.status)) throw new AppError('device_login_not_pending', 409);
    a.controller.abort(); this.transition(a, 'cancelled', 'device_login_cancelled');
  }
  private current(a: Attempt): void {
    a.controller.signal.throwIfAborted();
    if (this.closed || this.attempts.get(a.connectionId) !== a || this.clock() >= a.deadline) throw new AppError('device_login_expired', 409);
  }
  private async fetch(path: string, body: Record<string, string>, a?: Attempt, form = false): Promise<Response> {
    return this.request(AUTH + path, { method: 'POST', redirect: 'error', signal: AbortSignal.any([this.shutdown.signal, ...(a ? [a.controller.signal] : []), AbortSignal.timeout(30_000)]),
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json' }, body: form ? new URLSearchParams(body) : JSON.stringify(body) });
  }
  private async run(a: Attempt): Promise<void> {
    try {
      while (true) {
        this.current(a); const ms = Math.min(a.interval, a.deadline - this.clock());
        if (this.options.wait) await this.options.wait(ms, a.controller.signal); else await delay(ms, undefined, { signal: a.controller.signal, ref: false });
        this.current(a);
        const res = await this.fetch('/api/accounts/deviceauth/token', { device_auth_id: a.deviceId, user_code: a.userCode }, a); this.current(a);
        if (res.status === 403 || res.status === 404) { await res.body?.cancel(); continue; }
        if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new AppError('device_login_poll_failed', 502); }
        const grant = await readCodexJson(res); const verifier = string(grant.code_verifier, 8192);
        if (grant.code_challenge !== undefined && createHash('sha256').update(verifier).digest('base64url') !== grant.code_challenge) throw new AppError('invalid_device_pkce');
        const tokens = await this.fetch('/oauth/token', { grant_type: 'authorization_code', client_id: CODEX_CLIENT_ID, code: string(grant.authorization_code, 8192), code_verifier: verifier, redirect_uri: AUTH + '/deviceauth/callback' }, a, true);
        if (!tokens.ok) { await tokens.body?.cancel().catch(() => {}); throw new AppError('oauth_exchange_failed', 502); }
        const value = await readCodexJson(tokens); this.current(a);
        await this.locked(a.connectionId, async () => {
          const c = this.connection(a.connectionId); const next = await this.tokens(value, c); this.current(a);
          this.vault.put(c.id, next);
          this.store.transact((s, emit) => { const current = s.connections.find(c => c.id === a.connectionId)!;
            current.subject = next.subject; current.accountId = next.accountId; current.email = current.expectedEmail!; current.clientId = CODEX_CLIENT_ID; current.status = 'connected'; current.error = ''; current.lastCheckedAt = now();
            emit({ type: 'connection.authenticated', discussionId: null, data: { connectionId: current.id, status: current.status } }); });
          this.transition(a, 'completed');
        }); return;
      }
    } catch (e) { if (!this.closed && !a.controller.signal.aborted) this.transition(a, code(e) === 'device_login_expired' ? 'expired' : 'failed', code(e)); }
  }
  private async tokens(value: Record<string, unknown>, c: Connection, previous?: Tokens): Promise<Tokens> {
    if (value.token_type !== undefined && String(value.token_type).toLowerCase() !== 'bearer') throw new AppError('invalid_token_response');
    const idToken = string(value.id_token ?? previous?.idToken, 32000);
    const verified = value.id_token !== undefined || !previous ? await this.verifier.identity(idToken, CODEX_CLIENT_ID) : null;
    const identity = verified ?? { sub: previous!.subject, email: c.email, accountId: previous!.accountId };
    if (!identity.email || identity.email.toLowerCase() !== c.expectedEmail || !identity.accountId || c.subject && c.subject !== identity.sub || c.accountId && c.accountId !== identity.accountId) throw new AppError('oauth_account_mismatch', 409);
    const expires = value.expires_in; const reported = typeof expires === 'number' && Number.isFinite(expires) && expires > 0 ? this.clock() + expires * 1000 : null;
    const expiresAt = reported !== null ? Math.min(reported, verified?.expiresAt ?? reported) : verified?.expiresAt ?? NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= this.clock()) throw new AppError('invalid_token_response');
    return { kind: 'codex-oauth', accessToken: string(value.access_token, 32000), refreshToken: string(value.refresh_token ?? previous?.refreshToken, 32000), idToken, subject: identity.sub, accountId: identity.accountId, expiresAt };
  }
  async access(connectionId: string): Promise<{ token: string; accountId: string }> {
    return this.locked(connectionId, async () => {
      if (this.closed) throw new AppError('device_login_interrupted', 409);
      const c = this.connection(connectionId); let t = this.vault.get<Tokens>(connectionId);
      if (c.status === 'auth_required' || !t || t.kind !== 'codex-oauth' || t.subject !== c.subject || t.accountId !== c.accountId) throw new AppError('auth_required', 409);
      if (t.expiresAt <= this.clock() + 60_000) {
        const res = await this.fetch('/oauth/token', { grant_type: 'refresh_token', client_id: CODEX_CLIENT_ID, refresh_token: t.refreshToken }, undefined, true);
        if (!res.ok) { await res.body?.cancel().catch(() => {}); if (res.status === 400 || res.status === 401 || res.status === 403) this.store.transact(s => { const row = s.connections.find(c => c.id === connectionId)!; row.status = 'auth_required'; row.error = 'refresh_failed'; }); throw new AppError('codex_refresh_failed', 502); }
        t = await this.tokens(await readCodexJson(res), c, t); if (this.closed) throw new AppError('device_login_interrupted', 409); this.vault.put(connectionId, t);
      }
      return { token: t.accessToken, accountId: t.accountId };
    });
  }
  async signOut(connectionId: string): Promise<void> {
    if (this.closed) throw new AppError('device_login_interrupted', 409);
    const a = this.attempts.get(connectionId); if (a && ['starting', 'pending'].includes(a.status)) this.cancel(connectionId, a.id);
    await this.locked(connectionId, async () => { this.connection(connectionId); this.vault.remove(connectionId); this.store.transact((s, emit) => { const c = s.connections.find(c => c.id === connectionId)!; c.status = 'auth_required'; c.models = []; c.error = 'remote_revocation_unconfirmed'; emit({ type: 'connection.signed_out', discussionId: null, data: { connectionId, revoked: false } }); }); });
  }
  private connection(connectionId: string): Connection { const c = this.store.read().connections.find(c => c.id === connectionId && c.kind === 'codex-oauth'); if (!c) throw new AppError('connection_not_found', 404); return c; }
  private transition(a: Attempt, status: Status, error: string | null = null): void {
    if (this.closed || this.attempts.get(a.connectionId) !== a) return; a.status = status; a.error = error;
    if (!['starting', 'pending'].includes(status)) { a.deviceId = ''; a.userCode = ''; }
    this.store.transact((s, emit) => { const c = s.connections.find(c => c.id === a.connectionId)!;
      c.deviceSignin = { attemptId: a.id, status }; if (error) c.error = error;
      emit({ type: 'connection.signin_status', discussionId: null, data: { connectionId: c.id, attemptId: a.id, status, error } }); });
  }
  private public(a: Attempt): DeviceSignin { return { connectionId: a.connectionId, attemptId: a.id, status: a.status, expiresAt: a.deadline,
    ...(a.status === 'pending' ? { verificationUrl: CODEX_VERIFICATION_URL, userCode: a.userCode } : {}), ...(a.error ? { error: a.error } : {}) }; }
  async close(): Promise<void> { this.closed = true; this.shutdown.abort(); for (const a of this.attempts.values()) a.controller.abort(); await Promise.allSettled([...this.attempts.values()].flatMap(a => [a.ready, ...(a.run ? [a.run] : [])])); await Promise.allSettled([...this.locks.values()]); }
}
export async function readCodexJson(res: Response, maxBytes = 65_536): Promise<Record<string, unknown>> {
  if (!res.body) throw new AppError('invalid_token_response'); const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) throw new AppError('oauth_response_too_large', 502); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown);
}
