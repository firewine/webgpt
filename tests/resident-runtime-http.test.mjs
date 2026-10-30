import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { workspace, until } from './workspace-helpers.mjs';
import { budget, pacing, reply, residentFixture } from './resident-fixture.mjs';
import { AppError, digest } from '../dist/server/workspace/util.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';

async function setup(f, maxRequests = 6) {
  const { rooms } = await (await f.api('/api/rooms')).json(); const root = '/api/rooms/' + rooms[0].id;
  const control = async body => {
    const { room } = await (await f.api(root)).json(); const response = await f.api(root + '/control', { expectedVersion: room.version, ...body });
    assert.equal(response.status, 200, await response.clone().text()); return response;
  };
  await control({ action: 'configure', budgets: budget(Date.now(), maxRequests), pacing: { ...pacing, minIntervalMs: 5 } });
  await control({ action: 'set_member', participantId: 'fake-a', enabled: true });
  return { root, control };
}

test('owner HTTP -> automatic room loop -> six fake responses -> durable budget stop and raw lookup', async t => {
  const f = await workspace(t, { residentEnabled: true }); let external = 0;
  f.app.providers.complete = async () => { external++; throw new Error('real provider must not replace the fake'); };
  const { root, control } = await setup(f);
  await f.api(root + '/messages', { text: '각자 분석해 이야기해 주세요.' }); await control({ action: 'on' });
  await until(() => f.app.store.read().resident.rooms[0].observedStatus === 'budget_exhausted');
  let list = await (await f.api(root + '/turns?after=0&limit=100')).json(); assert.equal(list.turns.length, 6); assert.equal(list.hasMore, false); assert.equal(external, 0);
  const turn = (await (await f.api(root + '/turns/' + list.turns[0].id)).json()).turn;
  assert.match(turn.reply.text, /모의/); assert.equal(turn.promptDigest, digest(turn.prompt));
  const state = await (await f.api('/api/state')).json(); assert.equal(state.resident.rooms[0].used.requests, 6); assert.equal(state.resident.rooms[0].used.unknownUsage, 6);
  assert.doesNotMatch(JSON.stringify(state.resident), /고정 단계 없는|각자 분석해/);
  assert.equal((await f.api(root + '/turns?after=7')).status, 409); assert.equal((await f.api(root + '/turns?limit=101')).status, 400);
  await f.api(root + '/messages', { text: '예산 소진 뒤 메시지' }); await delay(30); list = await (await f.api(root + '/turns')).json(); assert.equal(list.turns.length, 6);
  const room = (await (await f.api(root)).json()).room; const data = { participantId: 'fake-a', expectedEpoch: room.epoch, expectedGeneration: 1 };
  const cp = await (await f.api(root + '/handoff', data, { headers: { 'Idempotency-Key': 'http-handoff' } })).json();
  const again = await (await f.api(root + '/handoff', data, { headers: { 'Idempotency-Key': 'http-handoff' } })).json(); assert.deepEqual(again, cp);
  assert.equal((await f.api(root + '/checkpoints/' + cp.checkpointId)).status, 200);
  for (const path of [root + '/turns', root + '/turns/' + turn.id, root + '/checkpoints/' + cp.checkpointId]) assert.equal((await fetch(f.url + path)).status, 401);
  const before = f.app.store.read().resident; const reader = new ResidentStore(f.app.store, false); reader.snapshot(); assert.deepEqual(f.app.store.read().resident, before);
  assert.throws(() => reader.control(room.id, { action: 'on', expectedVersion: room.version }, 'off-new'), /resident_disabled/);
});

test('owner reconciles a real uncertain fixture receipt exactly once and no request is resent automatically', async t => {
  let calls = 0;
  const f = await workspace(t, { residentEnabled: true }, { residentProvider: { complete: async input => { calls++; input.hooks.dispatched(); input.hooks.receipt('uncertain-remote'); input.hooks.delta('{"unfinished":'); throw new AppError('stream_unconfirmed', 502, true); } } });
  const { root, control } = await setup(f); await control({ action: 'on' });
  await until(() => f.app.store.read().resident.turns[0]?.status === 'unconfirmed');
  const turn = f.app.store.read().resident.turns[0]; assert.equal(turn.receipt, 'uncertain-remote');
  assert.equal((await f.api(root + '/control', { action: 'wake', expectedVersion: f.app.store.read().resident.rooms[0].version })).status, 409);
  for (let i = 0; i < 100; i++) f.app.residentRunner.kick(); await delay(25); assert.equal(calls, 1);
  const body = { resolution: 'completed', text: reply(), receipt: 'matched-original-conversation' };
  let result;
  for (let i = 0; i < 20; i++) { const response = await f.api(root + '/turns/' + turn.id + '/reconcile', body, { headers: { 'Idempotency-Key': 'owner-reconcile' } }); assert.equal(response.status, 200); const r = await response.json(); if (!result) result = r; else assert.deepEqual(r, result); }
  assert.equal(calls, 1); assert.equal(f.app.store.read().resident.messages.length, 1); assert.equal(f.app.store.events(0).filter(e => e.type === 'resident.reconciled').length, 1);
  assert.equal(f.app.store.read().resident.dispatchLeases[0].state, 'released'); assert.equal(f.app.store.read().resident.rooms[0].observedStatus, 'blocked');
  assert.match(f.app.store.read().resident.turns[0].receipt, /^owner-confirmed:/);
});

test('topic tool reservation is bounded, idempotent, and checked again after room off', async t => {
  const f = await residentFixture(t); f.engine.kick = () => {};
  const did = f.runner.focus(f.roomId, { topic: '검증 과제', participantIds: ['fake-a', 'fake-b'] }, 'tool-focus');
  assert.throws(() => f.store.transact(s => f.dispatch.reserveTool(s, did, 'tool-one')), /room_tool_budget_exhausted/);
  f.control({ action: 'off' }); f.control({ action: 'configure', budgets: { ...budget(f.clock()), maxToolJobs: 1 }, pacing }); f.control({ action: 'on' });
  f.store.transact(s => f.dispatch.reserveTool(s, did, 'tool-one')); f.store.transact(s => f.dispatch.reserveTool(s, did, 'tool-one')); assert.deepEqual(f.room().toolReservations, ['tool-one']);
  assert.throws(() => f.store.transact(s => f.dispatch.reserveTool(s, did, 'tool-two')), /room_tool_budget_exhausted/);
  f.control({ action: 'off' }); assert.throws(() => f.store.transact(s => f.dispatch.reserveTool(s, did, 'tool-one')), /room_tool_budget_exhausted/);
  assert.equal(f.calls(), 0);
});

test('resident account history cannot be moved to a different connection and active browser input cannot take a manual lease', async t => {
  const f = await workspace(t, { residentEnabled: true });
  f.app.store.transact(s => {
    for (const id of ['account-a', 'account-b']) s.connections.push({ id, kind: 'openai-oauth', label: id, status: 'connected', models: [{ id: 'fixture', label: 'Fixture' }] });
    s.participants.push({ id: 'gpt-room', kind: 'openai-oauth', connectionId: 'account-a', label: 'Room GPT', modelId: 'fixture', role: '', reasoningEffort: 'xhigh' });
    s.resident.rooms[0].contexts = [{ participantId: 'gpt-room', generation: 1, history: [{ role: 'user', content: 'old account context' }], checkpointId: null, lastSeenSequence: 0 }];
  });
  const changed = await f.api('/api/participants/gpt-room', { label: 'Room GPT', connectionId: 'account-b', modelId: 'fixture' });
  assert.equal(changed.status, 409); assert.equal((await changed.json()).error.code, 'resident_account_change_requires_new_participant');
  assert.equal((await f.api('/api/participants/gpt-room', { label: 'Room GPT', connectionId: 'account-a', modelId: 'fixture', reasoningEffort: 'high' })).status, 200);
  f.app.store.transact(s => { s.resident.turns.push({ id: 'browser-turn', roomId: s.resident.rooms[0].id, participantId: 'browser', status: 'running', participant: { kind: 'browser', connectionId: 'browser-connection' } }); });
  assert.equal((await f.api('/api/browser/control', { paused: true })).status, 409);
  assert.throws(() => f.app.assertConnectionIdle('browser-connection'), /connection_in_use/);
  assert.throws(() => f.app.assertNoActiveTurn('browser-connection'), /reconciliation_required/);
});
