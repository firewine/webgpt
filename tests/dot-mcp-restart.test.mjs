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

for (const boundary of ['retry_prepared', 'retry_input_page']) test('D3 actual SIGKILL after owner ' + boundary + ' preserves both attempts without automatic dispatch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-retry-crash-'));
  let app; t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  const script = `import { stoppedDotTopicFixture } from './tests/dot-mcp-fixture.mjs';
    const f = await stoppedDotTopicFixture({after(){}}, {directory:process.env.FIXTURE_DIRECTORY});
    const kill = () => process.kill(process.pid,'SIGKILL');
    if(process.env.FIXTURE_BOUNDARY === 'retry_prepared') f.app.store.subscribe(e => {if(e.type === 'discussion.retry_prepared') kill();});
    f.app.engine.control(f.discussionId,f.retryBody,'retry-after-stop-crash');
    f.onEvent = async requestId => {
      if(requestId === f.stoppedRequestId) throw Error('old_request_replayed');
      const page = f.call('dot_turn_get',{requestId,...f.claim(requestId),inputPage:0}).request.input;
      if(page.nextPage !== 1) throw Error('multi_page_fixture_required'); kill();
    };
    f.app.engine.control(f.discussionId,{action:'resume',expectedRevision:1},'resume-after-stop-crash');
    setTimeout(() => process.exit(20),5000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, FIXTURE_DIRECTORY: directory, FIXTURE_BOUNDARY: boundary }, stdio: ['ignore','pipe','pipe'] });
  t.after(() => { if(child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output=''; child.stdout.on('data',c=>output+=c); child.stderr.on('data',c=>output+=c);
  const [exit,signal] = await once(child,'close',{signal:AbortSignal.timeout(15000)});
  assert.equal(exit,null,output); assert.equal(signal,'SIGKILL'); assert.doesNotMatch(output,/Bearer|attemptToken|whsec_/);
  let calls=0;
  app = new Workspace(config(directory),1,{residentAutoSchedule:false,webhookTransport:{post:async()=>{calls++;throw Error('recovery cannot send');}}}); app.start();
  const before=app.store.read(), d=before.discussions[0], old=d.turns.find(v=>v.error==='owner_confirmed_retry_after_stop');
  assert.ok(old); assert.equal(d.status,'blocked'); assert.equal(d.turns.filter(v=>v.status==='completed').length,5);
  assert.equal(before.dotMcp.requests.items.find(r=>r.id===old.id).status,'consumed');
  const task=d.tasks.find(v=>v.id===old.taskId);
  assert.equal(task.status,boundary==='retry_prepared'?'pending':'unconfirmed');
  assert.equal(before.dotMcp.requests.items.length,boundary==='retry_prepared'?2:3);
  if(boundary==='retry_input_page') {
    const r=before.dotMcp.requests.items.at(-1), g=before.dotMcp.grants.find(g=>g.id===r.grantId);
    assert.equal(r.status,'held'); assert.notEqual(r.id,old.id);
    assert.throws(()=>app.dotAdapter.call('dot_turn_get',{requestId:r.id,attemptId:r.claim.id,attemptToken:app.vault.get(r.claim.id).token,inputPage:1},g),/request_stale/);
  }
  const body={action:'reconcile',resolution:'retry_after_stop',expectedRevision:1,turnId:old.id,stoppedWithoutSubmit:true,note:'Fixture actor stopped after input read; no submit invoked.'};
  for(let i=0;i<20;i++) { app.engine.control(d.id,body,'retry-after-stop-crash'); await app.residentRunner.tick(); await app.mcpEvents.pump(); }
  const after=app.store.read(); assert.equal(calls,0); assert.deepEqual(after.discussions,before.discussions);
  assert.deepEqual(after.dotMcp.requests,before.dotMcp.requests); assert.deepEqual(after.resident.messages,before.resident.messages);
  assert.equal(app.store.events(0,10000).filter(e=>e.type==='discussion.retry_prepared').length,1);
});

for (const boundary of ['prepared', 'dispatched', 'sending', 'claim_prepared', 'claim_file', 'input_page', 'mailbox']) test('D3 actual SIGKILL at ' + boundary + ' never creates a turn, resends or publishes on restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-dot-crash-'));
  let app; t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  const script = `import { dotFixture, key } from './tests/dot-mcp-fixture.mjs';
    const f = await dotFixture({ after() {} }, { directory: process.env.FIXTURE_DIRECTORY });
    const phase = process.env.FIXTURE_BOUNDARY; const kill = () => process.kill(process.pid, 'SIGKILL');
    const event = { prepared:'dot.request_prepared', dispatched:'resident.turn_dispatched', claim_prepared:'dot.claim_prepared', mailbox:'dot.reply_received' }[phase];
    f.app.store.subscribe(e => { if (e.type === event) kill(); });
    if (phase === 'claim_file') { const put = f.app.vault.put.bind(f.app.vault); f.app.vault.put = (id,value) => { put(id,value); if(id.startsWith('dot_attempt_')) kill(); }; }
    if (phase === 'sending') f.onEvent = async () => kill();
    if (phase === 'input_page') {
      for (let i=0;i<4;i++) f.app.resident.postMessage(f.roomId, { text: '보존할 긴 원문🙂'.repeat(300) }, key());
      f.onEvent = async requestId => { const attempt = f.claim(requestId);
        const page = f.call('dot_turn_get', { requestId, ...attempt, inputPage: 0 }).request.input;
        if (page.nextPage !== 1) throw new Error('multi_page_fixture_required'); kill(); };
    }
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
  if (boundary === 'input_page') assert.throws(() => app.dotAdapter.call('dot_turn_get', { requestId: r.id,
    attemptId: r.claim.id, attemptToken: app.vault.get(r.claim.id).token, inputPage: 1 }, grant), /request_stale/);
  const subscription = original.dotMcp.events.subscriptions[0]; const credential = app.vault.get(subscription.credentialRef);
  await app.mcpEvents.handle('events/subscribe', { name: 'webjjoku.turn_requested', arguments: { roomId: r.roomId, participantId: r.participantId, connectionId: r.connectionId }, delivery: { mode: 'webhook', url: credential.url, secret: credential.secret } }, grant);
  for (let i = 0; i < 20; i++) { await app.residentRunner.tick(); await app.mcpEvents.pump(); }
  assert.equal(calls, 0); assert.deepEqual(app.store.read().resident.messages, original.resident.messages); assert.equal(app.store.read().resident.turns.length, 1);
  const body = { resolution: boundary === 'mailbox' ? 'completed' : 'skip' }; const command = key();
  for (let i = 0; i < 20; i++) app.residentRunner.reconcile(r.roomId, r.id, body, command);
  const settled = app.store.read(); assert.equal(settled.resident.messages.length, original.resident.messages.length + (boundary === 'mailbox' ? 1 : 0));
  if (boundary === 'mailbox') { assert.equal(turn.text, r.reply.text); assert.equal(turn.receipt, r.reply.receipt); assert.equal(settled.resident.turns[0].receipt, r.reply.receipt); }
  assert.equal(settled.resident.dispatchLeases[0].state, 'released'); assert.equal(settled.dotMcp.events.outbox[0].status, 'settled');
  assert.equal(dotParticipantWait(settled, settled.resident.rooms[0], settled.participants.find(p => p.id === r.participantId)), null);
  assert.doesNotThrow(() => readDotState(settled)); assert.equal(calls, 0);
});
