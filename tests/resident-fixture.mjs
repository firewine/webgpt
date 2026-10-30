import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { DispatchCoordinator } from '../dist/server/workspace/dispatch.js';
import { DiscussionEngine } from '../dist/server/workspace/engine.js';
import { ResidentRunner } from '../dist/server/workspace/resident-runner.js';

export const reply = (fields = {}) => JSON.stringify({ version: 1, action: 'say', text: '공개 원문에 대한 독립적인 재분석', replyTo: null, mentions: [], claims: [], reviews: [], verifications: [], uncertainty: ['별도 검증 필요'], proposals: [], ...fields });
export const budget = (clock, maxRequests = 6) => ({ maxRequests, maxTokens: 100_000, maxToolJobs: 0, deadlineAt: new Date(clock + 3_600_000).toISOString() });
export const pacing = { minIntervalMs: 1, idleNudgeMs: 10, passBackoffMs: 2, sleepAfterPasses: 3 };
export async function residentFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-resident-runtime-')); const store = new Store(directory);
  const resident = new ResidentStore(store, true); resident.dispatchAvailable = true; const dispatch = new DispatchCoordinator();
  let time = Date.now(); let calls = 0;
  const provider = { complete: async input => { calls++; if (options.complete) return options.complete(input);
    input.hooks.dispatched(); const text = reply(); input.hooks.delta(text); return { text, receipt: 'fixture-' + calls, usage: null }; } };
  const engine = new DiscussionEngine(store, provider, { sourceFetch: false, turnTimeoutMs: 5000 }, undefined, dispatch);
  const runner = new ResidentRunner(store, resident, dispatch, provider, engine, 5000, { clock: () => time, autoSchedule: false });
  t.after(async () => { await Promise.all([runner.close(), engine.close()]); store.close(); await rm(directory, { recursive: true, force: true }); });
  const roomId = resident.snapshot().rooms[0].id;
  const control = body => resident.control(roomId, { expectedVersion: store.read().resident.rooms[0].version, ...body }, crypto.randomUUID());
  const configure = () => {
    control({ action: 'configure', budgets: budget(time, options.maxRequests ?? 6), pacing: { ...pacing, ...options.pacing } });
    for (const participantId of options.members ?? ['fake-a']) control({ action: 'set_member', participantId, enabled: true });
    control({ action: 'on' });
    time = Math.max(time, Date.now()) + 10;
  };
  if (options.configure !== false) configure();
  return { directory, store, resident, dispatch, engine, runner, provider, roomId, control, configure,
    room: () => store.read().resident.rooms[0], calls: () => calls, clock: () => time, advance: (ms = 100) => { time += ms; } };
}
