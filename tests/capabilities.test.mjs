import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspace, topic } from './workspace-helpers.mjs';

test('owner capability inspection reports policy and observed versions without running a job or changing authority', async t => {
  const f = await workspace(t, { materialRoots: ['/tmp/owner-materials'], workspaceRoots: ['/tmp/owner-execution'], codexCommand: [process.execPath, 'unused-app-server'] });
  const versionScript = join(f.directory, 'tool-version.mjs');
  await writeFile(versionScript, 'if (process.argv[2] !== "--version" || process.argv.length !== 3) process.exit(1); console.log("fixture-tool v0.165.0");');
  f.app.config.codexCommand = [process.execPath, versionScript, 'app-server'];
  f.app.config.chromeCommand = [process.execPath, versionScript, '--browserUrl=http://127.0.0.1:1'];
  const before = f.app.store.read(); const cursor = f.app.store.cursor();
  const r = await f.api('/api/capabilities'); assert.equal(r.status, 200); const report = await r.json();
  assert.equal(report.scope, 'owner'); assert.equal(report.os.platform, process.platform); assert.equal(report.tools.node.version, process.versions.node);
  assert.equal(report.tools.codex.version, '0.165.0'); assert.equal(report.tools.codex.status, 'observed');
  assert.equal(report.tools.chromeMcp.version, '0.165.0');
  assert.deepEqual(report.materials.allowedPaths, ['/tmp/owner-materials']); assert.deepEqual(report.execution.allowedPaths, ['/tmp/owner-execution']);
  assert.equal(report.execution.commandNetwork, 'disabled_by_turn_sandbox_policy'); assert.equal(report.execution.approvalsReviewer, 'user');
  assert.match(report.execution.isolation, /success_not_established_by_version/);
  assert.deepEqual(f.app.store.read(), before); assert.equal(f.app.store.cursor(), cursor);
  f.app.config.codexCommand = ['/missing/nonsecret-binary'];
  const absent = await (await f.api('/api/capabilities')).json(); assert.equal(absent.tools.codex.status, 'unavailable'); assert.equal(absent.tools.codex.version, null);
  assert.ok(!JSON.stringify(absent).includes('nonsecret-binary'));
  f.app.config.codexCommand = [process.execPath, 'relative-launcher'];
  assert.equal((await (await f.api('/api/capabilities')).json()).tools.codex.status, 'unknown');
});

test('scoped MCP capabilities omit other accounts, roots, jobs, and bindings and do not require a pending task', async t => {
  const f = await workspace(t, { materialRoots: ['/private-global-materials'], workspaceRoots: ['/private-global-execution'], codexCommand: [process.execPath] });
  const did = f.app.engine.create(topic, 'caps-topic'); f.app.engine.control(did, { action: 'pause', expectedRevision: 1 }, 'caps-pause');
  f.app.store.transact(s => {
    const d = s.discussions[0]; d.executionBindingId = 'own-binding';
    for (const [id, cwd] of [['own-binding', '/granted/work'], ['other-binding', '/other/private-work']]) s.bindings.push({ id, label: id, cwd, allowWrite: false, status: 'ready', branch: 'feature', threadId: 'SECRET_THREAD' });
    const ownTask = d.tasks.find(t => t.participantId === 'fake-a'); const otherTask = d.tasks.find(t => t.participantId === 'fake-b');
    for (const [id, taskId, bindingId] of [['own-job', ownTask.id, 'own-binding'], ['another-participant-job', otherTask.id, 'own-binding'], ['another-discussion-job', 'different-task', 'other-binding']]) s.jobs.push({ id, discussionId: did, taskId, bindingId, status: 'completed', finishedAt: null, approvals: [{ status: 'resolved', params: { secret: 'SECRET_APPROVAL' } }], text: 'SECRET_OUTPUT' });
    s.connections.push({ id: 'unrelated', kind: 'deepseek', label: 'SECRET_ACCOUNT', email: 'SECRET_EMAIL', status: 'connected', models: [] });
    d.tasks.forEach(t => { t.status = 'completed'; });
  });
  const grant = tools => f.api('/api/grants', { discussionId: did, participantId: 'fake-a', tools }).then(r => r.json());
  const readOnly = await grant(['capabilities_get']); const execution = await grant(['capabilities_get', 'codex_status']);
  const call = (token, method = 'tools/call', params = { name: 'capabilities_get', arguments: { discussionId: 'other', participantId: 'fake-b' } }) => f.api('/mcp', { jsonrpc: '2.0', id: 1, method, params }, { headers: { Authorization: 'Bearer ' + token } });
  const minimal = JSON.parse((await (await call(readOnly.token)).json()).result.content[0].text);
  assert.deepEqual(minimal.execution.bindings, []); assert.deepEqual(minimal.execution.jobs, []); assert.equal(minimal.execution.read, 'not_granted'); assert.equal(minimal.tools.codex, null);
  const result = await (await call(execution.token)).json(); assert.equal(result.result.isError, false); const value = JSON.parse(result.result.content[0].text);
  assert.deepEqual(value.execution.bindings.map(b => b.id), ['own-binding']); assert.deepEqual(value.execution.jobs.map(j => j.id), ['own-job']);
  assert.equal(value.execution.actions.codex_send, false); assert.equal(value.execution.actions.codex_status, true);
  assert.equal(value.materials.allowedPaths, undefined); assert.equal(value.execution.allowedPaths, undefined); assert.deepEqual(value.connections.map(c => c.participantId), ['fake-a']);
  assert.doesNotMatch(JSON.stringify(value), /SECRET_|private-global|other-binding|private-work|another-participant|another-discussion/);
  const list = await (await call(execution.token, 'tools/list', {})).json(); assert.ok(list.result.tools.some(t => t.name === 'capabilities_get'));
  const ungranted = await grant(['task_get']); assert.ok((await (await call(ungranted.token)).json()).error);
  await f.api('/api/grants/revoke', { id: execution.id }); assert.equal((await call(execution.token)).status, 401);
});
