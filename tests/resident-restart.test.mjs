import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { DispatchCoordinator } from '../dist/server/workspace/dispatch.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { ResidentRunner } from '../dist/server/workspace/resident-runner.js';
import { reply } from './resident-fixture.mjs';
import { budget, pacing } from './resident-fixture.mjs';

async function killAt(directory, stage) {
  const child = spawn(process.execPath, ['tests/fixtures/resident-crash.mjs', directory, stage], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); const [exitCode, signal] = await once(child, 'exit');
  assert.equal(exitCode, null, stderr); assert.equal(signal, 'SIGKILL', stderr);
}
function runtime(directory, enabled = true) {
  const store = new Store(directory); const resident = new ResidentStore(store, enabled); const dispatch = new DispatchCoordinator(enabled); let calls = 0;
  const provider = { complete: async input => { calls++; input.hooks.dispatched(); return { text: reply(), receipt: 'fresh', usage: null }; } };
  const engine = new DiscussionEngine(store, provider, { sourceFetch: false, turnTimeoutMs: 5000 }, undefined, dispatch);
  const runner = new ResidentRunner(store, resident, dispatch, provider, engine, 5000, { autoSchedule: false });
  return { store, resident, runner, engine, calls: () => calls, close: async () => { await Promise.all([runner.close(), engine.close()]); store.close(); } };
}

test('G0: paused focus and off room survive flag-off reader writes and re-enable without implicit dispatch or receipt loss', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-room-rollback-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const first = runtime(directory); first.resident.dispatchAvailable = true; first.engine.kick = () => {};
  const roomId = first.resident.snapshot().rooms[0].id; const control = body => first.resident.control(roomId, { expectedVersion: first.store.read().resident.rooms[0].version, ...body }, crypto.randomUUID());
  control({ action: 'configure', budgets: budget(Date.now()), pacing }); control({ action: 'set_member', participantId: 'fake-a', enabled: true }); control({ action: 'on' });
  const message = first.resident.postMessage(roomId, { text: 'Preserved rollback original' }, 'rollback-original');
  const did = first.runner.focus(roomId, { topic: 'paused focus', participantIds: ['fake-a', 'fake-b'] }, 'rollback-focus');
  first.engine.control(did, { action: 'pause', expectedRevision: 1 }, 'rollback-pause'); control({ action: 'off' }); const before = first.store.read().resident; await first.close();
  const second = runtime(directory, false);
  try {
    second.runner.recover(); second.engine.recover(); await second.runner.tick();
    second.store.transact(s => { s.browserPaused = true; }); assert.deepEqual(second.store.read().resident, before);
    assert.equal(second.calls(), 0); assert.equal(second.store.read().discussions[0].status, 'paused'); assert.equal(second.resident.message(roomId, message.messageId).message.text, 'Preserved rollback original');
  } finally { await second.close(); }
  const third = runtime(directory);
  try {
    third.runner.recover(); third.engine.recover(); await third.runner.tick(); assert.equal(third.calls(), 0); assert.deepEqual(third.store.read().resident, before);
    assert.deepEqual(third.resident.postMessage(roomId, { text: 'Preserved rollback original' }, 'rollback-original'), message);
  } finally { await third.close(); }
});
for (const stage of ['before_prepared_commit', 'prepared', 'dispatched', 'receipt', 'delta', 'before_final_commit']) {
  test('R2-B: real SIGKILL at ' + stage + ' preserves the journal and replays no uncertain request', { timeout: 15000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'wj-resident-crash-')); t.after(() => rm(directory, { recursive: true, force: true }));
    await killAt(directory, stage); const f = runtime(directory);
    try {
      f.runner.recover(); const before = f.store.read().resident;
      for (let i = 0; i < 100; i++) await f.runner.tick();
      if (stage === 'before_prepared_commit') {
        assert.equal(before.turns.length, 0); assert.equal(before.rooms[0].ledger?.length ?? 0, 0); assert.equal(f.calls(), 1);
      } else {
        assert.equal(f.calls(), 0); assert.equal(before.turns.length, 1); assert.equal(before.turns[0].status, 'unconfirmed');
        assert.equal(before.dispatchLeases[0].state, 'unconfirmed'); assert.equal(before.rooms[0].ledger.length, 1); assert.equal(before.messages.length, 0);
        if (['receipt', 'delta', 'before_final_commit'].includes(stage)) assert.equal(before.turns[0].receipt, 'remote-receipt');
        if (['delta', 'before_final_commit'].includes(stage)) assert.equal(before.turns[0].text, '{"partial":');
      }
      const receipts = await readFile(join(directory, 'remote.jsonl'), 'utf8').catch(() => ''); const ids = receipts.trim() ? receipts.trim().split('\n').map(l => JSON.parse(l).requestId) : [];
      assert.equal(ids.length, new Set(ids).size);
    } finally { await f.close(); }
  });
}
for (const stage of ['context_before', 'context_pack', 'context_cas', 'context_committed']) {
  test('R2-H: real SIGKILL at ' + stage + ' applies a retried context command exactly once', { timeout: 15000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'wj-context-crash-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const seed = runtime(directory); const roomId = seed.resident.snapshot().rooms[0].id; const epoch = seed.store.read().resident.rooms[0].epoch;
    seed.store.transact(s => { s.resident.rooms[0].ledger = [{ requestId: 'prior-fixture-receipt', kind: 'resident', reservedAt: new Date().toISOString(), settledAt: new Date().toISOString(), usage: { input: 4, output: 8 }, error: null }]; });
    const priorLedger = seed.store.read().resident.rooms[0].ledger; await seed.close();
    await killAt(directory, stage); const f = runtime(directory);
    try {
      f.runner.recover(); let result;
      for (let i = 0; i < 100; i++) { const r = f.runner.handoff(roomId, { participantId: 'fake-a', expectedGeneration: 1, expectedEpoch: epoch }, 'context-crash'); if (!result) result = r; else assert.deepEqual(r, result); }
      const state = f.store.read().resident; assert.equal(state.rooms[0].contexts[0].generation, 2); assert.equal(state.contextCheckpoints.length, 1);
      assert.equal(f.store.events(0).filter(e => e.type === 'resident.context_rotated').length, 1); assert.equal(f.calls(), 0); assert.deepEqual(state.rooms[0].ledger, priorLedger);
    } finally { await f.close(); }
  });
}
