import test from 'node:test';
import assert from 'node:assert/strict';
import { wikiFixture } from './wiki-fixture.mjs';
import { residentTools } from '../dist/server/workspace/resident-mcp.js';
import { topic } from './workspace-helpers.mjs';
const key = () => crypto.randomUUID();

test('R7-E: legacy discussion tools/keys retain exact scope, resident tools require a separate explicit grant, owner key is not a grant', async t => {
  const f = await wikiFixture(t); f.app.engine.kick = () => {}; const did = f.app.engine.create(topic, 'legacy-scope');
  f.app.store.transact(s => { s.discussions.find(d => d.id === did).status = 'paused'; });
  const access = f.mcp.createGrant({ discussionId: did, participantId: 'fake-a', tools: ['task_get', 'context_get', 'result_submit', 'capabilities_get'] }); const g = f.mcp.grant('Bearer ' + access.token);
  const list = await f.mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, g); assert.deepEqual(list.result.tools.map(t => t.name), ['task_get', 'context_get', 'result_submit', 'capabilities_get']);
  const result = await f.call(access, 'resident_wiki_list'); assert.equal(result.error.message, 'Tool not granted');
  const task = await f.call(access, 'task_get'); assert.equal(task.result.isError, false); assert.equal(task.value.discussionId, did);
  const resident = f.grant(['resident_wiki_list', 'resident_context_get']); const rg = f.mcp.grant('Bearer ' + resident.token);
  const tools = await f.mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, rg); assert.deepEqual(tools.result.tools.map(t => t.name), ['resident_wiki_list', 'resident_context_get']);
  const editGrant = f.grant(['resident_wiki_edit', 'resident_work_claim']);
  const schema = await f.mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, f.mcp.grant('Bearer ' + editGrant.token));
  assert.ok(schema.result.tools[0].inputSchema.required.includes('expectedVersion')); assert.ok(schema.result.tools[0].inputSchema.required.includes('sourceRefs')); assert.equal(schema.result.tools[0].inputSchema.anyOf.length, 2);
  assert.deepEqual(schema.result.tools[1].inputSchema.required, ['requestId', 'taskId', 'expectedVersion']); assert.match(schema.result.tools[0].description, /reported knowledge/);
  assert.equal((await f.call(resident, 'task_get')).error.message, 'Tool not granted'); assert.equal((await f.call(resident, 'codex_send', { prompt: 'not authorized' })).error.message, 'Tool not granted');
  assert.equal((await f.api('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' })).status, 401); assert.equal((await f.api('/api/state', undefined, { headers: { Authorization: 'Bearer ' + resident.token } })).status, 401);
  assert.equal(f.app.store.read().grants.length, 1); assert.equal(f.app.store.read().grants[0].tools.length, 4);
});

test('R7-C: a narrow room grant excludes project Wiki notices and citation metadata even when the actor has a broader seat', async t => {
  const f = await wikiFixture(t); f.app.store.transact(s => s.bindings.push({ id: 'broader-project' }));
  f.q.seat(f.roomId, { participantId: 'fake-a', expectedVersion: 1, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId, 'binding:broader-project'] }, key());
  const project = f.w.edit(f.roomId, f.edit({ slug: 'private-project', scopeRef: 'binding:broader-project', body: 'broad seat project sentinel' }), key());
  f.w.edit(f.roomId, f.edit(), key()); const access = f.grant(['resident_context_get']);
  const result = await f.call(access, 'resident_context_get'); assert.equal(result.result.isError, false);
  assert.equal(result.value.wiki.length, 1); assert.ok(!JSON.stringify(result.value).includes(project.pageId)); assert.ok(!JSON.stringify(result.value).includes(project.digest));
  assert.equal(result.value.messages.filter(m => m.sourceKind === 'wiki').length, 1);
  await f.step(); await f.step(); const turn = f.app.store.read().resident.turns.find(t => t.participantId === 'fake-b');
  assert.ok(!turn.prompt.includes(project.pageId)); assert.ok(!turn.prompt.includes(project.digest)); assert.ok(!turn.prompt.includes('broad seat project sentinel'));
});

test('R7: new grant explicitly freezes actor/scope/version/generation/identity/expiry and raw token is not in state, metadata, event or Wiki', async t => {
  const f = await wikiFixture(t); const access = f.grant(['resident_context_get', 'resident_wiki_edit']); const state = f.app.store.read();
  const g = state.resident.residentGrants[0]; assert.equal(g.contextGeneration, 1); assert.equal(g.scopeVersion, 1); assert.equal(g.epoch, f.room().epoch); assert.equal(g.kind, 'resident'); assert.ok(g.hash.length === 64);
  for (const raw of [JSON.stringify(state), JSON.stringify(f.app.snapshot()), JSON.stringify(f.app.store.events(0)), JSON.stringify(f.app.residentMcp.list(f.roomId))]) assert.ok(!raw.includes(access.token));
  assert.ok(!JSON.stringify(f.app.residentMcp.list(f.roomId)).includes(g.hash)); assert.equal(f.app.residentMcp.list(f.roomId)[0].active, true);
  const edit = await f.call(access, 'resident_wiki_edit', { ...f.edit(), requestId: 'wiki-one' }); assert.equal(edit.result.isError, false); assert.equal(f.w.get(f.roomId, edit.value.pageId).version.authoredBy, 'fake-a');
  f.app.residentMcp.revoke(f.roomId, access.id); assert.equal((await f.call(access, 'resident_context_get')).status, 401);
});

test('R7-C: resident context excludes private drafts, other actor histories, owner credentials and unrelated project Wiki', async t => {
  const f = await wikiFixture(t); f.app.store.transact(s => { s.resident.messages.push({ ...s.resident.messages[0], id: 'private', visibility: 'topic_round', text: 'private sentinel' }); s.resident.rooms[0].contexts = [{ participantId: 'fake-b', generation: 1, history: [{ role: 'assistant', content: 'other account history sentinel' }], checkpointId: null, lastSeenSequence: 0 }]; s.bindings.push({ id: 'foreign-project' }); });
  const page = f.w.edit(f.roomId, f.edit({ scopeRef: 'binding:foreign-project', body: 'other project wiki sentinel' }), key()); f.pin(page.pageId);
  const access = f.grant(['resident_context_get', 'resident_wiki_get', 'resident_wiki_edit', 'resident_work_claim']);
  const context = await f.call(access, 'resident_context_get'); assert.equal(context.result.isError, false); assert.doesNotMatch(JSON.stringify(context.value), /private sentinel|other account history sentinel|other project wiki sentinel|fixture-only-private-owner/);
  assert.equal((await f.call(access, 'resident_wiki_get', { pageId: page.pageId })).result.isError, true);
  assert.equal((await f.call(access, 'resident_wiki_edit', { ...f.edit({ pageId: page.pageId, scopeRef: 'binding:foreign-project', expectedVersion: 1 }), requestId: 'foreign-edit' })).result.isError, true);
  const task = f.propose({ title: '다른 프로젝트 일감', authorizedScopeRef: 'binding:foreign-project' }); assert.equal((await f.call(access, 'resident_work_claim', { requestId: 'foreign-claim', taskId: task, expectedVersion: f.task(task).version })).result.isError, true);
  const badSource = await f.call(access, 'resident_wiki_edit', { ...f.edit({ sourceRefs: [{ kind: 'message', id: 'private' }] }), requestId: 'private-source' }); assert.equal(badSource.result.isError, true); assert.equal(f.app.store.read().resident.wikiVersions.length, 1);
});

for (const kind of ['old', 'missing']) for (const tool of ['resident_message_post', 'resident_work_claim', 'resident_wiki_edit']) test(`R7-G: ${kind} context generation x ${tool} accepts zero actions and does not replay a prior command`, async t => {
  const f = await wikiFixture(t); const task = f.propose(); const access = f.grant([tool]); const captured = f.mcp.grant('Bearer ' + access.token);
  if (kind === 'old') f.app.store.transact(s => { const room = s.resident.rooms[0]; room.contexts = [...(room.contexts ?? []).filter(c => c.participantId !== 'fake-a'), { participantId: 'fake-a', generation: 2, checkpointId: null, lastSeenSequence: 0, history: [] }]; });
  else f.app.store.transact(s => { delete s.resident.residentGrants[0].contextGeneration; });
  const body = tool === 'resident_wiki_edit' ? { ...f.edit(), requestId: 'one' } : tool === 'resident_work_claim' ? { requestId: 'one', taskId: task, expectedVersion: f.task(task).version } : { requestId: 'one', text: '실행하면 안 되는 옛 발언' };
  const before = f.app.store.cursor(); const result = await f.call(access, tool, body); assert.ok([401, 403].includes(result.status));
  await assert.rejects(f.mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: body } }, captured), /authentication|scope_changed/);
  assert.equal(f.app.store.cursor(), before); assert.equal(f.app.store.read().resident.wikiVersions.length, 0); assert.equal(f.app.store.read().resident.workAttempts.length, 0);
});

for (const change of ['expired', 'revoked', 'seat', 'member', 'identity', 'epoch']) test('R7: ' + change + ' invalidates held/new resident grants before reads or mutations', async t => {
  const f = await wikiFixture(t); const access = f.grant(['resident_message_post', 'resident_wiki_list']);
  if (change === 'revoked') f.app.residentMcp.revoke(f.roomId, access.id);
  else f.app.store.transact(s => { const r = s.resident.rooms[0]; const g = s.resident.residentGrants[0]; if (change === 'expired') g.expiresAt = new Date(Date.now() - 1).toISOString(); if (change === 'seat') r.seats[0].version++; if (change === 'member') r.members[0].enabled = false; if (change === 'identity') s.participants[0].connectionId = 'different'; if (change === 'epoch') r.epoch++; });
  const cursor = f.app.store.cursor(); assert.ok([401, 403].includes((await f.call(access, 'resident_wiki_list')).status)); assert.ok([401, 403].includes((await f.call(access, 'resident_message_post', { requestId: 'late', text: 'must not post' })).status)); assert.equal(f.app.store.cursor(), cursor);
});

test('R7: room speech/proposal/claim share existing policy/journal and duplicate IDs cannot create more messages or leases', async t => {
  const f = await wikiFixture(t); const access = f.grant([...residentTools]);
  for (let i = 0; i < 20; i++) { const result = await f.call(access, 'resident_message_post', { requestId: 'speech', text: 'MCP로 전달한 참여자의 보고' }); assert.equal(result.result.isError, false); }
  assert.equal(f.app.store.read().resident.messages.filter(m => m.text === 'MCP로 전달한 참여자의 보고').length, 1); assert.equal(f.app.store.read().resident.messages.at(-1).authorId, 'fake-a');
  const input = { ...f.proposal(), requestId: 'proposal' }; let task;
  for (let i = 0; i < 20; i++) { const result = await f.call(access, 'resident_work_propose', input); assert.equal(result.result.isError, false); task = result.value.taskId; }
  const expectedVersion = f.task(task).version;
  for (let i = 0; i < 20; i++) assert.equal((await f.call(access, 'resident_work_claim', { requestId: 'claim', taskId: task, expectedVersion })).result.isError, false);
  assert.equal(f.app.store.read().resident.workAttempts.length, 1); assert.equal(f.app.store.read().resident.workItems.length, 1);
  await f.step(); await f.step(); assert.equal(f.task(task).status, 'done'); assert.equal(f.app.store.read().resident.wikiVersions.length, 1);
  const bad = await f.call(access, 'resident_message_post', { requestId: 'identity-spoof', text: 'other actor', participantId: 'fake-b' }); assert.equal(bad.result.isError, true);
});

test('R7: owner API Host/Origin/auth and flag-off boundaries protect new Wiki/grant routes; no grant scope auto-widening', async t => {
  const f = await wikiFixture(t);
  assert.equal((await f.api(`/api/rooms/${f.roomId}/wiki`, f.edit(), { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  assert.equal((await fetch(f.url + `/api/rooms/${f.roomId}/wiki`)).status, 401);
  const a = f.actor(); const grantBody = { participantId: 'fake-a', scopeRef: a.scopeRef, scopeVersion: 1, contextGeneration: 1, expectedEpoch: a.epoch, tools: ['resident_wiki_list'], expiresAt: new Date(Date.now() + 3600000).toISOString() };
  assert.equal((await f.api(`/api/rooms/${f.roomId}/grants`, { ...grantBody, tools: ['codex_send'] })).status, 400);
  assert.equal((await f.api(`/api/rooms/${f.roomId}/grants`, { ...grantBody, contextGeneration: undefined })).status, 409);
  assert.equal((await f.api(`/api/rooms/${f.roomId}/grants`, { ...grantBody, expiresAt: new Date(Date.now() + 8 * 86400000).toISOString() })).status, 400);
  const ok = await f.api(`/api/rooms/${f.roomId}/grants`, grantBody); assert.equal(ok.status, 201); const access = await ok.json();
  assert.equal((await f.api(`/api/rooms/${f.roomId}/wiki`, f.edit(), { headers: { Authorization: 'Bearer ' + access.token } })).status, 401);
  const tools = await f.api('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { Authorization: 'Bearer ' + access.token, Origin: 'https://untrusted.invalid' } }); assert.equal(tools.status, 403);
  f.app.config.residentEnabled = false; assert.equal((await f.call(access, 'resident_wiki_list')).status, 409); assert.equal(f.app.store.read().resident.residentGrants[0].tools.length, 1);
});
