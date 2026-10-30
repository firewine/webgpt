import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../../dist/server/workspace/store.js';
import { ResidentStore } from '../../dist/server/workspace/resident-store.js';
import { DispatchCoordinator } from '../../dist/server/workspace/dispatch.js';
import { DiscussionEngine } from '../../dist/server/workspace/engine.js';
import { ResidentRunner } from '../../dist/server/workspace/resident-runner.js';
import { reply, budget, pacing } from '../resident-fixture.mjs';

const [directory, stage] = process.argv.slice(2); const store = new Store(directory); const resident = new ResidentStore(store, true); resident.dispatchAvailable = true;
const dispatch = new DispatchCoordinator(); const roomId = resident.snapshot().rooms[0].id;
const crash = name => { if (stage === name) process.kill(process.pid, 'SIGKILL'); };
const provider = { complete: async input => {
  appendFileSync(join(directory, 'remote.jsonl'), JSON.stringify({ requestId: input.requestId }) + '\n');
  input.hooks.dispatched(); crash('dispatched'); input.hooks.receipt('remote-receipt'); crash('receipt'); input.hooks.delta('{"partial":'); crash('delta');
  return { text: reply(), receipt: 'remote-receipt', usage: null };
} };
const engine = new DiscussionEngine(store, provider, { sourceFetch: false, turnTimeoutMs: 5000 }, undefined, dispatch);
const runner = new ResidentRunner(store, resident, dispatch, provider, engine, 5000, { autoSchedule: false });
if (stage.startsWith('context_')) {
  const original = store.transact.bind(store);
  store.transact = (fn, command) => {
    crash('context_before');
    const result = original((state, emit) => {
      if (stage === 'context_pack') {
        const points = state.resident.contextCheckpoints;
        points.push = (...items) => { const result = Array.prototype.push.apply(points, items); crash('context_pack'); return result; };
      }
      return fn(state, event => { emit(event); if (event.type === 'resident.context_rotated') crash('context_cas'); });
    }, command);
    crash('context_committed'); return result;
  };
  runner.handoff(roomId, { participantId: 'fake-a', expectedGeneration: 1, expectedEpoch: store.read().resident.rooms[0].epoch }, 'context-crash');
} else {
  const control = body => resident.control(roomId, { expectedVersion: store.read().resident.rooms[0].version, ...body }, crypto.randomUUID());
  control({ action: 'configure', budgets: budget(Date.now(), 1), pacing }); control({ action: 'set_member', participantId: 'fake-a', enabled: true }); control({ action: 'on' });
  store.transact(s => { s.resident.rooms[0].nextEligibleAt = new Date(Date.now() - 1000).toISOString(); });
  const original = store.transact.bind(store);
  store.transact = (fn, command) => {
    let prepared = false;
    const result = original((state, emit) => fn(state, event => {
      emit(event);
      if (event.type === 'resident.turn_prepared') { prepared = true; crash('before_prepared_commit'); }
      if (event.type === 'resident.turn_finished') crash('before_final_commit');
    }), command);
    if (prepared) crash('prepared'); return result;
  };
  await runner.tick();
}
throw new Error('Crash stage did not trigger');
