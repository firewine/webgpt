import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { readDotState } from '../dist/server/workspace/dot-mcp.js';
import { dotParticipantWait } from '../dist/server/workspace/dot-mcp-policy.js';
import { config, key } from './dot-mcp-fixture.mjs';

for (const boundary of ['prepared', 'dispatched', 'sending', 'claim_prepared', 'claim_file', 'mailbox']) test('D3 actual SIGKILL at ' + boundary + ' never creates a turn, resends or publishes on restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-crash-'));
  let app; t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  const script = `import { dotFixture } from './tests/dot-mcp-fixture.mjs';
    const f = await dotFixture({ after() {} }, { directory: process.env.FIXTURE_DIRECTORY });
    const phase = process.env.FIXTURE_BOUNDARY; const kill = () => process.kill(process.pid, 'SIGKILL');
    const event = { prepared:'dot.request_prepared', dispatched:'resident.turn_dispatched', claim_prepared:'dot.claim_prepared', mailbox:'dot.reply_received' }[phase];
    f.app.store.subscribe(e => { if (e.type === event) kill(); });
    if (phase === 'claim_file') { const put = f.app.vault.put.bind(f.app.vault); f.app.vault.put = (id,value) => { put(id,value); if(id.startsWith('dot_attempt_')) kill(); }; }
    if (phase === 'sending') f.onEvent = async () => kill();
    await f.step(); process.exitCode = 20; await f.app.close(); process.exit(20);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, FIXTURE_DIRECTORY: directory, FIXTURE_BOUNDARY: boundary }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c);
  const [exit, signal] = await once(child, 'close', { signal: AbortSignal.timeout(15000) });
  assert.equal(exit, null, output); assert.equal(signal, 'SIGKILL'); assert.doesNotMatch(output, /Bearer|attemptToken|whsec_/);
  let calls = 0;
  app = new Workspace(config(directory), 1, { residentAutoSchedule: false, webhookTransport: { post: async () => { calls++; throw Error('No callback allowed during recovery'); } } });
  app.start();
  const original = app.store.read(); const r = original.dotMcp.requests.items[0]; const turn = original.resident.turns[0]; const outbox = original.dotMcp.events.outbox[0];
  assert.equal(original.resident.turns.length, 1); assert.equal(original.dotMcp.requests.items.length, 1);
  assert.equal(turn.id, r.id); assert.equal(outbox.requestId, r.id); assert.equal(r.status, 'held'); assert.equal(turn.status, 'unconfirmed');
  assert.equal(original.resident.dispatchLeases[0].state, 'unconfirmed'); assert.equal(outbox.status, 'held');
  const grant = original.dotMcp.grants.find(g => g.id === r.grantId);
  assert.doesNotThrow(() => app.dotMcp.authenticate(app.vault.get(grant.id).token));
  if (r.claim) assert.throws(() => app.dotAdapter.call('dot_turn_claim', { requestId: r.id, commandId: r.claim.commandId }, grant), /requires_reconciliation/);
  else assert.throws(() => app.dotAdapter.call('dot_turn_claim', { requestId: r.id, commandId: key() }, grant), /request_stale/);
  const subscription = original.dotMcp.events.subscriptions[0]; const credential = app.vault.get(subscription.credentialRef);
  await app.mcpEvents.handle('events/subscribe', { name: 'webjjoku.turn_requested', arguments: { roomId: r.roomId, participantId: r.participantId, connectionId: r.connectionId }, delivery: { mode: 'webhook', url: credential.url, secret: credential.secret } }, grant);
  for (let i = 0; i < 20; i++) { await app.residentRunner.tick(); await app.mcpEvents.pump(); }
  assert.equal(calls, 0); assert.equal(app.store.read().resident.messages.length, 0); assert.equal(app.store.read().resident.turns.length, 1);
  const body = { resolution: boundary === 'mailbox' ? 'completed' : 'skip' }; const command = key();
  for (let i = 0; i < 20; i++) app.residentRunner.reconcile(r.roomId, r.id, body, command);
  const settled = app.store.read(); assert.equal(settled.resident.messages.length, boundary === 'mailbox' ? 1 : 0);
  if (boundary === 'mailbox') { assert.equal(turn.text, r.reply.text); assert.equal(turn.receipt, r.reply.receipt); assert.equal(settled.resident.turns[0].receipt, r.reply.receipt); }
  assert.equal(settled.resident.dispatchLeases[0].state, 'released'); assert.equal(settled.dotMcp.events.outbox[0].status, 'settled');
  assert.equal(dotParticipantWait(settled, settled.resident.rooms[0], settled.participants.find(p => p.id === r.participantId)), null);
  assert.doesNotThrow(() => readDotState(settled)); assert.equal(calls, 0);
});
