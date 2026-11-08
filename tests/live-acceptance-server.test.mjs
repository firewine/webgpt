import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { unusedPort } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const owner = 'fixture-only-acceptance-owner-key-123456789';
function entryProcess(directory, policyFile, port, roots = [], nodeArgs = []) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [...nodeArgs, join(root, 'scripts/live-acceptance-server.mjs'), root, policyFile], { cwd: root, env: { ...process.env,
    WJ_HOST: '127.0.0.1', WJ_PORT: String(port), WJ_PUBLIC_ORIGIN: origin, WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'),
    WJ_ACCESS_TOKEN: owner, WJ_RESIDENT_ENABLED: 'true', WJ_WORKSPACE_ROOTS: JSON.stringify(roots), WJ_MATERIAL_ROOTS: '[]',
    WJ_CHROME_COMMAND: '[]', WJ_SOURCE_FETCH: 'false', WJ_CODEX_COMMAND: JSON.stringify([process.execPath, '--eval', 'require("node:fs").writeFileSync(process.argv[1], "called"); throw new Error("unexpected_fixture_codex")', join(directory, 'codex-called')]) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close'); let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  return { child, exited, origin, output: () => output };
}

// Exercise the product Workspace, with a delayed close to expose premature hook removal.
const closeProbe = 'data:text/javascript,' + encodeURIComponent(`
  import assert from 'node:assert/strict';
  import { setTimeout as delay } from 'node:timers/promises';
  import { Workspace } from ${JSON.stringify(new URL('../dist/server/workspace/runtime.js', import.meta.url).href)};
  const close = Workspace.prototype.close;
  Workspace.prototype.close = async function () {
    const reserve = this.dispatch.reserve, beforeDispatch = this.codex.beforeDispatch;
    assert.throws(() => beforeDispatch({}, {}), /acceptance_codex_not_authorized/);
    assert.equal(reserve(this.store.read(), {}, Date.now()), 'acceptance_stopped');
    const check = () => { assert.equal(this.dispatch.reserve, reserve); assert.equal(this.codex.beforeDispatch, beforeDispatch); };
    await delay(25); check(); await close.call(this); check();
    console.log('fixture.guards_installed_until_workspace_closed');
  };
`);

for (const { name, listenFails, executionEnabled } of [
  { name: 'acceptance entry point serves the existing authenticated workspace and shuts down with the room off' },
  { name: 'acceptance entry point keeps guards installed until Workspace closes after a listen failure', listenFails: true },
  { name: 'valid execution entry starts and returns HTTP 409 for disallowed registrations without invoking Codex', executionEnabled: true },
]) test(name, { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-live-entry-'));
  const port = await unusedPort();
  let entry, blocker, executionRoot;
  try {
    const store = new Store(directory); new ResidentStore(store, true);
    const participant = { id: 'fixture-gpt', kind: 'openai-oauth', connectionId: 'fixture-connection', modelId: 'fixture-model', label: 'Fixture', role: '', reasoningEffort: 'xhigh' };
    store.transact(s => { s.participants.push(participant); s.connections.push({ id: participant.connectionId, kind: participant.kind, label: 'Fixture', status: 'connected', models: [{ id: participant.modelId, label: 'Fixture' }] }); });
    const before = store.read(); store.close();
    const policyFile = join(directory, 'policy.json');
    const policy = { roomId: before.resident.rooms[0].id, baselineLeases: [], maxRequests: 40, maxApiRequests: 8, maxMs: 1800000, drainMs: 300000, participants: [participant] };
    if (executionEnabled) {
      executionRoot = await mkdtemp(join(tmpdir(), 'wj-live-entry-root-'));
      policy.execution = {
        version: 1, runId: 'fixture-http-denial', root: executionRoot, branch: 'fixture-validation', head: 'a'.repeat(40), baselineJobs: [], baselineBindings: [],
        commands: { read: 'node fixture-read.mjs', write: 'node fixture-write.mjs' }, applyPath: 'fixture.txt',
        applyBeforeDigest: 'a'.repeat(64), applyAfterDigest: 'b'.repeat(64),
      };
    }
    await writeFile(policyFile, JSON.stringify(policy), { mode: 0o600 });
    if (listenFails) { blocker = createServer().listen(port, '127.0.0.1'); await once(blocker, 'listening'); }
    entry = entryProcess(directory, policyFile, port, executionEnabled ? [executionRoot] : [], executionEnabled ? [] : ['--import', closeProbe]);
    const { child, exited, origin } = entry;
    if (listenFails) {
      const [code] = await exited; assert.notEqual(code, 0, entry.output());
      assert.match(entry.output(), /EADDRINUSE/);
      assert.match(entry.output(), /fixture.guards_installed_until_workspace_closed/);
      assert.equal(entry.output().includes('acceptance.server_started'), false);
      return;
    }
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('acceptance_fixture_exited: ' + entry.output());
      try { healthy = (await fetch(origin + '/health', { signal: AbortSignal.timeout(200) }).then(r => r.json())).service === 'webjjoku'; } catch { /* wait for bind */ }
      if (healthy) break; await delay(25);
    }
    assert.equal(healthy, true); assert.ok(entry.output().includes('acceptance.server_started'));
    assert.equal((await fetch(origin + '/api/state')).status, 401);
    const state = await fetch(origin + '/api/state', { headers: { Authorization: `Bearer ${owner}` } }).then(r => r.json());
    assert.equal(state.resident.rooms[0].desiredOn, false); assert.equal(state.dotMcp.enabled, true);
    assert.equal(state.participants.length, before.participants.length);
    if (executionEnabled) {
      for (const input of [{ cwd: directory, allowWrite: false }, { cwd: executionRoot, allowWrite: true }]) {
        const registration = await fetch(origin + '/api/bindings', { method: 'POST',
          headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Fixture', sessionMode: 'new', expiresInHours: 1, ...input }) });
        assert.equal(registration.status, 409);
        assert.deepEqual(await registration.json(), { error: { code: 'acceptance_execution_registration_not_allowed' } });
      }
      const denied = await fetch(origin + '/api/jobs/fixture-job/steer', { method: 'POST',
        headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedTurnId: 'fixture-turn', text: 'fixture-only' }) });
      assert.equal(denied.status, 409);
      assert.deepEqual(await denied.json(), { error: { code: 'acceptance_execution_steer_not_allowed' } });
    }
    child.kill('SIGTERM'); const [code] = await exited; assert.equal(code, 0, entry.output());
    if (!executionEnabled) assert.match(entry.output(), /fixture.guards_installed_until_workspace_closed/);
    const after = new Store(directory); const saved = after.read(); after.close();
    assert.equal(saved.resident.rooms[0].desiredOn, false); assert.equal(saved.resident.dispatchLeases.length, 0);
    if (executionEnabled) {
      assert.equal(saved.jobs.length, 0); assert.equal(saved.bindings.length, 0);
      await assert.rejects(access(join(directory, 'codex-called')), { code: 'ENOENT' });
    }
    assert.equal(entry.output().includes(owner), false);
  } finally {
    if (entry?.child.exitCode === null) entry.child.kill('SIGKILL');
    if (entry) await entry.exited;
    if (blocker) await new Promise(resolve => blocker.close(resolve));
    await rm(directory, { recursive: true, force: true });
    if (executionRoot) await rm(executionRoot, { recursive: true, force: true });
  }
});

test('acceptance entry point rejects unauthorized roots before constructing Workspace', { timeout: 15000 }, async t => {
  const cases = [
    { name: 'nonempty roots without execution opt-in', expected: /acceptance_requires_no_codex_roots/ },
    { name: 'invalid execution opt-in', execution: { version: 1 }, expected: /invalid_acceptance_execution_policy/ },
    { name: 'execution root differs from configured root', execution: {
      version: 1, runId: 'fixture-run', root, branch: 'fixture-validation', head: 'a'.repeat(40), baselineJobs: [], baselineBindings: [],
      commands: { read: 'node fixture-read.mjs', write: 'node fixture-write.mjs' }, applyPath: 'fixture.txt',
      applyBeforeDigest: 'a'.repeat(64), applyAfterDigest: 'b'.repeat(64),
    }, expected: /acceptance_execution_root_mismatch/ },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wj-live-entry-denied-'));
    const stateDir = join(directory, 'state'), policyFile = join(directory, 'policy.json');
    let entry;
    try {
      await writeFile(policyFile, JSON.stringify({ execution: c.execution }), { mode: 0o600 });
      entry = entryProcess(stateDir, policyFile, await unusedPort(), [directory]);
      const [code] = await entry.exited; assert.notEqual(code, 0, entry.output());
      assert.match(entry.output(), c.expected); assert.equal(entry.output().includes('acceptance.server_started'), false);
      await assert.rejects(access(stateDir), { code: 'ENOENT' });
    } finally {
      if (entry?.child.exitCode === null) entry.child.kill('SIGKILL');
      if (entry) await entry.exited;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
