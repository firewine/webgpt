import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Logger } from '../logger.js';
import type { Workspace } from '../workspace/runtime.js';
import { AppError, code, integer, object, string } from '../workspace/util.js';
import { Access } from './access.js';
import { McpEndpoint } from './mcp.js';

const ROOT = new URL('../../client/web/', import.meta.url);
const FILES = [['/', 'control.html', 'text/html'], ['/control.js', 'control.js', 'text/javascript'], ['/room-view.js', 'room-view.js', 'text/javascript'], ['/topic-chat-view.js', 'topic-chat-view.js', 'text/javascript'], ['/wiki-view.js', 'wiki-view.js', 'text/javascript'], ['/control.css', 'control.css', 'text/css']] as const;
export async function createWorkspaceServer(app: Workspace, log: Logger) {
  const access = new Access(app); const mcp = new McpEndpoint(app);
  const assets = new Map(await Promise.all(FILES.map(async ([path, file, type]) => [path as string, { data: await readFile(new URL(file, ROOT)), type }] as const)));
  const streams = new Set<ServerResponse>(); const sockets = new Set<Duplex>();
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    void route(req, res).catch((error: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      if (!(error instanceof AppError)) log({ event: 'request.failed' });
      json(res, error instanceof AppError ? error.status : 500, { error: { code: code(error) } });
    });
  });
  server.on('upgrade', (req, socket, head) => {
    try {
      access.host(req); access.require(req, true); access.origin(req);
      if (req.url?.split('?')[0] !== '/browser/websockify' || app.config.noVncPort === null || !app.store.read().browserPaused) throw new AppError('browser_manual_control_required', 403);
      const upstream = request({ hostname: '127.0.0.1', port: app.config.noVncPort, path: '/websockify', method: 'GET',
        headers: { host: `127.0.0.1:${app.config.noVncPort}`, connection: 'Upgrade', upgrade: 'websocket',
          'sec-websocket-key': req.headers['sec-websocket-key'] ?? '', 'sec-websocket-version': '13',
          ...(req.headers['sec-websocket-protocol'] ? { 'sec-websocket-protocol': req.headers['sec-websocket-protocol'] } : {}) } });
      upstream.setTimeout(10_000, () => upstream.destroy());
      upstream.on('upgrade', (response, peer, upstreamHead) => {
        if (response.statusCode !== 101) { peer.destroy(); socket.destroy(); return; }
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n');
        for (const header of ['sec-websocket-accept', 'sec-websocket-protocol']) if (response.headers[header]) socket.write(`${header}: ${String(response.headers[header])}\r\n`);
        socket.write('\r\n'); if (head.length) peer.write(head); if (upstreamHead.length) socket.write(upstreamHead);
        sockets.add(socket); sockets.add(peer); socket.pipe(peer).pipe(socket);
        const timer = setInterval(() => { if (!access.authenticate(req) || !app.store.read().browserPaused) { peer.destroy(); socket.destroy(); } }, 1000); timer.unref();
        const close = () => { clearInterval(timer); sockets.delete(socket); sockets.delete(peer); peer.destroy(); socket.destroy(); };
        socket.on('close', close); peer.on('close', close); socket.on('error', close); peer.on('error', close);
      });
      upstream.on('response', () => { socket.destroy(); upstream.destroy(); });
      upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); upstream.end();
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
  });
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    access.host(req);
    const url = new URL(req.url ?? '/', app.config.origin); const path = url.pathname;
    const get = req.method === 'GET' || req.method === 'HEAD';
    if (get && assets.has(path)) { const asset = assets.get(path)!; res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); res.end(req.method === 'HEAD' ? undefined : asset.data); return; }
    if (get && path === '/health') { json(res, 200, { status: 'ok', service: 'webjjoku', mode: 'workspace', persistence: 'sqlite' }); return; }
    if (get && path === '/api/auth') { access.origin(req, false); json(res, 200, access.status(req)); return; }
    if (path === '/mcp') {
      const grant = mcp.grant(req.headers.authorization); access.origin(req, false);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new AppError('method_not_allowed', 405); }
      const result = await mcp.handle(await body(req), grant);
      if (result === null) { res.writeHead(202); res.end(); } else json(res, 200, result);
      return;
    }
    if (path === '/api/login' && req.method === 'POST') {
      res.setHeader('Set-Cookie', await access.login(req, await body(req)));
      json(res, 200, { authenticated: true }); return;
    }
    if (path === '/api/password/setup' && req.method === 'POST') {
      res.setHeader('Set-Cookie', await access.setup(req, await body(req))); json(res, 200, { authenticated: true }); return;
    }
    access.require(req, !get);
    if (path === '/api/password/setup-link' && req.method === 'POST') { json(res, 200, access.setupLink(req, await body(req))); return; }
    if (path === '/api/password/change' && req.method === 'POST') { res.setHeader('Set-Cookie', await access.change(req, await body(req))); json(res, 200, { authenticated: true }); return; }
    if (path.startsWith('/browser/')) {
      if (!get || app.config.noVncPort === null || !app.store.read().browserPaused) throw new AppError('browser_manual_control_required', 403);
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'");
      const upstream = request({ hostname: '127.0.0.1', port: app.config.noVncPort, path: `${path.slice('/browser'.length)}${url.search}`, method: req.method }, response => {
        const type = response.headers['content-type']; if (type) res.setHeader('Content-Type', type);
        res.writeHead(response.statusCode ?? 502); response.pipe(res);
      });
      upstream.setTimeout(15_000, () => upstream.destroy()); upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: { code: 'browser_display_unavailable' } }); else res.destroy(); });
      res.on('close', () => upstream.destroy()); upstream.end(); return;
    }
    if (get && path === '/api/state') { json(res, 200, app.snapshot()); return; }
    const devicePath = /^\/api\/connections\/([\w-]+)\/device-signin(?:\/(cancel))?$/.exec(path);
    if (get && devicePath && !devicePath[2]) { json(res, 200, app.codexOAuth.status(devicePath[1]!, url.searchParams.get('attemptId') ?? undefined)); return; }
    if (get && path === '/api/rooms') { json(res, 200, { ...app.resident.snapshot(), cursor: app.store.cursor() }); return; }
    const wikiPath = /^\/api\/rooms\/([\w-]+)\/wiki(?:\/([\w-]+)(?:\/(history))?)?$/.exec(path);
    if (get && wikiPath) {
      const room = wikiPath[1]!; const page = wikiPath[2];
      const after = pageNumber(url, 'after', 0, 0, Number.MAX_SAFE_INTEGER); const limit = pageNumber(url, 'limit', 50, 1, 50);
      json(res, 200, !page ? app.wiki.list(room, after, limit) : wikiPath[3] ? app.wiki.history(room, page, after, limit) : app.wiki.get(room, page, url.searchParams.has('version') ? pageNumber(url, 'version', 1, 1, Number.MAX_SAFE_INTEGER) : undefined, url.searchParams.get('conflictId') ?? undefined)); return;
    }
    const residentGrants = /^\/api\/rooms\/([\w-]+)\/grants(?:\/(revoke))?$/.exec(path);
    if (get && residentGrants && !residentGrants[2]) { json(res, 200, { grants: app.residentMcp.list(residentGrants[1]!) }); return; }
    const workPath = /^\/api\/rooms\/([\w-]+)\/work(?:\/([\w-]+)(?:\/(claim|review|cancel|update))?)?$/.exec(path);
    if (get && workPath && !workPath[3]) {
      json(res, 200, workPath[2] ? app.workQueue.detail(workPath[1]!, workPath[2]) : app.workQueue.list(workPath[1]!, pageNumber(url, 'after', 0, 0, Number.MAX_SAFE_INTEGER), pageNumber(url, 'limit', 50, 1, 100))); return;
    }
    const roomPath = /^\/api\/rooms\/([\w-]+)(?:\/(messages|control|turns|handoff|focus|checkpoints)(?:\/([\w-]+))?)?$/.exec(path);
    if (get && roomPath) {
      if (!roomPath[2]) { json(res, 200, app.resident.room(roomPath[1]!)); return; }
      if (roomPath[2] === 'messages') {
        if (roomPath[3]) json(res, 200, app.resident.message(roomPath[1]!, roomPath[3]));
        else json(res, 200, app.resident.messages(roomPath[1]!, pageNumber(url, 'after', 0, 0, Number.MAX_SAFE_INTEGER), pageNumber(url, 'limit', 50, 1, 100)));
        return;
      }
      if (roomPath[2] === 'turns') {
        json(res, 200, roomPath[3] ? app.residentRunner.turn(roomPath[1]!, roomPath[3]) : app.residentRunner.turns(roomPath[1]!, pageNumber(url, 'after', 0, 0, Number.MAX_SAFE_INTEGER), pageNumber(url, 'limit', 50, 1, 100))); return;
      }
      if (roomPath[2] === 'checkpoints' && roomPath[3]) { json(res, 200, app.residentRunner.checkpoint(roomPath[1]!, roomPath[3])); return; }
    }
    if (get && path === '/api/capabilities') { json(res, 200, await app.capabilities()); return; }
    if (get && path === '/api/events') {
      let cursor = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0');
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > app.store.cursor()) throw new AppError('invalid_cursor', 409);
      req.setTimeout(0); res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n'); streams.add(res);
      const flush = () => {
        if (res.writableEnded || res.destroyed) return;
        if (!access.authenticate(req)) { res.end(); return; }
        let events;
        do {
          events = app.store.events(cursor, 250);
          for (const event of events) {
            if (res.writableLength > 1_000_000) { res.destroy(); return; }
            res.write(`id: ${event.id}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`); cursor = event.id;
          }
        } while (events.length === 250);
      };
      const unsubscribe = app.store.subscribe(flush); flush();
      const timer = setInterval(() => { if (!access.authenticate(req)) res.end(); else res.write(': heartbeat\n\n'); }, 15_000); timer.unref();
      res.on('close', () => { clearInterval(timer); unsubscribe(); streams.delete(res); }); return;
    }
    const discussionPath = /^\/api\/discussions\/([\w-]+)(\/control)?$/.exec(path);
    if (get && discussionPath && !discussionPath[2]) { json(res, 200, app.discussion(discussionPath[1]!)); return; }
    if (get && path === '/api/browser/pages') { json(res, 200, { text: await app.browser.pages() }); return; }
    if (get && path === '/api/browser/discovery/pages') { json(res, 200, { pages: await app.browserDiscovery.pages(), presets: app.browserDiscovery.presets() }); return; }
    if (get && path === '/api/browser/snapshot') { json(res, 200, { text: await app.browser.snapshot(integer(Number(url.searchParams.get('pageId')), 0, 0, 1_000_000)) }); return; }
    if (req.method !== 'POST') throw new AppError('not_found', 404);
    const input = object(await body(req));
    if (path === '/api/api-daily') { json(res, 200, app.configureApiDaily(input, command(req))); return; }
    if (wikiPath && !wikiPath[3]) { const result = app.wiki.edit(wikiPath[1]!, { ...input, ...(wikiPath[2] ? { pageId: wikiPath[2] } : {}) }, command(req)); json(res, result.status === 'conflict' ? 409 : 200, { ...result, ...(result.status === 'conflict' ? { error: { code: 'wiki_version_conflict' } } : {}) }); return; }
    const wikiPins = /^\/api\/rooms\/([\w-]+)\/wiki-pins$/.exec(path);
    if (wikiPins) { json(res, 200, app.wiki.pin(wikiPins[1]!, input, command(req))); return; }
    if (residentGrants) { if (residentGrants[2]) { app.residentMcp.revoke(residentGrants[1]!, string(input.id, 200)); json(res, 200, { ok: true }); }
      else { if (input.roomId !== undefined && input.roomId !== residentGrants[1]) throw new AppError('resident_scope_changed', 403); json(res, 201, app.residentMcp.createGrant({ ...input, roomId: residentGrants[1] })); } return; }
    if (workPath) {
      const room = workPath[1]!; const task = workPath[2]; const action = workPath[3];
      if (!task) { json(res, 201, app.workQueue.propose(room, input, command(req))); return; }
      if (action === 'claim') { json(res, 200, app.workQueue.claim(room, task, input, command(req))); return; }
      if (action === 'review') { json(res, 200, app.workQueue.review(room, task, input, command(req))); return; }
      if (action === 'cancel') { json(res, 200, app.workQueue.cancel(room, task, input, command(req))); return; }
      if (action === 'update') { json(res, 200, app.workQueue.update(room, task, input, command(req))); return; }
    }
    const seatPath = /^\/api\/rooms\/([\w-]+)\/seats$/.exec(path);
    if (seatPath) { json(res, 200, app.workQueue.seat(seatPath[1]!, input, command(req))); return; }
    if (path === '/api/browser/discovery') { json(res, 200, await app.discoverBrowser(input)); return; }
    if (path === '/api/browser/discovery/confirm') { json(res, 201, { id: await app.confirmBrowser(input, command(req)) }); return; }
    const residentReconcile = /^\/api\/rooms\/([\w-]+)\/turns\/([\w-]+)\/reconcile$/.exec(path);
    if (residentReconcile) { json(res, 200, app.residentRunner.reconcile(residentReconcile[1]!, residentReconcile[2]!, input, command(req))); return; }
    if (roomPath && !roomPath[3]) {
      if (roomPath[2] === 'control') { json(res, 200, app.resident.control(roomPath[1]!, input, command(req))); return; }
      if (roomPath[2] === 'messages') { json(res, 201, app.resident.postMessage(roomPath[1]!, input, command(req))); return; }
      if (roomPath[2] === 'focus') { json(res, 201, { discussionId: app.residentRunner.focus(roomPath[1]!, input, command(req)) }); return; }
      if (roomPath[2] === 'handoff') { json(res, 200, app.residentRunner.handoff(roomPath[1]!, input, command(req))); return; }
    }
    if (path === '/api/materials') { json(res, 201, { id: app.prepareMaterials(input, command(req)) }); return; }
    if (path === '/api/materials/list') { json(res, 200, app.materials.list(input.path)); return; }
    if (path === '/api/logout') { res.setHeader('Set-Cookie', access.logout(req)); json(res, 200, { ok: true }); return; }
    if (path === '/api/discussions') { json(res, 201, { id: app.engine.create(input, command(req)) }); return; }
    if (discussionPath?.[2]) { app.engine.control(discussionPath[1]!, input, command(req)); json(res, 200, { ok: true }); return; }
    if (path === '/api/connections/oauth') {
      if (typeof input.expectedEmail !== 'string' || !input.expectedEmail.trim()) throw new AppError('account_email_required');
      const result = await app.oauth.begin(string(input.label, 80), input.connectionId ? string(input.connectionId) : undefined, string(input.expectedEmail, 254));
      json(res, 200, result); return;
    }
    if (path === '/api/connections/codex-oauth') {
      if (input.connectionId) app.assertConnectionIdle(string(input.connectionId, 100));
      json(res, 200, await app.codexOAuth.begin(input, command(req))); return;
    }
    if (devicePath?.[2] === 'cancel') {
      if (Object.keys(input).some(k => k !== 'attemptId')) throw new AppError('invalid_input');
      app.codexOAuth.cancel(devicePath[1]!, string(input.attemptId, 100)); json(res, 200, { cancelled: true }); return;
    }
    if (path === '/api/browser/open-auth') {
      const connectionId = string(input.connectionId, 100);
      if (!app.store.read().connections.some(c => c.id === connectionId && c.kind === 'openai-oauth')) throw new AppError('connection_not_found', 404);
      await app.browser.openAuthorization(string(input.url, 12_000), connectionId); json(res, 200, { ok: true }); return;
    }
    if (path === '/api/connections/deepseek') { json(res, 201, { id: await app.addDeepSeek(input) }); return; }
    if (path === '/api/connections/anthropic') { json(res, 201, { id: await app.addAnthropic(input) }); return; }
    if (path === '/api/connections/browser') { json(res, 201, { id: await app.addBrowser(input) }); return; }
    const connectionPath = /^\/api\/connections\/([\w-]+)\/(models|logout|credential|remove)$/.exec(path);
    if (connectionPath) {
      if (connectionPath[2] === 'remove') { if (Object.keys(input).length) throw new AppError('invalid_input'); json(res, 200, app.removeConnection(connectionPath[1]!, command(req))); return; }
      if (connectionPath[2] === 'models') await app.refreshModels(connectionPath[1]!);
      else if (connectionPath[2] === 'credential') await app.replaceKey(connectionPath[1]!, string(input.key, 4096));
      else { app.assertConnectionIdle(connectionPath[1]!); const c = app.store.read().connections.find(c => c.id === connectionPath[1]);
        if (c?.kind === 'codex-oauth') { await app.codexOAuth.signOut(c.id); json(res, 200, { revoked: false }); }
        else json(res, 200, await app.oauth.signOut(connectionPath[1]!)); return; }
      json(res, 200, { ok: true }); return;
    }
    if (path === '/api/participants') { json(res, 201, { id: app.participant(input) }); return; }
    const participantPath = /^\/api\/participants\/([\w-]+)$/.exec(path);
    if (participantPath) { json(res, 200, { id: app.participant(input, participantPath[1]) }); return; }
    if (path === '/api/browser/control') { if (typeof input.paused !== 'boolean') throw new AppError('invalid_input'); app.browserControl(input.paused); json(res, 200, { ok: true }); return; }
    if (path === '/api/bindings') { json(res, 201, { id: await app.codex.register(input) }); return; }
    if (path === '/api/jobs') { json(res, 201, { id: app.codex.submit({ bindingId: string(input.bindingId), prompt: string(input.prompt, 30_000), requestId: command(req) }) }); return; }
    const jobPath = /^\/api\/jobs\/([\w-]+)\/(cancel|reconcile|steer|approve)$/.exec(path);
    if (jobPath) {
      const jid = jobPath[1]!;
      if (jobPath[2] === 'cancel') await app.codex.cancel(jid);
      else if (jobPath[2] === 'reconcile') await app.codex.reconcile(jid, input.turnId ? string(input.turnId, 200) : undefined);
      else if (jobPath[2] === 'steer') await app.codex.steer(jid, string(input.expectedTurnId), string(input.text, 10_000));
      else app.codex.decide(jid, string(input.approvalId), string(input.decision));
      json(res, 200, { ok: true }); return;
    }
    if (path === '/api/grants') { json(res, 201, mcp.createGrant(input)); return; }
    if (path === '/api/grants/revoke') {
      app.store.transact((state, emit) => { const grant = state.grants.find(g => g.id === input.id); if (!grant) throw new AppError('grant_not_found', 404);
        grant.revoked = true; emit({ type: 'mcp.revoked', discussionId: grant.discussionId, data: { grantId: grant.id } }); });
      json(res, 200, { ok: true }); return;
    }
    throw new AppError('not_found', 404);
  }
  return { server, closeStreams() { for (const stream of streams) stream.end(); for (const socket of sockets) socket.destroy(); } };
}
function command(req: IncomingMessage): string { const value = req.headers['idempotency-key']; return string(value, 200); }
function pageNumber(url: URL, key: string, fallback: number, min: number, max: number): number {
  const values = url.searchParams.getAll(key);
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(values[0]!)) throw new AppError('invalid_page');
  return integer(Number(values[0]), fallback, min, max);
}
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new AppError('json_required', 415);
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const raw of req) { const chunk = Buffer.from(raw as Uint8Array); bytes += chunk.length; if (bytes > 256_000) throw new AppError('body_too_large', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new AppError('invalid_json'); }
}
