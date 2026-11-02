import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
import { dotTools, dotEventName } from '../dist/server/workspace/dot-mcp-model.js';
import { McpEndpoint } from '../dist/server/http/mcp.js';
import { FakeResidentCompletion } from '../dist/server/workspace/resident-fake.js';
import { reply, pacing } from './resident-fixture.mjs';
import { response } from './workspace-helpers.mjs';

export const key = () => crypto.randomUUID();
export const config = directory => loadWorkspaceConfig({ WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'), WJ_ACCESS_TOKEN: 'fixture-dot-d3-owner-key-not-a-real-credential', WJ_RESIDENT_ENABLED: 'true' });
export async function dotFixture(t, options = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'wj-dot-d3-')); let clock = Date.now(); let app; let timer;
  const inputs = [], deliveries = [], answers = [];
  const transport = { async post(input) {
    input.beforeSend(); const body = JSON.parse(input.body);
    if (body.type === 'verification') return { status: 200, body: JSON.stringify({ challenge: body.challenge }) };
    deliveries.push(input); await f.onEvent(body.data.requestId, input); return { status: 200, body: '' };
  } };
  app = new Workspace({ ...config(directory), turnTimeoutMs: options.timeoutMs ?? 5000 }, 1, { residentAutoSchedule: false, residentClock: () => clock, webhookTransport: transport });
  const f = { directory, get app() { return app; }, transport, inputs, deliveries, answers, onEvent: async requestId => f.respond(requestId),
    state: () => app.store.read(), room: () => app.store.read().resident.rooms[0],
    advance: (ms = 100) => { clock = Math.max(clock, Date.now()) + ms; },
    step: async () => { f.advance(); await app.residentRunner.tick(); },
    reopen: async () => { clearInterval(timer); await app.close(); app = new Workspace(config(directory), 1, { residentAutoSchedule: false, webhookTransport: transport }); },
  };
  t.after(async () => { clearInterval(timer); await app.close(); if (!options.directory) await rm(directory, { recursive: true, force: true }); });
  const roomId = f.room().id; Object.assign(f, { roomId, control: body => app.resident.control(roomId, { expectedVersion: f.room().version, ...body }, key()) });
  const binding = app.dotMcp.register({ roomId, label: 'dot fixture' }, key()); Object.assign(f, binding);
  f.control({ action: 'configure', pacing: { ...pacing, idleNudgeMs: 1, sleepAfterPasses: 100 } });
  f.control({ action: 'set_member', participantId: binding.participantId, enabled: true });
  const access = app.dotMcp.confirm({ connectionId: binding.connectionId, expectedVersion: 1, ownerConfirmed: true, tools: [...dotTools], expiresAt: new Date(Date.now() + 86400000).toISOString() }, key());
  const grant = app.dotMcp.authenticate(access.token); Object.assign(f, { access, grant });
  const params = { name: dotEventName, arguments: { roomId, ...binding }, delivery: { mode: 'webhook', url: 'https://receiver.example/d3', secret: 'whsec_' + randomBytes(32).toString('base64') } };
  Object.assign(f, { params, subscribe: () => app.mcpEvents.handle('events/subscribe', params, grant),
    call: (name, args = {}) => app.dotAdapter.call(name, args, app.dotMcp.authenticate(access.token)),
    rpc: (method, params) => new McpEndpoint(app).handle({ jsonrpc: '2.0', id: 1, method, params }, new McpEndpoint(app).grant('Bearer ' + access.token)),
    claim: requestId => f.call('dot_turn_claim', { requestId, commandId: 'claim-' + requestId }),
    respond: async (requestId, text, repeats = 1) => {
      const attempt = f.claim(requestId); const frozen = f.call('dot_turn_get', { requestId, ...attempt }).request;
      const p = f.state().participants.find(p => p.id === f.participantId); inputs.push({ ...frozen, participant: p });
      if (text === undefined) {
        if (frozen.prompt.startsWith('웹쫀쿠 상주 업무')) {
          const fake = new FakeResidentCompletion({}, 0);
          text = (await fake.complete({ ...frozen, participant: { ...p, kind: 'fake' }, hooks: { dispatched() {}, receipt() {}, delta() {} }, signal: new AbortController().signal })).text;
        } else if (frozen.prompt.startsWith('웹쫀쿠 상주')) text = reply();
        else { const r = JSON.parse(response(frozen.prompt, p)); r.verifications = []; text = JSON.stringify(r); }
      }
      const body = { requestId, ...attempt, commandId: 'submit-' + requestId, text };
      const results = Array.from({ length: repeats }, (_, i) => f.call('dot_turn_submit', { ...body, commandId: i % 2 ? body.commandId : body.commandId + '-' + i }));
      answers.push({ body, results }); return results[0];
    },
  });
  if (options.subscribe !== false) await f.subscribe();
  f.control({ action: 'on' });
  timer = setInterval(() => { void app.mcpEvents.pump(); }, 5);
  return f;
}
