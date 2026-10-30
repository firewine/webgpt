import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { DispatchCoordinator } from '../dist/server/workspace/dispatch.js';
import { WorkQueue } from '../dist/server/workspace/work-queue.js';
import { ResidentRunner } from '../dist/server/workspace/resident-runner.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { FakeResidentCompletion } from '../dist/server/workspace/resident-fake.js';

for (const stage of ['claimed', 'prepared', 'running', 'reported']) test('R5-D real SIGKILL: ' + stage + ' retains claim/report and never replays an uncertain work call', { timeout: 15000 }, async t => {
  const child = spawn(process.execPath, ['tests/fixtures/work-crash.mjs', stage], { stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = '';
  child.stderr.on('data', b => { stderr += b; }); t.after(() => { if (child.exitCode === null && !child.killed) child.kill('SIGKILL'); });
  const info = await new Promise((resolve, reject) => { let output = ''; child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) { try { resolve(JSON.parse(output.split('\n')[0])); } catch (e) { reject(e); } } }); child.on('exit', () => reject(new Error(stderr || 'Child exited before checkpoint'))); });
  const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped;
  const store = new Store(info.directory); const resident = new ResidentStore(store, true); const dispatch = new DispatchCoordinator(); const q = new WorkQueue(store, true, dispatch); dispatch.workGuard = (s, turn) => q.canDispatch(s, turn);
  const fake = new FakeResidentCompletion({ complete: async () => { throw new Error('No real provider'); } }, 1); let calls = 0; const provider = { complete: input => { calls++; return fake.complete(input); } };
  const engine = new DiscussionEngine(store, provider, { sourceFetch: false, turnTimeoutMs: 5000 }, undefined, dispatch);
  let clock = Date.now() + 1000; const runner = new ResidentRunner(store, resident, dispatch, provider, engine, 5000, { work: q, autoSchedule: false, clock: () => clock });
  t.after(async () => { await runner.close(); await engine.close(); store.close(); await rm(info.directory, { recursive: true, force: true }); });
  const before = store.read(); const attemptId = before.resident.workAttempts[0].id; const reportId = before.resident.workItems[0].currentReportId; runner.recover();
  if (stage === 'prepared' || stage === 'running') {
    for (let i = 0; i < 100; i++) { clock += 1000; await runner.tick(); }
    assert.equal(calls, 0); assert.equal(store.read().resident.workAttempts.length, 1); assert.equal(store.read().resident.workAttempts[0].status, 'unconfirmed');
  } else {
    await runner.tick(); const s = store.read(); assert.equal(calls, 1); assert.equal(s.resident.workAttempts.filter(a => a.purpose === 'work').length, 1);
    if (stage === 'reported') { assert.equal(s.resident.workItems[0].currentReportId, reportId); assert.equal(s.resident.messages.filter(m => m.sourceId === reportId).length, 1); }
  }
  assert.equal(store.read().resident.workAttempts[0].id, attemptId);
  assert.equal(store.read().resident.workAttempts[0].requestId, before.resident.workAttempts[0].requestId);
});
