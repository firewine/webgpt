import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { WorkspaceConfig } from './config.js';
import type { BrowserBinding, Connection, Member } from './model.js';
import { Store } from './store.js';
import { Vault } from './vault.js';
import { AppError, digest, id, now, object, string } from './util.js';
import { OAuthService } from '../connections/oauth.js';
import { Providers } from '../connections/providers.js';
import { BrowserBridge, validateBinding } from '../connections/browser.js';
import { DiscussionEngine, findDiscussion } from './engine.js';
import { CodexExecutor } from '../execution/codex.js';

export class Workspace {
  readonly store: Store; readonly vault: Vault; readonly oauth: OAuthService; readonly browser: BrowserBridge;
  readonly providers: Providers; readonly engine: DiscussionEngine; readonly codex: CodexExecutor;
  readonly accessHash: string;
  constructor(readonly config: WorkspaceConfig, fakeDelay = 80) {
    this.store = new Store(config.stateDir);
    this.vault = new Vault(join(config.stateDir, 'credentials'));
    const accessPath = join(config.stateDir, 'access-token');
    let token = config.accessToken;
    if (!token) {
      try { writeFileSync(accessPath, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600, flush: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      chmodSync(accessPath, 0o600); token = readFileSync(accessPath, 'utf8').trim();
    }
    if (token.length < 32) throw new AppError('invalid_access_token', 500);
    this.accessHash = digest(token);
    this.oauth = new OAuthService(this.store, this.vault, config.oauthPort);
    this.browser = new BrowserBridge(this.store, config.chromeCommand);
    this.providers = new Providers(this.store, this.vault, this.oauth, this.browser, fetch, fakeDelay);
    this.engine = new DiscussionEngine(this.store, this.providers, config);
    mkdirSync(config.chromeProfileDir, { recursive: true, mode: 0o700 });
    this.codex = new CodexExecutor(this.store, config.codexCommand, config.workspaceRoots, [config.stateDir, config.chromeProfileDir]);
    this.engine.executor = this.codex; this.codex.onProgress = () => this.engine.kick();
  }
  start(): void { this.codex.recover(); this.engine.recover(); }
  snapshot() {
    const state = this.store.read();
    return { cursor: this.store.cursor(), connections: state.connections, participants: state.participants,
      discussions: state.discussions.map(d => ({ id: d.id, topic: d.topic, status: d.status, phase: d.phase, revision: d.revision, createdAt: d.createdAt, updatedAt: d.updatedAt })),
      bindings: state.bindings, jobs: state.jobs.slice(-50), browserPaused: state.browserPaused,
      capabilities: { sourceFetch: this.config.sourceFetch, browserConfigured: !!this.config.chromeCommand,
        noVncConfigured: this.config.noVncPort !== null, codexConfigured: this.config.workspaceRoots.length > 0 },
      grants: state.grants.map(({ hash: _hash, ...grant }) => grant) };
  }
  discussion(discussionId: string) { return { discussion: findDiscussion(this.store.read(), discussionId), cursor: this.store.cursor() }; }
  async addDeepSeek(input: unknown): Promise<string> {
    const body = object(input); const key = string(body.key, 4096); const connectionId = id('connection');
    const connection: Connection = { id: connectionId, kind: 'deepseek', label: string(body.label, 80), status: 'unverified', models: [] };
    this.vault.put(connectionId, { key });
    this.store.transact((s, emit) => { s.connections.push(connection); emit({ type: 'connection.added', discussionId: null, data: { connectionId } }); });
    try { await this.refreshModels(connectionId); } catch { /* preserve the connection and public failure state for the owner */ }
    return connectionId;
  }
  async refreshModels(connectionId: string): Promise<void> {
    try {
      const models = await this.providers.models(connectionId);
      this.store.transact((s, emit) => { const c = s.connections.find(x => x.id === connectionId)!;
        c.models = models; c.status = 'connected'; c.error = ''; c.lastCheckedAt = now();
        emit({ type: 'connection.models', discussionId: null, data: { connectionId } }); });
    } catch (error) {
      this.store.transact((s, emit) => { const c = s.connections.find(x => x.id === connectionId); if (!c) return;
        c.error = error instanceof AppError ? error.code : 'model_discovery_failed'; c.status = c.error === 'auth_required' ? 'auth_required' : 'error';
        emit({ type: 'connection.failed', discussionId: null, data: { connectionId, code: c.error } }); }); throw error;
    }
  }
  async addBrowser(input: unknown): Promise<string> {
    const body = object(input); const raw = object(body.binding);
    const existing = body.connectionId ? this.store.read().connections.find(c => c.id === body.connectionId && c.kind === 'browser') : null;
    if (body.connectionId && !existing) throw new AppError('connection_not_found', 404);
    if (existing) this.assertNoActiveTurn(existing.id);
    const binding: BrowserBinding = { pageId: Number(raw.pageId), url: string(raw.url, 2000), accountLabel: string(raw.accountLabel, 100), agentLabel: string(raw.agentLabel, 100),
      identitySelector: string(raw.identitySelector, 500), identityText: string(raw.identityText, 500), inputSelector: string(raw.inputSelector, 500), sendSelector: string(raw.sendSelector, 500),
      userSelector: string(raw.userSelector, 500), assistantSelector: string(raw.assistantSelector, 500), busySelector: string(raw.busySelector, 500), readySelector: string(raw.readySelector, 500) };
    validateBinding(binding);
    if (existing?.browser && ['url', 'accountLabel', 'agentLabel', 'identityText'].some(key => existing.browser![key as keyof BrowserBinding] !== binding[key as keyof BrowserBinding])) throw new AppError('browser_identity_change_not_allowed', 409);
    await this.browser.probe(binding);
    const connectionId = existing?.id ?? id('connection');
    this.store.transact((s, emit) => {
      if (s.connections.some(c => c.id !== connectionId && c.browser && (c.browser.pageId === binding.pageId || c.browser.url === binding.url))) throw new AppError('browser_already_bound', 409);
      const connection: Connection = { id: connectionId, kind: 'browser', label: string(body.label, 80), status: 'connected', browser: binding,
        models: [{ id: 'existing-agent', label: binding.agentLabel }], lastCheckedAt: now() };
      const index = s.connections.findIndex(c => c.id === connectionId); if (index >= 0) s.connections[index] = connection; else s.connections.push(connection);
      emit({ type: 'connection.added', discussionId: null, data: { connectionId } });
    }); return connectionId;
  }
  participant(input: unknown): string {
    const body = object(input); const participantId = id('participant');
    this.store.transact((s, emit) => {
      const connection = s.connections.find(c => c.id === body.connectionId && c.status === 'connected');
      if (!connection) throw new AppError('connection_not_ready', 409);
      const modelId = string(body.modelId, 200); if (!connection.models.some(m => m.id === modelId)) throw new AppError('model_not_available', 409);
      if (connection.kind === 'browser' && s.participants.some(p => p.connectionId === connection.id)) throw new AppError('browser_participant_already_exists', 409);
      const member: Member = { id: participantId, label: string(body.label, 80), kind: connection.kind, connectionId: connection.id,
        modelId, role: string(body.role ?? '', 500, true) };
      s.participants.push(member); emit({ type: 'participant.added', discussionId: null, data: { participantId } });
    }); return participantId;
  }
  assertConnectionIdle(connectionId: string): void {
    if (this.store.read().discussions.some(d => ['running', 'paused', 'blocked'].includes(d.status) && d.members.some(p => p.connectionId === connectionId))) throw new AppError('connection_in_use', 409);
  }
  assertNoActiveTurn(connectionId: string): void {
    if (this.store.read().discussions.some(d => d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status) && d.members.some(p => p.id === t.participantId && p.connectionId === connectionId)))) throw new AppError('reconciliation_required', 409);
  }
  async replaceKey(connectionId: string, key: string): Promise<void> {
    this.assertNoActiveTurn(connectionId);
    if (!this.store.read().connections.some(c => c.id === connectionId && c.kind === 'deepseek')) throw new AppError('connection_not_found', 404);
    this.vault.put(connectionId, { key: string(key, 4096) }); await this.refreshModels(connectionId);
  }
  browserControl(paused: boolean): void {
    this.store.transact((s, emit) => {
      if (paused && s.discussions.some(d => d.turns.some(t => ['prepared', 'running'].includes(t.status) && d.members.some(p => p.id === t.participantId && p.kind === 'browser')))) throw new AppError('browser_turn_active', 409);
      if (s.browserPaused === paused) return;
      s.browserPaused = paused; emit({ type: 'browser.manual_control', discussionId: null, data: { paused } });
    });
  }
  async close(): Promise<void> { const stopping = this.engine.close(); this.codex.close(); this.browser.close(); this.oauth.close(); await stopping; this.store.close(); }
}
