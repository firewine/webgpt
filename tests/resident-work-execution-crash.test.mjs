import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { DispatchCoordinator } from '../dist/server/workspace/dispatch.js';
import { WorkQueue } from '../dist/server/workspace/work-queue.js';
import { WorkExecutionBridge } from '../dist/server/workspace/work-execution.js';
import { CodexExecutor } from '../dist/server/execution/codex.js';
import { ResidentRunner } from '../dist/server/workspace/resident-runner.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { FakeResidentCompletion } from '../dist/server/workspace/resident-fake.js';
import { rpcScript } from './work-execution-fixture.mjs';
import { until } from './workspace-helpers.mjs';

for (const stage of ['before_intent', 'intent', 'submit', 'link', 'approval', 'completed']) test('R6-A actual SIGKILL at ' + stage + ': one original start, one report and independent review', { timeout: 20000 }, async t => {
  const child = spawn(process.execPath, ['tests/fixtures/work-execution-crash.mjs', stage], { stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = '';
  child.stderr.on('data', b => { stderr += b; }); t.after(() => { if (child.exitCode === null && !child.killed) child.kill('SIGKILL'); });
  const info = await new Promise((resolve, reject) => { let output = ''; child.stdout.on('data', b => { output += b; if (output.includes('\n')) { try { resolve(JSON.parse(output.split('\n')[0])); } catch (e) { reject(e); } } }); child.on('exit', () => reject(new Error(stderr || 'Child exited before checkpoint'))); });
  const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped;
  const store = new Store(info.directory); const resident = new ResidentStore(store, true); resident.dispatchAvailable = true; const dispatch = new DispatchCoordinator(); const queue = new WorkQueue(store, true, dispatch);
  const codex = new CodexExecutor(store, [process.execPath, rpcScript, stage === 'approval' ? 'approval' : 'normal', 'persist'], [info.cwd]);
  const bridge = new WorkExecutionBridge(store, queue, codex, true, 300000); codex.workScopeGuard = (s, job, phase) => bridge.guard(s, job, phase);
  const provider = new FakeResidentCompletion({ complete: async () => assert.fail('No real model') }, 1);
  const engine = new DiscussionEngine(store, provider, { sourceFetch: false, turnTimeoutMs: 5000 }, undefined, dispatch);
  dispatch.workGuard = (s, turn) => queue.canDispatch(s, turn);
  const runner = new ResidentRunner(store, resident, dispatch, provider, engine, 5000, { work: queue, execution: bridge, autoSchedule: false });
  t.after(async () => { codex.close(); await runner.close(); await engine.close(); store.close(); await rm(info.directory, { recursive: true, force: true }); await rm(info.cwd, { recursive: true, force: true }); });
  const original = store.read(); const attempt = original.resident.workAttempts[0]; const originalJob = original.jobs[0];
  bridge.recover(); runner.recover(); codex.recover();
  if (stage === 'approval') {
    bridge.tick(); assert.equal(store.read().jobs[0].status, 'reconciling');
    await assert.rejects(codex.reconcile(originalJob.id), /execution_still_unconfirmed/);
    for (let i = 0; i < 100; i++) bridge.tick();
    const remotePath = join(info.cwd, 'remote-result.json'); const remote = JSON.parse(await readFile(remotePath, 'utf8'));
    // Explicit external fixture observation, not another turn/start or a
    // fabricated real command. The original turn/input/time remain pinned.
    remote.status = 'completed'; remote.items.push({ id: 'command-after-recovery', type: 'commandExecution', command: 'fixture-only observed command', exitCode: 0, status: 'completed', aggregatedOutput: 'fixture observation' }, { id: 'result', type: 'agentMessage', text: '복구 fixture의 같은 실행 결과' });
    await writeFile(remotePath, JSON.stringify(remote)); await codex.reconcile(originalJob.id);
  } else await until(() => { bridge.tick(); return store.read().jobs[0]?.status === 'completed'; });
  bridge.tick(); assert.equal(store.read().resident.workItems[0].status, 'review');
  await runner.tick(); const s = store.read(); const task = s.resident.workItems[0]; const link = s.resident.jobLinks[0];
  assert.equal(task.status, 'done'); assert.equal(task.reports.length, 1); assert.equal(task.reviews.length, 1); assert.equal(link.attemptId, attempt.id); assert.equal(link.input.requestId, attempt.requestId);
  assert.equal(s.jobs.length, 1); if (originalJob) assert.equal(s.jobs[0].id, originalJob.id);
  assert.equal(s.resident.messages.filter(m => m.sourceId === task.reports[0].id).length, 1);
  const trace = (await readFile(join(info.cwd, 'rpc-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); assert.equal(trace.filter(v => v.method === 'turn/start').length, 1);
  for (let i = 0; i < 20; i++) bridge.tick(); assert.equal(store.read().jobs.length, 1); assert.equal(store.read().resident.workItems[0].reports.length, 1);
});
