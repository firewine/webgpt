import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexExecutor } from '../dist/server/execution/codex.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { McpEndpoint } from '../dist/server/http/mcp.js';
import { storage, until, topic, response } from './workspace-helpers.mjs';
const script = fileURLToPath(new URL('fixtures/codex-rpc.mjs', import.meta.url));
async function fixture(t, mode = 'normal') {
  const { store } = await storage(t); const cwd = await mkdtemp(join(tmpdir(), 'wj-codex-'));
  execFileSync('git', ['init', '-q', '-b', 'work-fixture'], { cwd }); execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd });
  const codex = new CodexExecutor(store, [process.execPath, script, mode], [cwd]); t.after(async () => { codex.close(); await rm(cwd, { recursive: true, force: true }); });
  return { store, codex, cwd, register: () => codex.register({ cwd, label: 'fixture', threadId: 'fixture-thread', allowWrite: true }), trace: async () => (await readFile(join(cwd, 'rpc-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) };
}
test('Codex uses observed target and actual schema, queues exactly once and records command evidence', async t => {
  const f = await fixture(t); const bindingId = await f.register(); const input = { bindingId, prompt: '테스트 전용 프롬프트; 셸 확장 $(touch should-not-exist)', requestId: 'one' };
  const first = f.codex.submit(input); assert.equal(f.codex.submit(input), first); const second = f.codex.submit({ ...input, requestId: 'two' });
  await until(() => f.store.read().jobs.every(j => j.status === 'completed'));
  const trace = await f.trace(); const starts = trace.filter(m => m.method === 'turn/start'); assert.equal(starts.length, 2); assert.equal(starts[0].params.approvalPolicy, 'untrusted'); assert.equal(starts[0].params.approvalsReviewer, 'user');
  assert.equal(starts[0].params.sandboxPolicy.networkAccess, false); assert.equal(starts[0].params.sandboxPolicy.excludeSlashTmp, true); assert.equal(starts[0].params.cwd, f.cwd); assert.equal(starts[0].params.input[0].text, input.prompt);
  assert.ok(trace.every(m => m.environment.WJ_ACCESS_TOKEN === null)); assert.equal(f.store.read().jobs.find(j => j.id === second).turnId, 'turn-2'); assert.ok(f.store.read().jobs[0].activities.some(a => a.type === 'commandExecution'));
});
test('steer requires current turn; interrupt is not treated as completed before remote confirmation', async t => {
  const f = await fixture(t, 'hold'); const bindingId = await f.register(); const id = f.codex.submit({ bindingId, prompt: 'hold', requestId: 'hold' }); const job = await until(() => f.store.read().jobs.find(j => j.turnId));
  await assert.rejects(f.codex.steer(id, 'wrong-id', 'unsafe'), /turn_conflict/); await f.codex.steer(id, job.turnId, '추가 조건');
  await f.codex.cancel(id); assert.equal(f.store.read().jobs[0].status, 'running'); await until(() => f.store.read().jobs[0].status === 'interrupted');
  assert.equal((await f.trace()).filter(x => x.method === 'turn/start').length, 1);
});
test('approval stays pending and preserves the exact JSON-RPC request ID type', async t => {
  const f = await fixture(t, 'approval'); const bindingId = await f.register(); const id = f.codex.submit({ bindingId, prompt: 'approval', requestId: 'approval' });
  const job = await until(() => f.store.read().jobs.find(j => j.status === 'blocked_approval')); assert.equal(job.approvals[0].id, '017'); assert.equal((await f.trace()).filter(x => !x.method).length, 0);
  f.codex.decide(id, '017', 'accept'); await until(() => f.store.read().jobs[0].status === 'completed');
});
test('disconnect retains a lease, never replays start, and reconciles the observed remote turn', async t => {
  const f = await fixture(t, 'disconnect'); const bindingId = await f.register(); const id = f.codex.submit({ bindingId, prompt: 'once', requestId: 'disconnect' });
  await until(() => f.store.read().jobs[0].status === 'reconciling'); f.codex.kick(); assert.equal((await f.trace()).filter(x => x.method === 'turn/start').length, 1);
  await f.codex.reconcile(id); assert.equal(f.store.read().jobs[0].status, 'completed'); assert.match(f.store.read().jobs[0].text, /관측 결과/); assert.equal((await f.trace()).filter(x => x.method === 'turn/start').length, 1);
});
test('rejects a mismatched session cwd without dispatching a turn', async t => {
  const f = await fixture(t, 'wrong-cwd'); await assert.rejects(f.register(), /session_target_mismatch/); assert.equal(f.store.read().bindings.length, 0); assert.equal((await f.trace()).filter(x => x.method === 'turn/start').length, 0);
});
test('lost turn receipt is recovered only by matching actual remote input and start time', async t => {
  const f = await fixture(t, 'missing-receipt'); const bindingId = await f.register(); const id = f.codex.submit({ bindingId, prompt: '원래 실행 입력', requestId: 'missing-receipt' });
  await until(() => f.store.read().jobs[0].status === 'reconciling'); assert.equal(f.store.read().jobs[0].turnId, null);
  await assert.rejects(f.codex.reconcile(id), /owner_review/); await assert.rejects(f.codex.reconcile(id, 'not-a-real-turn'), /still_unconfirmed/);
  await f.codex.reconcile(id, 'turn-1'); assert.equal(f.store.read().jobs[0].status, 'completed'); assert.equal((await f.trace()).filter(x => x.method === 'turn/start').length, 1);
});
test('execution time budget requests interruption and retains actual terminal evidence', async t => {
  const f = await fixture(t, 'hold'); const bindingId = await f.register(); f.codex.submit({ bindingId, prompt: 'budget', requestId: 'budget', maxDurationMs: 1 });
  await until(() => f.store.read().jobs[0].status === 'interrupted'); assert.equal((await f.trace()).filter(x => x.method === 'turn/interrupt').length, 1);
});
test('discussion -> participant MCP prompt -> Codex receipt -> observed evidence -> every revision', async t => {
  const f = await fixture(t); const bindingId = await f.register(); let grant; let delegated = 0;
  f.store.transact(s => { const dot = s.participants[0]; dot.kind = 'browser'; dot.connectionId = 'dot'; dot.label = 'dot fixture'; s.connections.push({ id: 'dot', kind: 'browser', label: 'existing dot fixture', status: 'connected', models: [] }); });
  const mcp = new McpEndpoint({ store: f.store, codex: f.codex });
  const engine = new DiscussionEngine(f.store, { complete: async input => {
    input.hooks.dispatched(); input.hooks.receipt(`fixture-${input.requestId}`);
    if (input.prompt.includes('이 과제의 MCP codex_send 권한')) {
      delegated++; const d = f.store.read().discussions[0]; const task = d.tasks.find(t => t.participantId === input.participant.id && t.phase === 'verification' && t.status === 'running');
      const raw = { jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'codex_send', arguments: { taskId: task.id, prompt: 'dot이 직접 만든 검증 프롬프트: 실제 입력과 결과를 기록하세요.' } } };
      const first = await mcp.handle(raw, grant); assert.equal(first.result.isError, false); const again = await mcp.handle(raw, grant); assert.equal(again.result.isError, false);
      assert.equal(JSON.parse(first.result.content[0].text).jobId, JSON.parse(again.result.content[0].text).jobId);
    }
    return { text: response(input.prompt, input.participant, { verify: 'codex' }), receipt: 'browser-fixture-receipt', usage: null };
  } }, { sourceFetch: false, turnTimeoutMs: 3000 }); engine.executor = f.codex; f.codex.onProgress = () => engine.kick(); t.after(() => engine.close());
  const discussionId = engine.create({ ...topic, executionBindingId: bindingId }, 'codex-discussion'); const access = mcp.createGrant({ discussionId, participantId: 'fake-a', tools: ['codex_send', 'codex_status', 'codex_result'] }); grant = mcp.grant(`Bearer ${access.token}`);
  const d = await until(() => f.store.read().discussions.find(d => d.status === 'completed'), 8000); assert.equal(delegated, 1); assert.equal(d.used.toolJobs, 2); assert.equal(f.store.read().jobs.length, 2);
  assert.ok(f.store.read().jobs.some(j => j.prompt.startsWith('dot이 직접 만든'))); assert.ok(d.evidence.every(e => e.kind === 'execution' && e.status === 'observed'));
  for (const turn of d.turns.filter(t => t.phase === 'revision')) assert.match(turn.prompt, /RPC fixture 결과/); assert.equal((await f.trace()).filter(x => x.method === 'turn/start').length, 2);
});

test('unavailable isolation fails closed without launching the Codex adapter', async t => {
  const f = await fixture(t); const bin = await mkdtemp(join(tmpdir(), 'wj-bwrap-reject-')); const priorPath = process.env.PATH;
  // A rejecting wrapper simulates a host where user namespaces are disabled.
  await writeFile(join(bin, 'bwrap'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const isolated = new CodexExecutor(f.store, [process.execPath, script, 'normal'], [f.cwd], [bin]);
  try {
    process.env.PATH = `${bin}:${priorPath ?? ''}`;
    await assert.rejects(isolated.register({ cwd: f.cwd, label: 'isolated', threadId: 'fixture-thread', allowWrite: true }), /rpc_disconnected/);
    assert.equal(f.store.read().bindings.length, 0); assert.equal(f.store.read().jobs.length, 0);
    await assert.rejects(readFile(join(f.cwd, 'rpc-trace.jsonl')), { code: 'ENOENT' });
  } finally { process.env.PATH = priorPath; isolated.close(); await rm(bin, { recursive: true, force: true }); }
});
