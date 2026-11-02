import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { unusedPort } from './helpers.mjs';

test('acceptance entry point serves the existing authenticated workspace and shuts down with the room off', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-live-entry-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const port = await unusedPort(), owner = 'fixture-only-acceptance-owner-key-123456789';
  let child;
  try {
    const store = new Store(directory); new ResidentStore(store, true);
    const participant = { id: 'fixture-gpt', kind: 'openai-oauth', connectionId: 'fixture-connection', modelId: 'fixture-model', label: 'Fixture', role: '', reasoningEffort: 'xhigh' };
    store.transact(s => { s.participants.push(participant); s.connections.push({ id: participant.connectionId, kind: participant.kind, label: 'Fixture', status: 'connected', models: [{ id: participant.modelId, label: 'Fixture' }] }); });
    const before = store.read(); store.close();
    const policyFile = join(directory, 'policy.json');
    await writeFile(policyFile, JSON.stringify({ roomId: before.resident.rooms[0].id, baselineLeases: [], maxRequests: 40, maxApiRequests: 8, maxMs: 1800000, drainMs: 300000, participants: [participant] }), { mode: 0o600 });
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, 'scripts/live-acceptance-server.mjs'), root, policyFile], { cwd: root, env: { ...process.env,
      WJ_HOST: '127.0.0.1', WJ_PORT: String(port), WJ_PUBLIC_ORIGIN: origin, WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'),
      WJ_ACCESS_TOKEN: owner, WJ_RESIDENT_ENABLED: 'true', WJ_WORKSPACE_ROOTS: '[]', WJ_CHROME_COMMAND: '[]', WJ_SOURCE_FETCH: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit'); let output = '';
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('acceptance_fixture_exited');
      try { healthy = (await fetch(origin + '/health', { signal: AbortSignal.timeout(200) }).then(r => r.json())).service === 'webjjoku'; } catch { /* wait for bind */ }
      if (healthy) break; await delay(25);
    }
    assert.equal(healthy, true); assert.ok(output.includes('acceptance.server_started'));
    const state = await fetch(origin + '/api/state', { headers: { Authorization: `Bearer ${owner}` } }).then(r => r.json());
    assert.equal(state.resident.rooms[0].desiredOn, false); assert.equal(state.dotMcp.enabled, true);
    assert.equal(state.participants.length, before.participants.length);
    child.kill('SIGTERM'); const [code] = await exited; assert.equal(code, 0);
    const after = new Store(directory); const saved = after.read(); after.close();
    assert.equal(saved.resident.rooms[0].desiredOn, false); assert.equal(saved.resident.dispatchLeases.length, 0);
    assert.equal(output.includes(owner), false);
  } finally { if (child?.exitCode === null) child.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }); }
});
