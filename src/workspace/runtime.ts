import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { WorkspaceConfig } from './config.js';
import type { BrowserBinding, Connection, Member } from './model.js';
import { Store } from './store.js';
import { Vault } from './vault.js';
import { AppError, digest, id, now, object, string } from './util.js';
import { OAuthService } from '../connections/oauth.js';
import { CodexOAuth } from '../connections/codex-oauth.js';
import { Providers } from '../connections/providers.js';
import { deepSeekService } from '../connections/deepseek-services.js';
import { BrowserBridge, validateBinding } from '../connections/browser.js';
import { BrowserDiscovery } from '../connections/browser-discovery.js';
import { DiscussionEngine, findDiscussion } from './engine.js';
import { CodexExecutor } from '../execution/codex.js';
import { modelEffort, oauthKind } from './settings.js';
import { LocalMaterials, materialMetadata } from './materials.js';
import { inspectCapabilities, installedVersion } from './capabilities.js';
import { ResidentStore } from './resident-store.js';
import { DispatchCoordinator } from './dispatch.js';
import { ResidentRunner } from './resident-runner.js';
import { FakeResidentCompletion } from './resident-fake.js';
import { WorkQueue } from './work-queue.js';
import { WorkExecutionBridge, validateWorkExecutionState } from './work-execution.js';
import { Wiki, validateWikiState } from './wiki.js';
import { ResidentMcp } from './resident-mcp.js';
import { validateTopicIntents } from './resident-focus.js';

export class Workspace {
  readonly store: Store; readonly vault: Vault; readonly oauth: OAuthService; readonly browser: BrowserBridge;
  readonly providers: Providers; readonly engine: DiscussionEngine; readonly codex: CodexExecutor;
  readonly codexOAuth: CodexOAuth;
  readonly accessHash: string;
  readonly materials: LocalMaterials;
  readonly resident: ResidentStore;
  readonly browserDiscovery: BrowserDiscovery;
  readonly dispatch: DispatchCoordinator; readonly residentRunner: ResidentRunner;
  readonly workQueue: WorkQueue;
  readonly workExecution: WorkExecutionBridge;
  readonly wiki: Wiki;
  readonly residentMcp: ResidentMcp;
  constructor(readonly config: WorkspaceConfig, fakeDelay = 80, options: { residentProvider?: Pick<Providers, 'complete'>; residentClock?: () => number; residentAutoSchedule?: boolean } = {}) {
    this.store = new Store(config.stateDir);
    this.dispatch = new DispatchCoordinator(config.residentEnabled);
    try { this.resident = new ResidentStore(this.store, config.residentEnabled); validateTopicIntents(this.store.read()); validateWikiState(this.store.read()); validateWorkExecutionState(this.store.read(), this.store); this.workQueue = new WorkQueue(this.store, config.residentEnabled, this.dispatch); this.wiki = new Wiki(this.store, config.residentEnabled); }
    catch (error) { this.store.close(); throw error; }
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
    this.codexOAuth = new CodexOAuth(this.store, this.vault, this.oauth);
    this.browser = new BrowserBridge(this.store, config.chromeCommand);
    this.browserDiscovery = new BrowserDiscovery(this.browser);
    this.providers = new Providers(this.store, this.vault, this.oauth, this.browser, fetch, fakeDelay, this.codexOAuth, async () => {
      const observed = await installedVersion(config.codexCommand); if (observed.status !== 'observed' || !observed.version) throw new AppError('codex_version_required', 409); return observed.version;
    });
    this.workQueue.wiki = this.wiki;
    this.dispatch.workGuard = (state, turn) => this.workQueue.canDispatch(state, turn);
    this.engine = new DiscussionEngine(this.store, this.providers, config, undefined, this.dispatch);
    this.materials = new LocalMaterials(config.materialRoots, [config.stateDir, config.chromeProfileDir]);
    this.engine.materials = this.materials;
    mkdirSync(config.chromeProfileDir, { recursive: true, mode: 0o700 });
    this.codex = new CodexExecutor(this.store, config.codexCommand, config.workspaceRoots, [config.stateDir, config.chromeProfileDir]);
    this.workExecution = new WorkExecutionBridge(this.store, this.workQueue, this.codex, config.residentEnabled, config.turnTimeoutMs);
    this.codex.workScopeGuard = (state, job, phase) => this.workExecution.guard(state, job, phase);
    this.engine.executor = this.codex;
    this.codex.beforeDispatch = (state, job) => this.dispatch.validateToolDispatch(state, job);
    this.residentRunner = new ResidentRunner(this.store, this.resident, this.dispatch,
      options.residentProvider ?? new FakeResidentCompletion(this.providers, fakeDelay), this.engine, config.turnTimeoutMs,
      { work: this.workQueue, wiki: this.wiki, execution: this.workExecution, ...(options.residentClock ? { clock: options.residentClock } : {}), ...(options.residentAutoSchedule !== undefined ? { autoSchedule: options.residentAutoSchedule } : {}) });
    this.resident.dispatchAvailable = true;
    this.residentMcp = new ResidentMcp(this);
    this.codex.onProgress = () => { this.engine.kick(); this.residentRunner.kick(); };
  }
  start(): void { this.workExecution.recover(); this.residentRunner.recover(); this.codex.recover(); this.engine.recover(); this.residentRunner.start(); }
  snapshot() {
    const state = this.store.read();
    return { cursor: this.store.cursor(), connections: state.connections, participants: state.participants,
      discussions: state.discussions.map(d => ({ id: d.id, topic: d.topic, status: d.status, phase: d.phase, revision: d.revision, createdAt: d.createdAt, updatedAt: d.updatedAt })),
      bindings: state.bindings, jobs: state.jobs.slice(-50), browserPaused: state.browserPaused,
      materialPackages: (state.materialPackages ?? []).map(materialMetadata), materialRoots: this.config.materialRoots,
      resident: this.resident.snapshot(),
      capabilities: { sourceFetch: this.config.sourceFetch, browserConfigured: !!this.config.chromeCommand,
        noVncConfigured: this.config.noVncPort !== null, codexConfigured: this.config.workspaceRoots.length > 0 },
      grants: state.grants.map(({ hash: _hash, ...grant }) => grant) };
  }
  discussion(discussionId: string) { return { discussion: findDiscussion(this.store.read(), discussionId), cursor: this.store.cursor() }; }
  prepareMaterials(input: unknown, requestId: string): string {
    return this.store.transact((s, emit) => {
      const pack = this.materials.prepare(input); (s.materialPackages ??= []).push(pack);
      emit({ type: 'materials.prepared', discussionId: null, data: { packageId: pack.id } }); return pack.id;
    }, { id: requestId, input: { action: 'materials.prepare', input } });
  }
  capabilities(scope?: { discussionId: string; participantId: string; tools: string[] }) { return inspectCapabilities(this, scope); }
  async addDeepSeek(input: unknown): Promise<string> {
    const body = object(input); const key = string(body.key, 4096); const connectionId = id('connection');
    const connection: Connection = { id: connectionId, kind: 'deepseek', label: string(body.label, 80), apiService: deepSeekService(body.apiService), status: 'unverified', models: [] };
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
  async discoverBrowser(input: unknown) {
    const body = object(input); const c = body.connectionId ? this.store.read().connections.find(c => c.id === body.connectionId && c.kind === 'browser') : null;
    if (body.connectionId && !c?.browser) throw new AppError('connection_not_found', 404);
    if (c) this.assertNoActiveTurn(c.id);
    return this.browserDiscovery.discover(input, c?.browser ? { id: c.id, browser: c.browser } : undefined);
  }
  async confirmBrowser(input: unknown, requestId: string): Promise<string> {
    const body = object(input); const candidate = await this.browserDiscovery.resolve(body);
    return this.addBrowser({ label: string(body.label, 80), ...(candidate.connectionId ? { connectionId: candidate.connectionId } : {}), binding: candidate.binding }, requestId, candidate.binding.discovery);
  }
  async addBrowser(input: unknown, requestId?: string, discovery?: BrowserBinding['discovery']): Promise<string> {
    const body = object(input); const raw = object(body.binding);
    const existing = body.connectionId ? this.store.read().connections.find(c => c.id === body.connectionId && c.kind === 'browser') : null;
    if (body.connectionId && !existing) throw new AppError('connection_not_found', 404);
    if (existing) this.assertNoActiveTurn(existing.id);
    const binding: BrowserBinding = { pageId: Number(raw.pageId), url: string(raw.url, 2000), accountLabel: string(raw.accountLabel, 100), agentLabel: string(raw.agentLabel, 100),
      identitySelector: string(raw.identitySelector, 500), identityText: string(raw.identityText, 500), inputSelector: string(raw.inputSelector, 500), sendSelector: string(raw.sendSelector, 500),
      userSelector: string(raw.userSelector, 500), assistantSelector: string(raw.assistantSelector, 500), busySelector: string(raw.busySelector, 500), readySelector: string(raw.readySelector, 500) };
    if (raw.thread !== undefined) {
      const thread = object(raw.thread);
      binding.thread = { selector: string(thread.selector, 500), attribute: string(thread.attribute, 100), value: string(thread.value, 500),
        ...(thread.jsonKey !== undefined ? { jsonKey: string(thread.jsonKey, 100) } : {}) };
    }
    if (raw.sendAppearsAfterInput !== undefined) {
      if (typeof raw.sendAppearsAfterInput !== 'boolean') throw new AppError('invalid_input');
      binding.sendAppearsAfterInput = raw.sendAppearsAfterInput;
    }
    // Discovery evidence is server-owned. Manual requests cannot forge a probe.
    if (discovery) binding.discovery = discovery;
    else if (existing?.browser?.discovery) binding.discovery = existing.browser.discovery;
    validateBinding(binding);
    if (existing?.browser && ['url', 'accountLabel', 'agentLabel', 'identityText'].some(key => existing.browser![key as keyof BrowserBinding] !== binding[key as keyof BrowserBinding])) throw new AppError('browser_identity_change_not_allowed', 409);
    if (existing?.browser && existing.browser.thread?.value !== binding.thread?.value) throw new AppError('browser_identity_change_not_allowed', 409);
    await this.browser.probe(binding);
    if (requestId) {
      const observation = await this.browser.inspect(binding);
      if (observation.draft || observation.busy === true || observation.ready !== true) throw new AppError('browser_discovery_changed', 409);
      if (observation.identity !== true || observation.thread !== true || observation.url !== binding.url) throw new AppError('browser_target_mismatch', 409);
    }
    const connectionId = existing?.id ?? id('connection');
    return this.store.transact((s, emit) => {
      // Probe awaits external observation. Recheck active/uncertain work and the
      // exact prior binding inside the save transaction, never update mid-turn.
      if (existing) {
        this.assertNoActiveTurn(existing.id);
        if (JSON.stringify(s.connections.find(c => c.id === existing.id)?.browser) !== JSON.stringify(existing.browser)) throw new AppError('browser_binding_changed', 409);
      }
      if (s.connections.some(c => c.id !== connectionId && c.browser && (c.browser.pageId === binding.pageId || c.browser.url === binding.url))) throw new AppError('browser_already_bound', 409);
      const connection: Connection = { id: connectionId, kind: 'browser', label: string(body.label, 80), status: 'connected', browser: binding,
        models: [{ id: 'existing-agent', label: binding.agentLabel }], lastCheckedAt: now() };
      if (existing?.browser) connection.browserHistory = [...(existing.browserHistory ?? []), { changedAt: now(), binding: existing.browser }];
      const index = s.connections.findIndex(c => c.id === connectionId); if (index >= 0) s.connections[index] = connection; else s.connections.push(connection);
      emit({ type: 'connection.added', discussionId: null, data: { connectionId } });
      return connectionId;
    }, requestId ? { id: 'browser:confirm:' + requestId, input: body } : undefined);
  }
  participant(input: unknown, existingId?: string): string {
    const body = object(input); const participantId = existingId ?? id('participant');
    this.store.transact((s, emit) => {
      const existing = existingId ? s.participants.find(p => p.id === existingId) : undefined;
      if (existingId && !existing) throw new AppError('participant_not_found', 404);
      if (existing && body.connectionId !== existing.connectionId && (s.resident?.rooms.some(r => r.contexts?.some(c => c.participantId === existing.id && c.history.length > 0)) ||
          s.resident?.turns.some(t => t.participantId === existing.id && ['prepared', 'running', 'unconfirmed'].includes(t.status)))) throw new AppError('resident_account_change_requires_new_participant', 409);
      const connection = s.connections.find(c => c.id === body.connectionId && c.status === 'connected');
      if (!connection) throw new AppError('connection_not_ready', 409);
      if (body.reasoningEffort !== undefined && !oauthKind(connection.kind)) throw new AppError('reasoning_requires_oauth', 409);
      const modelId = string(body.modelId, 200); if (!connection.models.some(m => m.id === modelId)) throw new AppError('model_not_available', 409);
      if (connection.kind === 'browser' && s.participants.some(p => p.id !== participantId && p.connectionId === connection.id)) throw new AppError('browser_participant_already_exists', 409);
      const member: Member = { id: participantId, label: string(body.label, 80), kind: connection.kind, connectionId: connection.id,
        modelId, role: string(body.role ?? '', 500, true),
        ...(oauthKind(connection.kind) ? { reasoningEffort: modelEffort(connection, modelId, body.reasoningEffort, existing?.reasoningEffort) } : {}) };
      if (existing) s.participants[s.participants.indexOf(existing)] = member; else s.participants.push(member);
      emit({ type: existing ? 'participant.updated' : 'participant.added', discussionId: null, data: { participantId } });
    }); return participantId;
  }
  assertConnectionIdle(connectionId: string): void {
    const state = this.store.read();
    if (state.resident?.rooms.some(r => r.desiredOn && r.members.some(m => m.enabled && state.participants.some(p => p.id === m.participantId && p.connectionId === connectionId))) ||
        state.resident?.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status) && t.participant?.connectionId === connectionId) ||
        state.discussions.some(d => ['running', 'paused', 'blocked'].includes(d.status) && d.members.some(p => p.connectionId === connectionId))) throw new AppError('connection_in_use', 409);
  }
  assertNoActiveTurn(connectionId: string): void {
    if (this.store.read().resident?.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status) && t.participant?.connectionId === connectionId)) throw new AppError('reconciliation_required', 409);
    if (this.store.read().discussions.some(d => d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status) && d.members.some(p => p.id === t.participantId && p.connectionId === connectionId)))) throw new AppError('reconciliation_required', 409);
  }
  async replaceKey(connectionId: string, key: string): Promise<void> {
    this.assertNoActiveTurn(connectionId);
    if (!this.store.read().connections.some(c => c.id === connectionId && c.kind === 'deepseek')) throw new AppError('connection_not_found', 404);
    this.vault.put(connectionId, { key: string(key, 4096) }); await this.refreshModels(connectionId);
  }
  browserControl(paused: boolean): void {
    this.store.transact((s, emit) => {
      if (paused && s.resident?.turns.some(t => ['prepared', 'running'].includes(t.status) && t.participant?.kind === 'browser')) throw new AppError('browser_turn_active', 409);
      if (paused && s.discussions.some(d => d.turns.some(t => ['prepared', 'running'].includes(t.status) && d.members.some(p => p.id === t.participantId && p.kind === 'browser')))) throw new AppError('browser_turn_active', 409);
      if (s.browserPaused === paused) return;
      s.browserPaused = paused; emit({ type: 'browser.manual_control', discussionId: null, data: { paused } });
    });
  }
  async close(): Promise<void> { const stopping = Promise.all([this.engine.close(), this.residentRunner.close(), this.codexOAuth.close()]); this.codex.close(); this.browser.close(); this.oauth.close(); await stopping; this.store.close(); }
}
