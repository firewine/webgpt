import { access, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, delimiter, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// D0 prerequisite inspection only: no tools/call, subscribe, model, room or key writes.
// READY_FOR_NATIVE_PROBE is deliberately not native-dot acceptance or a login claim.
export async function inspectDotProtocol(rpc) {
  const initial = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'webjjoku-dot-preflight', version: '0.1.0' } });
  if (!initial?.capabilities || !/^\d{4}-\d{2}-\d{2}$/.test(initial.protocolVersion)) throw new Error('invalid_metadata');
  await rpc('notifications/initialized');
  const tools = await rpc('tools/list', {});
  if (!Array.isArray(tools?.tools)) throw new Error('invalid_metadata');
  let events;
  try { events = await rpc('events/list', {}); } catch { /* Existing tools-only endpoints have no Events method. */ }
  return { status: 'OBSERVED', protocolVersion: initial.protocolVersion,
    eventsAdvertised: !!initial.capabilities.events && typeof initial.capabilities.events === 'object',
    eventCatalogAvailable: Array.isArray(events?.events) && events.events.some(e => e?.name === 'webjjoku.turn_requested'),
    turnToolsAvailable: ['dot_turn_get', 'dot_turn_claim', 'dot_turn_submit'].every(name => tools.tools.some(t => t?.name === name)) };
}

async function boundedJson(response) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('missing_body');
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 128_000) throw new Error('metadata_too_large'); chunks.push(value); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
      const messages = text.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')).filter(Boolean).map(x => JSON.parse(x));
      const result = messages.filter(x => x.jsonrpc === '2.0' && x.id !== undefined); if (result.length !== 1) throw new Error('invalid_metadata'); return result[0];
    }
    return JSON.parse(text);
  } finally { await reader.cancel().catch(() => {}); }
}
export async function readGrant(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('private_grant_required');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await file.stat();
    if (!s.isFile() || (s.mode & 0o077) !== 0 || process.getuid && s.uid !== process.getuid() || s.size > 512) throw new Error('private_grant_required');
    const token = (await file.readFile('utf8')).trim();
    if (!/^[A-Za-z0-9_-]{32,512}$/.test(token)) throw new Error('private_grant_required'); return token;
  } finally { await file.close(); }
}
async function executablePresent(env) {
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try { await access(join(directory, 'tunnel-client'), constants.X_OK); return true; } catch { /* Metadata only: do not run an arbitrary binary. */ }
  }
  return false;
}

export async function readDotPreflight({ env = process.env, request = fetch, tunnelInstalled } = {}) {
  const blockers = []; const port = Number(env.WJ_PORT ?? '3000');
  let mcp = { status: 'NOT_RUN', reason: 'scoped_grant_required' };
  const tunnel = { installed: tunnelInstalled ?? await executablePresent(env),
    idAvailableToProcess: /^tunnel_[A-Za-z0-9_-]+$/.test(env.WJ_DOT_TUNNEL_ID ?? ''),
    runtimeKeyAvailableToProcess: !!env.CONTROL_PLANE_API_KEY };
  if (!tunnel.installed) blockers.push('tunnel_client_not_installed');
  if (!tunnel.idAvailableToProcess) blockers.push('tunnel_id_required');
  if (!tunnel.runtimeKeyAvailableToProcess) blockers.push('tunnel_runtime_key_not_available_to_process');
  if (!Number.isInteger(port) || port < 1 || port > 65535) mcp = { status: 'NOT_RUN', reason: 'invalid_local_port' };
  else try {
    const origin = `http://127.0.0.1:${port}`;
    const health = await request(origin + '/health', { redirect: 'error', signal: AbortSignal.timeout(3000) });
    const identity = health.ok ? await boundedJson(health) : null;
    if (!health.ok) await health.body?.cancel();
    if (identity?.status !== 'ok' || identity.service !== 'webjjoku' || identity.mode !== 'workspace' || identity.persistence !== 'sqlite') throw new Error('unexpected_local_service');
    if (env.WJ_MCP_GRANT_FILE) {
      let token;
      try { token = await readGrant(env.WJ_MCP_GRANT_FILE); } catch { throw new Error('private_grant_required'); }
      let sequence = 0;
      mcp = await inspectDotProtocol(async (method, params) => {
        const notification = method === 'notifications/initialized'; const id = ++sequence;
        const res = await request(origin + '/mcp', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
          body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params ? { params } : {}) }) });
        if (!res.ok) { await res.body?.cancel(); throw new Error('mcp_auth_or_transport_unconfirmed'); }
        if (notification) { await res.body?.cancel(); return; }
        const body = await boundedJson(res);
        if (body.jsonrpc !== '2.0' || body.id !== id || body.error || !body.result) throw new Error('mcp_metadata_unconfirmed'); return body.result;
      });
    }
  } catch (error) {
    const known = ['unexpected_local_service', 'private_grant_required'];
    mcp = { status: 'NOT_RUN', reason: known.includes(error?.message) ? error.message : 'local_mcp_unconfirmed' };
  }
  if (mcp.status !== 'OBSERVED') blockers.push(mcp.reason);
  else {
    if (!mcp.eventsAdvertised || !mcp.eventCatalogAvailable) blockers.push('mcp_events_not_available');
    if (!mcp.turnToolsAvailable) blockers.push('dot_response_tools_not_available');
  }
  return { scope: 'D0_READ_ONLY_PREREQUISITES', status: blockers.length ? 'BLOCKED' : 'READY_FOR_NATIVE_PROBE',
    nativeRoundtrip: 'NOT_RUN', accountPermissions: 'UNVERIFIED', pluginAuthentication: 'UNVERIFIED',
    tunnel, mcp, blockers, effects: { modelCalls: 0, subscriptionsCreated: 0, conversationMutations: 0 } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await readDotPreflight(); console.log(JSON.stringify(report, null, 2));
  if (report.status === 'BLOCKED') process.exitCode = 2;
}
