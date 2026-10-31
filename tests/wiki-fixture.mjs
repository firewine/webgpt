import { workFixture } from './work-fixture.mjs';
import { actorScope } from '../dist/server/workspace/wiki-policy.js';
import { McpEndpoint } from '../dist/server/http/mcp.js';
export async function wikiFixture(t, options = {}) {
  const f = await workFixture(t, options); const w = f.app.wiki; const mcp = new McpEndpoint(f.app);
  const room = () => f.app.store.read().resident.rooms.find(r => r.id === f.roomId);
  const actor = (pid = 'fake-a', scopeRef = 'room:' + f.roomId) => actorScope(f.app.store.read(), f.roomId, pid, scopeRef);
  const edit = (overrides = {}) => ({ slug: 'shared-notes', title: '공유 검토 기록', body: '원문에 근거한 공유 기억. 합의와 검증은 다릅니다.', scopeRef: 'room:' + f.roomId, expectedVersion: 0, sourceRefs: [{ kind: 'message', id: f.sourceId }], ...overrides });
  const grant = (tools, pid = 'fake-a', scopeRef = 'room:' + f.roomId) => {
    const a = actor(pid, scopeRef); return f.app.residentMcp.createGrant({ roomId: f.roomId, participantId: pid, scopeRef, scopeVersion: a.scopeVersion, contextGeneration: a.contextGeneration, expectedEpoch: a.epoch, tools, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  };
  return { ...f, w, mcp, room, actor, edit, grant,
    pin: (pageId, version = 1) => w.pin(f.roomId, { expectedVersion: room().version, pins: [{ pageId, version }] }, crypto.randomUUID()),
    call: async (access, name, args = {}) => {
      const res = await f.api('/mcp', { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: args } }, { headers: { Authorization: 'Bearer ' + access.token } });
      const json = await res.json(); return { status: res.status, ...json, value: json.result?.content ? JSON.parse(json.result.content[0].text) : json.error };
    } };
}
