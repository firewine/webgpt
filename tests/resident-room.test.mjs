import test from 'node:test';
import assert from 'node:assert/strict';
import { residentFixture, reply, budget, pacing } from './resident-fixture.mjs';
import { AppError } from '../dist/server/workspace/util.js';
import { usageFor } from '../dist/server/workspace/dispatch.js';

test('R2-C: explicit budgets cap pass/repair/say at six calls and preserve unknown usage', async t => {
  let n = 0;
  const f = await residentFixture(t, { complete: async input => { input.hooks.dispatched(); n++; const text = n === 1 ? 'invalid JSON' : n % 2 ? reply({ action: 'pass', text: '', uncertainty: [] }) : reply();
    input.hooks.delta(text); return { text, receipt: 'budget-' + n, usage: null }; } });
  for (let i = 0; i < 100; i++) { f.advance(); await f.runner.tick(); }
  assert.equal(f.calls(), 6); assert.equal(f.room().observedStatus, 'budget_exhausted');
  const turns = f.store.read().resident.turns; assert.equal(turns.filter(t => t.repairOf).length, 1);
  assert.equal(usageFor(f.room()).requests, 6); assert.equal(usageFor(f.room()).unknownUsage, 6);
  assert.equal(f.room().ledger.length, 6); assert.ok(f.room().ledger.every(e => e.settledAt !== null));
  assert.throws(() => f.control({ action: 'wake' }), /budget_exhausted/);
  const requests = f.room().ledger.map(e => e.requestId); f.control({ action: 'off' });
  f.control({ action: 'configure', budgets: budget(f.clock(), 7), pacing });
  assert.deepEqual(f.room().ledger.map(e => e.requestId), requests); assert.equal(usageFor(f.room()).unknownUsage, 6);
  f.control({ action: 'on' }); f.advance(); await f.runner.tick(); assert.equal(f.calls(), 7);
});

test('R2-D: off, pass sleep and exhausted deadline survive 100 ticks; user input wakes without catch-up', async t => {
  const f = await residentFixture(t, { complete: async input => { input.hooks.dispatched(); return { text: reply({ action: 'pass', text: '', uncertainty: [] }), receipt: 'pass', usage: { input: 1, output: 1 } }; } });
  f.control({ action: 'off' }); for (let i = 0; i < 100; i++) await f.runner.tick(); assert.equal(f.calls(), 0);
  f.control({ action: 'on' }); for (let i = 0; i < 3; i++) { f.advance(); await f.runner.tick(); }
  assert.equal(f.room().observedStatus, 'sleeping'); for (let i = 0; i < 100; i++) { f.advance(); await f.runner.tick(); } assert.equal(f.calls(), 3);
  f.resident.postMessage(f.roomId, { text: '새 질문' }, 'wake-user');
  await Promise.all(Array.from({ length: 100 }, () => f.runner.tick())); assert.equal(f.calls(), 4);
  f.advance(4_000_000); for (let i = 0; i < 100; i++) await f.runner.tick(); assert.equal(f.calls(), 4); assert.equal(f.room().observedStatus, 'budget_exhausted');
});

test('R2-D: a missed timer interval is coalesced to one evaluation, not a replay of past ticks', async t => {
  const f = await residentFixture(t, { maxRequests: 100 }); f.advance(100_000);
  await Promise.all(Array.from({ length: 100 }, () => f.runner.tick())); assert.equal(f.calls(), 1);
  for (let i = 0; i < 100; i++) await f.runner.tick(); assert.equal(f.calls(), 1);
});

test('room on refuses missing settings/members, never supplies product defaults, and checks reported tokens before another call', async t => {
  const f = await residentFixture(t, { configure: false, complete: async () => ({ text: reply(), receipt: 'token', usage: { input: 15, output: 15 } }) });
  assert.throws(() => f.control({ action: 'on' }), /room_settings_required/); assert.equal(f.room().budgets, null); assert.equal(f.room().pacing, undefined);
  assert.throws(() => f.control({ action: 'configure', budgets: { maxRequests: 6 }, pacing }), /invalid_text|room_settings_required/);
  f.control({ action: 'configure', budgets: { ...budget(f.clock()), maxTokens: 20 }, pacing });
  assert.throws(() => f.control({ action: 'on' }), /room_members_required/); f.control({ action: 'set_member', participantId: 'fake-a', enabled: true }); f.control({ action: 'on' });
  await f.runner.tick(); for (let i = 0; i < 100; i++) { f.advance(); await f.runner.tick(); }
  assert.equal(f.calls(), 1); assert.equal(usageFor(f.room()).inputTokens + usageFor(f.room()).outputTokens, 30); assert.equal(f.room().observedStatus, 'budget_exhausted');
});

for (const reason of ['auth_required', 'usage_limit', 'reasoning_effort_not_supported', 'browser_identity_mismatch']) {
  test('R2-G: ' + reason + ' is a durable block, not a retry/fallback after 100 ticks', async t => {
    const f = await residentFixture(t, { complete: async input => { input.hooks.dispatched(); throw new AppError(reason, 409); } });
    await f.runner.tick(); for (let i = 0; i < 100; i++) { f.advance(); await f.runner.tick(); }
    assert.equal(f.calls(), 1); assert.equal(f.room().reason, reason); assert.equal(f.room().members[0].blockedReason, reason);
    assert.equal(f.store.read().resident.turns[0].status, 'failed'); assert.equal(usageFor(f.room()).requests, 1);
  });
}

test('off committed after preparation is rechecked before transport invocation and settles the unsent reservation', async t => {
  const f = await residentFixture(t);
  const unsubscribe = f.store.subscribe(event => { if (event.type === 'resident.turn_prepared') f.control({ action: 'off' }); });
  try { await f.runner.tick(); } finally { unsubscribe(); }
  assert.equal(f.calls(), 0); assert.equal(f.room().observedStatus, 'off');
  assert.equal(f.store.read().resident.turns[0].error, 'dispatch_scope_changed'); assert.equal(f.store.read().resident.dispatchLeases[0].state, 'released');
});

test('recovery exposes a legacy uncertain request as a room block instead of claiming on and retrying elsewhere', async t => {
  const f = await residentFixture(t); f.store.transact(s => { s.discussions.push({ id: 'legacy-uncertain', turns: [{ id: 'original-turn', status: 'unconfirmed' }] }); });
  f.runner.recover(); for (let i = 0; i < 100; i++) await f.runner.tick();
  assert.equal(f.calls(), 0); assert.equal(f.room().observedStatus, 'blocked'); assert.equal(f.room().reason, 'restart_requires_reconciliation');
  assert.throws(() => f.control({ action: 'wake' }), /reconciliation_required/); assert.equal(f.store.read().discussions[0].turns[0].id, 'original-turn');
});
