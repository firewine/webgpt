import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { executionFixture } from './work-execution-fixture.mjs';
import { until } from './workspace-helpers.mjs';
import { WorkExecutionBridge } from '../dist/server/workspace/work-execution.js';
import { FakeResidentCompletion } from '../dist/server/workspace/resident-fake.js';
const key = () => crypto.randomUUID();
const jobFor = f => f.app.store.read().jobs.at(-1);

test('R6: ready work -> immutable intent -> existing executor -> command evidence -> independent reviewer in the same room', async t => {
  const prompts = []; const fake = new FakeResidentCompletion({ complete: async () => assert.fail('No real model') }, 1);
  const f = await executionFixture(t, { provider: { complete: input => { prompts.push(input.prompt); return fake.complete(input); } } });
  const id = f.proposeCode(); f.bridge.tick(); let s = f.app.store.read(); const link = s.resident.jobLinks[0];
  assert.equal(link.input.requestId, 'resident-work:' + link.attemptId); assert.equal(s.discussions.length, 0); assert.equal(s.resident.rooms[0].toolReservations.length, 1);
  assert.equal(s.jobs[0].discussionId, null); assert.equal(s.jobs[0].taskId, null); assert.equal(s.jobs[0].revision, null);
  await until(() => jobFor(f).status === 'completed'); f.bridge.tick(); const report = f.task(id).reports[0];
  assert.equal(f.task(id).status, 'review'); assert.equal(report.execution.turnId, jobFor(f).turnId); assert.equal(report.checks[0].outcome, 'observed_pass'); assert.equal(report.execution.commands[0].exitCode, 0);
  await f.step(); assert.equal(f.task(id).status, 'done'); assert.equal(f.task(id).reviews[0].reviewerId, 'fake-b'); assert.equal(f.task(id).reports.length, 1);
  assert.ok(prompts.some(p => p.includes('fixture only') && p.includes('검사 기록') && p.includes(jobFor(f).turnId)));
  const trace = await f.trace(); const starts = trace.filter(v => v.method === 'turn/start'); assert.equal(starts.length, 1); assert.equal(starts[0].params.sandboxPolicy.type, 'readOnly'); assert.equal(starts[0].params.approvalPolicy, 'untrusted'); assert.equal(starts[0].params.approvalsReviewer, 'user');
  const events = f.app.store.events(0); assert.ok(events.find(e => e.type === 'resident.work_execution_intent').id < events.find(e => e.type === 'codex.queued').id);
  const before = f.app.store.cursor(); for (let i = 0; i < 100; i++) { f.bridge.tick(); f.q.detail(f.roomId, id); }
  assert.equal(f.app.store.cursor(), before); assert.equal(f.app.store.read().resident.messages.filter(m => m.sourceId === report.id).length, 1);
});

for (const [mode, outcome] of [['work-empty', 'not_run'], ['work-unknown', 'unknown'], ['work-fail', 'observed_fail']]) test('R6-E: completed with ' + mode + ' is not an observed execution pass or an accepted task', async t => {
  const f = await executionFixture(t, { mode }); const id = f.proposeCode(); f.bridge.tick(); await until(() => jobFor(f).status === 'completed'); f.bridge.tick();
  assert.equal(f.task(id).reports[0].checks[0].outcome, outcome); await f.step(); assert.notEqual(f.task(id).status, 'done'); assert.equal(f.app.store.read().jobs.length, 1);
});

const revoke = (f, mode) => {
  if (mode === 'off') f.control({ action: 'off' });
  else if (mode === 'seat') f.q.seat(f.roomId, { participantId: 'fake-a', expectedVersion: 2, role: 'monitor', enabled: true, kinds: ['codex'], scopeRefs: ['binding:' + f.bindingId] }, key());
  else f.app.store.transact(s => { s.resident.workItems[0].version++; });
};
for (const moment of ['queued', 'approval', 'result']) for (const mode of ['off', 'seat', 'version']) test(`R6-B: ${mode} at ${moment} never accepts an out-of-scope start, late approval or current result`, async t => {
  const f = await executionFixture(t, { mode: moment === 'approval' ? 'approval' : 'work-delayed' });
  const kick = f.codex.kick.bind(f.codex); if (moment === 'queued') f.codex.kick = () => {};
  const id = f.proposeCode(); f.bridge.tick();
  if (moment === 'queued') { revoke(f, mode); kick(); await until(() => jobFor(f).status === 'failed'); }
  else if (moment === 'approval') {
    await until(() => jobFor(f).status === 'blocked_approval'); revoke(f, mode);
    assert.throws(() => f.codex.decide(jobFor(f).id, '017', 'accept'), /work_execution_scope_changed|room_tool_budget_exhausted/);
    assert.equal(jobFor(f).approvals[0].status, 'pending'); assert.equal((await f.trace()).filter(v => v.id === '017' && v.result?.decision === 'accept').length, 0);
    await f.codex.cancel(jobFor(f).id); await until(() => jobFor(f).status === 'interrupted');
  } else { await until(() => !!jobFor(f).turnId); revoke(f, mode); await until(() => jobFor(f).status === 'completed'); }
  f.bridge.tick(); const s = f.app.store.read(); assert.equal(s.resident.jobLinks[0].reported, true); assert.ok(s.resident.jobLinks[0].result.scopeReason);
  assert.equal(f.task(id).currentReportId, null); assert.equal(f.task(id).reports.length, 0); assert.notEqual(f.task(id).status, 'done');
  assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, moment === 'queued' ? 0 : 1);
  assert.equal(s.resident.messages.filter(m => m.sourceId === s.resident.jobLinks[0].result.report.id).length, 1);
  for (let i = 0; i < 20; i++) f.bridge.tick(); assert.equal(f.app.store.read().jobs.length, 1);
});

test('R6-C: two actors on one canonical workspace keep one writer; stable request ID rejects different submit input', async t => {
  const f = await executionFixture(t, { mode: 'hold' }); let max = 0;
  f.app.store.subscribe(() => { max = Math.max(max, f.app.store.read().jobs.filter(j => ['running', 'blocked_approval'].includes(j.status)).length); });
  f.proposeCode(); f.proposeCode({ title: '두 번째 실행 업무', allowedParticipantIds: ['fake-b'] }); f.bridge.tick(); f.bridge.tick();
  await until(() => f.app.store.read().jobs.some(j => j.turnId)); assert.equal(f.app.store.read().jobs.length, 2); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1);
  const l = f.app.store.read().resident.jobLinks[0]; assert.throws(() => f.codex.submit({ ...l.input, prompt: l.input.prompt + 'changed' }), /idempotency_conflict/);
  await f.codex.cancel(f.app.store.read().jobs[0].id); await until(() => f.app.store.read().jobs[1].turnId);
  await f.codex.cancel(f.app.store.read().jobs[1].id); await until(() => f.app.store.read().jobs[1].status === 'interrupted'); assert.equal(max, 1); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 2);
});

test('R6-D: unverified secret/link/output boundary blocks write tasks without launching any work turn', async t => {
  const f = await executionFixture(t, { allowWrite: true }); const canary = 'fixture-only-secret-sentinel';
  await writeFile(join(f.cwd, '.env'), canary); await symlink('/etc/passwd', join(f.cwd, 'outside-link'));
  const id = f.proposeCode(); for (let i = 0; i < 100; i++) f.bridge.tick();
  assert.equal(f.task(id).reason, 'work_write_safety_unverified'); assert.equal(f.app.store.read().jobs.length, 0); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 0);
  assert.equal(await readFile(join(f.cwd, '.env'), 'utf8'), canary); assert.ok(!JSON.stringify(await f.trace()).includes(canary));
});

test('R6: rework preserves the first execution and freezes full prior artifact, command evidence and rejection feedback into a new attempt', async t => {
  const f = await executionFixture(t); const id = f.proposeCode(); f.bridge.tick(); await until(() => jobFor(f).status === 'completed'); f.bridge.tick();
  const first = f.task(id).reports[0]; f.q.review(f.roomId, id, { expectedVersion: f.task(id).version, reportDigest: first.digest, decision: 'rework', reason: '출력 근거와 반론을 보강해 주세요.' }, key());
  f.bridge.tick(); await until(() => f.app.store.read().jobs.length === 2 && jobFor(f).status === 'completed'); f.bridge.tick();
  const l = f.app.store.read().resident.jobLinks[1]; assert.ok(l.input.prompt.includes(first.digest)); assert.ok(l.input.prompt.includes('fixture only')); assert.ok(l.input.prompt.includes('출력 근거와 반론을 보강해 주세요.'));
  await f.step(); assert.equal(f.task(id).status, 'done'); assert.equal(f.task(id).reports[0].digest, first.digest); assert.equal(f.task(id).reports.length, 2);
  assert.equal(new Set(f.app.store.read().jobs.map(j => j.requestId)).size, 2); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 2);
});

test('R6: work execution requires the exact mapping and installed guard; immutable work inputs cannot be steered', async t => {
  const f = await executionFixture(t, { mode: 'hold' }); const id = f.proposeCode(); f.bridge.tick(); const j = await until(() => jobFor(f).turnId && jobFor(f));
  await assert.rejects(f.codex.steer(j.id, j.turnId, '입력을 몰래 변경'), /work_execution_immutable_input/); await f.codex.cancel(j.id); await until(() => jobFor(f).status === 'interrupted'); f.bridge.tick();
  const resume = f.codex.kick.bind(f.codex); f.codex.kick = () => {};
  const task2 = f.proposeCode({ title: 'guard 누락 검사', allowedParticipantIds: ['fake-b'] }); f.bridge.tick(); f.codex.workScopeGuard = null; resume(); await until(() => jobFor(f).status === 'failed');
  assert.equal(jobFor(f).error, 'work_execution_guard_required'); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1); assert.notEqual(f.task(task2).status, 'done'); assert.equal(f.task(id).reports.length, 1);
});

test('R6: future schema, lost execution marker and changed frozen submit input fail closed with original jobs retained', async t => {
  const f = await executionFixture(t, { mode: 'hold' }); f.codex.kick = () => {}; f.proposeCode(); f.bridge.tick(); const original = f.app.store.read();
  const open = () => new WorkExecutionBridge(f.app.store, f.q, f.codex, true, 300000);
  f.app.store.transact(s => { s.resident.workExecutionSchemaVersion = 99; }); assert.throws(open, /unsupported_work_execution_schema/);
  f.app.store.transact(s => { delete s.resident.workExecutionSchemaVersion; }); assert.throws(open, /work_execution_state_missing/);
  f.app.store.transact(s => { s.resident.workExecutionSchemaVersion = 1; s.resident.jobLinks[0].input.prompt += 'tampered'; }); assert.throws(open, /invalid_work_execution_state/);
  assert.equal(f.app.store.read().jobs[0].id, original.jobs[0].id); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 0);
});

test('R6: automatic resident driver performs work, reports and independently reviews without another owner command', async t => {
  const f = await executionFixture(t, { autoSchedule: true, pacing: { minIntervalMs: 2 } }); const id = f.proposeCode();
  await until(() => f.task(id).status === 'done', 8000); assert.equal(f.task(id).reports.length, 1); assert.equal(f.task(id).reviews.length, 1); assert.equal(f.app.store.read().jobs.length, 1);
});

test('R6: lost remote receipt stays on one job after 100 ticks and requires matching original input before reconciliation', async t => {
  const f = await executionFixture(t, { mode: 'missing-receipt' }); const id = f.proposeCode(); f.bridge.tick(); await until(() => jobFor(f).status === 'reconciling'); f.bridge.tick();
  const original = jobFor(f); assert.equal(original.turnId, null); for (let i = 0; i < 100; i++) f.bridge.tick();
  await assert.rejects(f.codex.reconcile(original.id), /owner_review/); await assert.rejects(f.codex.reconcile(original.id, 'wrong'), /still_unconfirmed/);
  await f.codex.reconcile(original.id, 'turn-1'); f.bridge.tick(); assert.equal(jobFor(f).id, original.id); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1);
  assert.equal(f.task(id).reports[0].checks[0].outcome, 'not_run'); assert.notEqual(f.task(id).status, 'done');
});

test('R6: flag off rejects a queued work dispatch while preserving original intent and result for recovery', async t => {
  const f = await executionFixture(t); const kick = f.codex.kick.bind(f.codex); f.codex.kick = () => {}; const id = f.proposeCode(); f.bridge.tick();
  const input = f.app.store.read().resident.jobLinks[0].input; const disabled = new WorkExecutionBridge(f.app.store, f.q, f.codex, false, 300000);
  f.codex.workScopeGuard = (s, j, p) => disabled.guard(s, j, p); kick(); await until(() => jobFor(f).status === 'failed'); disabled.tick();
  assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 0); assert.deepEqual(f.app.store.read().resident.jobLinks[0].input, input); assert.equal(f.task(id).currentReportId, null);
});

test('R6: oversized original source blocks before submit without truncating input, leaking a tool reservation or making another attempt', async t => {
  const f = await executionFixture(t); const text = '검토 원문'.repeat(3500); const sourceId = f.app.resident.postMessage(f.roomId, { text }, key()).messageId;
  const source2 = f.app.resident.postMessage(f.roomId, { text }, key()).messageId;
  const id = f.proposeCode({ sourceMessageIds: [sourceId, source2] }); f.bridge.tick();
  assert.equal(f.task(id).reason, 'work_execution_input_too_large'); assert.equal(f.app.store.read().jobs.length, 0); assert.deepEqual(f.app.store.read().resident.rooms[0].toolReservations ?? [], []);
  assert.equal(f.app.store.read().resident.messages.find(m => m.id === sourceId).text, text); for (let i = 0; i < 100; i++) f.bridge.tick(); assert.equal(f.app.store.read().resident.workAttempts.length, 1);
});

test('R6: one explicit tool budget admits one job and retains the second task instead of starting it after completion', async t => {
  const f = await executionFixture(t, { maxToolJobs: 1 }); const first = f.proposeCode(); const second = f.proposeCode({ title: '한도 밖 두 번째 일감', allowedParticipantIds: ['fake-b'] });
  f.bridge.tick(); f.bridge.tick(); await until(() => jobFor(f).status === 'completed'); f.bridge.tick(); await f.step();
  assert.equal(f.task(first).status, 'done'); assert.equal(f.task(second).reason, 'room_tool_budget_exhausted'); assert.equal(f.app.store.read().jobs.length, 1); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1);
});

test('R6: a missing result guard is recorded at completion and cannot be revived by wiring the guard later', async t => {
  const f = await executionFixture(t, { mode: 'work-delayed' }); const id = f.proposeCode(); f.bridge.tick(); await until(() => jobFor(f).turnId);
  const guard = f.codex.workScopeGuard; f.codex.workScopeGuard = null; await until(() => jobFor(f).status === 'completed'); f.codex.workScopeGuard = guard; f.bridge.tick();
  assert.equal(f.app.store.read().resident.jobLinks[0].resultScopeReason, 'work_execution_guard_required'); assert.equal(f.task(id).currentReportId, null); assert.equal(f.task(id).reports.length, 0);
  assert.equal(f.app.store.read().resident.jobLinks[0].result.scopeReason, 'work_execution_guard_required'); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1);
});

test('R6-D/E: an unexpected reported file change in read-only work is retained as evidence and blocks done', async t => {
  const f = await executionFixture(t, { mode: 'work-file-change' }); const id = f.proposeCode(); f.bridge.tick(); await until(() => jobFor(f).status === 'completed'); f.bridge.tick();
  const report = f.task(id).reports[0]; assert.equal(report.execution.fileChanges.length, 1); assert.ok(report.outputs.some(v => v.kind === 'file_change')); assert.ok(report.blockers.length > 0); assert.equal(report.checks[0].outcome, 'observed_fail');
  await f.step(); assert.notEqual(f.task(id).status, 'done'); assert.equal(f.app.store.read().jobs.length, 1);
});

test('R6: an accepted execution report survives its author handoff and remains reviewable by another current actor', async t => {
  const f = await executionFixture(t); const id = f.proposeCode(); f.bridge.tick(); await until(() => jobFor(f).status === 'completed'); f.bridge.tick();
  const report = f.task(id).reports[0]; const r = f.app.store.read().resident.rooms[0]; f.app.residentRunner.handoff(f.roomId, { participantId: 'fake-a', expectedGeneration: 1, expectedEpoch: r.epoch }, key());
  await f.step(); assert.equal(f.task(id).status, 'done'); assert.equal(f.task(id).reports[0].digest, report.digest); assert.equal(f.task(id).reviews[0].reviewerId, 'fake-b'); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1);
});

test('R6: off between durable intent and submit records not_sent once, preserves input and permits explicit amendment without replay', async t => {
  const f = await executionFixture(t); const id = f.proposeCode();
  const unsubscribe = f.app.store.subscribe(e => { if (e.type === 'resident.work_execution_intent') f.control({ action: 'off' }); }); f.bridge.tick(); unsubscribe();
  const l = f.app.store.read().resident.jobLinks[0]; assert.equal(l.status, 'not_sent'); assert.equal(l.reported, true); assert.equal(f.app.store.read().jobs.length, 0);
  for (let i = 0; i < 100; i++) f.bridge.tick(); assert.equal(f.app.store.read().resident.messages.filter(m => m.sourceId === l.id).length, 1);
  f.q.update(f.roomId, id, { expectedVersion: f.task(id).version, description: '미전송 원문을 확인한 뒤 다시 승인한 일감' }, key()); f.control({ action: 'on' }); f.bridge.tick();
  await until(() => jobFor(f).status === 'completed'); f.bridge.tick(); await f.step(); assert.equal(f.task(id).status, 'done'); assert.equal(f.app.store.read().jobs.length, 1);
  assert.deepEqual(f.app.store.read().resident.jobLinks[0].input, l.input); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1);
});

test('R6: a submit command receipt with a lost job is refused instead of being treated as not_sent or submitted again', async t => {
  const f = await executionFixture(t); f.codex.kick = () => {}; f.proposeCode(); f.bridge.tick(); const before = f.app.store.read(); const l = before.resident.jobLinks[0];
  f.app.store.transact(s => { s.jobs = []; s.resident.jobLinks[0].codexJobId = null; s.resident.jobLinks[0].status = 'intent'; });
  const cursor = f.app.store.cursor(); assert.equal(f.app.store.readCommand('codex:' + l.input.requestId, l.input).result, before.jobs[0].id);
  assert.throws(() => f.bridge.tick(), /work_execution_job_missing/); assert.throws(() => f.bridge.recover(), /work_execution_job_missing/);
  assert.equal(f.app.store.cursor(), cursor); assert.equal(f.app.store.read().jobs.length, 0); assert.equal(f.app.store.read().resident.jobLinks[0].status, 'intent'); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 0);
});
