import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess } from './helpers.mjs';
import { topic, until } from './workspace-helpers.mjs';
test('real process termination recovers the send journal and never replays an uncertain provider turn', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-restart-')); const env = { WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'), WJ_FAKE_DELAY_MS: '3000' };
  const first = await startProcess(t, env); const headers = { Authorization: 'Bearer test-owner-key-never-used-outside-fixtures', 'Content-Type': 'application/json', 'Idempotency-Key': 'restart-topic' };
  const created = await (await fetch(`${first.url}/api/discussions`, { method: 'POST', headers, body: JSON.stringify(topic) })).json();
  await until(async () => { const d = (await (await fetch(`${first.url}/api/discussions/${created.id}`, { headers })).json()).discussion; return d.turns[0]?.status === 'running'; });
  first.child.kill('SIGKILL'); await first.exit;
  const second = await startProcess(t, env); const restored = (await (await fetch(`${second.url}/api/discussions/${created.id}`, { headers })).json()).discussion;
  assert.equal(restored.status, 'blocked'); assert.equal(restored.turns.length, 1); assert.equal(restored.turns[0].status, 'unconfirmed'); assert.equal(restored.used.requests, 1);
  await new Promise(r => setTimeout(r, 100)); const state = (await (await fetch(`${second.url}/api/discussions/${created.id}`, { headers })).json()).discussion; assert.equal(state.turns.length, 1);
  second.child.kill('SIGTERM'); await second.exit; await rm(directory, { recursive: true, force: true });
});
