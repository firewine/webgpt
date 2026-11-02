import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectDotProtocol, readDotPreflight } from '../scripts/dot-preflight.mjs';
import { workspace, topic } from './workspace-helpers.mjs';
import { McpEndpoint } from '../dist/server/http/mcp.js';
const token = 'fixture-scoped-grant-not-an-owner-or-provider-key';
const health = () => Response.json({ status: 'ok', service: 'webjjoku', mode: 'workspace', persistence: 'sqlite' });
async function grantFile(t, value = token, mode = 0o600) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true })); const path = join(directory, 'grant');
  await writeFile(path, value, { mode }); await chmod(path, mode); return path;
}
const readyEnv = path => ({ WJ_PORT: '4090', WJ_MCP_GRANT_FILE: path, WJ_DOT_TUNNEL_ID: 'tunnel_fixture', CONTROL_PLANE_API_KEY: 'private-fixture-runtime-key' });

test('D0: live HTTP tools-only contract cannot be mistaken for native dot; no model dispatch', async t => {
  const f = await workspace(t); f.app.engine.kick = () => {};
  const did = f.app.engine.create(topic, 'dot-preflight-contract');
  const mcp = new McpEndpoint(f.app); const access = mcp.createGrant({ discussionId: did, participantId: 'fake-a', tools: ['context_get', 'result_submit'] });
  const path = await grantFile(t, access.token); const before = f.app.store.cursor();
  const report = await readDotPreflight({ env: { ...readyEnv(path), WJ_PORT: new URL(f.url).port }, tunnelInstalled: true });
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.mcp.status, 'OBSERVED');
  assert.equal(report.mcp.eventsAdvertised, false); assert.equal(report.mcp.eventCatalogAvailable, false); assert.equal(report.mcp.turnToolsAvailable, false);
  assert.deepEqual(report.blockers, ['mcp_events_not_available', 'dot_response_tools_not_available']);
  assert.equal(report.nativeRoundtrip, 'NOT_RUN'); assert.equal(f.app.store.cursor(), before); assert.equal(f.app.store.read().discussions[0].turns.length, 0);
});

test('D0: advertised Events without an actual catalog remain unavailable', async () => {
  const seen = []; const result = await inspectDotProtocol(async method => {
    seen.push(method); if (method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {}, events: {} } };
    if (method === 'tools/list') return { tools: [{ name: 'result_submit' }] };
    if (method === 'events/list') throw new Error('private server detail');
  });
  assert.equal(result.eventCatalogAvailable, false); assert.equal(result.turnToolsAvailable, false);
  assert.deepEqual(seen, ['initialize', 'notifications/initialized', 'tools/list', 'events/list']);
});

test('D0: endpoint identity is checked before reading/sending a scoped grant, including port 3000', async t => {
  const path = await grantFile(t); const calls = [];
  const report = await readDotPreflight({ env: { ...readyEnv(path), WJ_PORT: '3000' }, tunnelInstalled: true, request: async (url, options) => {
    calls.push(url); assert.equal(options.headers?.Authorization, undefined); assert.equal(options.redirect, 'error'); return Response.json({ status: 'ok', service: 'some-other-app' });
  } });
  assert.equal(report.mcp.reason, 'unexpected_local_service'); assert.equal(calls.length, 1); assert.equal(calls[0], 'http://127.0.0.1:3000/health');
});

test('D0: missing or invalid grants never create credentials or make MCP calls', async t => {
  const real = await grantFile(t); const alias = real + '.link'; await symlink(real, alias);
  for (const value of [undefined, 'relative-grant', alias, await grantFile(t, token, 0o644), await grantFile(t, 'not-a-grant')]) {
    const calls = []; const report = await readDotPreflight({ env: readyEnv(value), tunnelInstalled: true, request: async url => { calls.push(url); return health(); } });
    assert.equal(report.status, 'BLOCKED'); assert.equal(calls.length, 1); assert.equal(report.nativeRoundtrip, 'NOT_RUN');
    assert.ok(['scoped_grant_required', 'private_grant_required'].includes(report.mcp.reason));
  }
});

test('D0: ready metadata is only readiness; no subscription, tool execution, native acceptance or secret output', async t => {
  const path = await grantFile(t); const methods = [];
  const report = await readDotPreflight({ env: readyEnv(path), tunnelInstalled: true, request: async (url, options) => {
    if (url.endsWith('/health')) return health(); const message = JSON.parse(options.body); methods.push(message.method);
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {}, events: {} } }
      : message.method === 'tools/list' ? { tools: ['dot_turn_get', 'dot_turn_claim', 'dot_turn_submit'].map(name => ({ name })) }
        : { events: [{ name: 'webjjoku.turn_requested' }] };
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  } });
  assert.equal(report.status, 'READY_FOR_NATIVE_PROBE'); assert.equal(report.nativeRoundtrip, 'NOT_RUN'); assert.equal(report.pluginAuthentication, 'UNVERIFIED');
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'events/list']);
  const text = JSON.stringify(report); for (const value of [token, path, 'private-fixture-runtime-key', 'tunnel_fixture']) assert.equal(text.includes(value), false);
  assert.deepEqual(report.effects, { modelCalls: 0, subscriptionsCreated: 0, conversationMutations: 0 });
});

test('D0: malformed, oversized, mismatched and credential-reflecting responses disclose no private error', async t => {
  const path = await grantFile(t);
  for (const response of [() => Response.json({ jsonrpc: '2.0', id: 'wrong', result: {} }), () => Response.json({ private: token, padding: 'x'.repeat(128_001) }), () => { throw new Error(token); }]) {
    const report = await readDotPreflight({ env: readyEnv(path), tunnelInstalled: true, request: async url => url.endsWith('/health') ? health() : response() });
    assert.equal(report.status, 'BLOCKED'); assert.equal(JSON.stringify(report).includes(token), false);
  }
});
