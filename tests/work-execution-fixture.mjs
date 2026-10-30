import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexExecutor } from '../dist/server/execution/codex.js';
import { WorkExecutionBridge } from '../dist/server/workspace/work-execution.js';
import { workFixture } from './work-fixture.mjs';
export const rpcScript = fileURLToPath(new URL('fixtures/codex-rpc.mjs', import.meta.url));
export async function executionFixture(t, options = {}) {
  const f = await workFixture(t, { ...options, on: false });
  const cwd = options.cwd ?? await mkdtemp(join(tmpdir(), 'wj-work-repo-'));
  if (!options.cwd) {
    execFileSync('git', ['init', '-q', '-b', 'work-fixture'], { cwd });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd });
  }
  // This process is the deterministic RPC fixture, never a real Codex binary.
  // Real namespace/scope/write acceptance is a separate R6-D/F gate.
  f.app.codex.close(); const codex = new CodexExecutor(f.app.store, [process.execPath, rpcScript, options.mode ?? 'normal', 'persist'], [cwd]);
  const bridge = new WorkExecutionBridge(f.app.store, f.q, codex, true, 300000);
  f.app.codex = codex; f.app.workExecution = bridge; f.app.engine.executor = codex; f.app.residentRunner.options.execution = bridge;
  codex.workScopeGuard = (s, job, phase) => bridge.guard(s, job, phase); codex.onProgress = () => f.app.residentRunner.kick();
  const bindingId = await codex.register({ cwd, label: '모의 Codex · 실제 모델/코드 실행 없음', threadId: 'fixture-thread', allowWrite: options.allowWrite ?? false });
  const room = f.app.store.read().resident.rooms[0]; f.control({ action: 'configure', budgets: { ...room.budgets, maxToolJobs: options.maxToolJobs ?? 4 }, pacing: room.pacing });
  for (const participantId of ['fake-a', 'fake-b']) f.q.seat(f.roomId, { participantId, expectedVersion: 1, role: 'specialist', enabled: true, kinds: ['analysis', 'codex'], scopeRefs: ['room:' + f.roomId, 'binding:' + bindingId] }, crypto.randomUUID());
  if (options.on !== false) f.control({ action: 'on' });
  if (!options.cwd) t.after(() => rm(cwd, { recursive: true, force: true }));
  return { ...f, cwd, codex, bridge, bindingId,
    proposeCode: overrides => f.propose({ title: '읽기 전용 검증 업무', description: '허용된 원문과 명령 종료 상태를 확인하고 미실행을 구분해 보고하세요.', kind: 'codex', authorizedScopeRef: 'binding:' + bindingId, acceptance: [{ id: 'execution', text: '기록된 명령의 종료 상태 확인', check: { kind: 'execution' } }], ...overrides }),
    trace: async () => (await readFile(join(cwd, 'rpc-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) };
}
