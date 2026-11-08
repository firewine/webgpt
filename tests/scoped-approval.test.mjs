import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexExecutor } from '../dist/server/execution/codex.js';
import { AppError } from '../dist/server/workspace/util.js';
import { workspace, until, ownerKey } from './workspace-helpers.mjs';
const script = fileURLToPath(new URL('fixtures/managed-codex-rpc.mjs', import.meta.url));

async function fixture(t, options = {}) {
  const f = await workspace(t, {}, { residentAutoSchedule: false }); f.app.engine.kick = () => {};
  f.cwd = await mkdtemp(join(tmpdir(), 'wj-scoped-')); const remote = join(f.directory, 'synthetic-remote'); await mkdir(remote);
  const git = args => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=', ...args], { cwd: f.cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, stdio: 'ignore' });
  git(['init', '-q', '-b', 'work-scoped']); await writeFile(join(f.cwd, 'source.txt'), 'BASELINE\n'); git(['add', 'source.txt']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic baseline']);
  f.app.codex.close(); f.proofs = 0; f.runtime = 'fixture-runtime-v1'; const mode = options.hold ? 'scoped-hold' : 'scoped-approval';
  f.codex = new CodexExecutor(f.app.store, [process.execPath, script, mode, remote], [f.cwd], [], { protectRead: true, scopedApprovals: true }); f.app.codex = f.codex;
  // Synthetic protocol DI only. Native acceptance/OS containment is tested separately.
  f.codex.isolation.verify = async () => {};
  f.codex.isolation.commandFor = () => [process.execPath, script, mode, remote];
  f.codex.isolation.approvalIdentity = (_binding, copy) => f.runtime + ':' + copy;
  f.codex.isolation.verifyApproval = async () => { f.proofs++; await options.proof?.(f); };
  if (options.modify) { const original = f.codex.approval.bind(f.codex); f.codex.approval = (b, rpc, id, method, params) => { const changed = options.modify(method, params); original(b, rpc, id, changed.method, changed.params); }; }
  t.after(async () => { f.codex.close(); await rm(f.cwd, { recursive: true, force: true }); });
  f.bindingId = await f.codex.register({ cwd: f.cwd, label: 'Synthetic scoped approval', sessionMode: 'new', allowWrite: options.write === true });
  f.workAllowed = true; if (options.work) f.codex.workScopeGuard = () => { if (!f.workAllowed) throw new AppError('work_execution_scope_changed', 409); };
  f.jobId = f.codex.submit({ bindingId: f.bindingId, prompt: 'Synthetic command only.', requestId: options.work ? 'resident-work:scoped-fixture' : 'scoped-fixture' });
  f.job = () => f.app.store.read().jobs.find(j => j.id === f.jobId);
  f.approval = () => f.job()?.approvals[0];
  f.confirm = () => ({ expectedScopeDigest: f.approval().scope.digest, ownerConfirmed: true, commandId: crypto.randomUUID() });
  f.trace = async () => (await readFile(join(remote, 'rpc-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  f.accepts = async () => (await f.trace()).filter(m => m.id === 'managed-approval' && m.result?.decision === 'accept');
  await until(() => f.approval()?.scope && (options.wait === false || f.approval().scope.state !== 'checking'));
  return f;
}

for (const write of [false, true]) test(`scoped ${write ? 'write' : 'read'} approval records selection/intent before one plain response and preserves source`, async t => {
  const f = await fixture(t, { write }); assert.equal(f.approval().scope.state, 'ready');
  assert.equal(f.approval().scope.profileId, write ? 'webjjoku_copy' : 'webjjoku_read');
  assert.throws(() => f.codex.decide(f.jobId, 'managed-approval', 'accept'), /confirmation_required/);
  assert.throws(() => f.codex.decide(f.jobId, 'managed-approval', 'accept', { ...f.confirm(), expectedScopeDigest: '0'.repeat(64) }), /scope_changed/);
  const rpc = f.codex.processes.get(f.bindingId), original = rpc.respond.bind(rpc); let observed = false;
  rpc.respond = (id, result, ...rest) => { if (result?.decision === 'accept') { const a = f.approval(); assert.equal(a.scope.state, 'unconfirmed'); assert.equal(a.scope.choice.delivery, 'sending'); observed = true; } return original(id, result, ...rest); };
  await f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()); await until(() => f.job().status === 'completed');
  assert.equal(observed, true); assert.equal(f.approval().scope.state, 'sent'); assert.equal((await f.accepts()).length, 1); assert.equal(f.proofs, 2);
  assert.throws(() => f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()), /approval_not_pending/);
  const events = f.app.store.events(0); assert.ok(events.find(e => e.type === 'codex.approval_selected').id < events.find(e => e.type === 'codex.approval_sending').id);
  assert.equal(await readFile(join(f.cwd, 'source.txt'), 'utf8'), 'BASELINE\n');
});

test('owner API requires exact digest/confirmation, awaits native proof and refuses unauthorized or unexpected input', async t => {
  const f = await fixture(t), path = `/api/jobs/${f.jobId}/approve`, body = { approvalId: 'managed-approval', decision: 'accept' };
  assert.equal((await fetch(f.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.url }, body: JSON.stringify(body) })).status, 401);
  assert.equal((await f.api(path, body)).status, 409);
  assert.equal((await f.api(path, { ...body, ...f.confirm(), commandId: undefined, extra: true })).status, 400);
  const confirm = f.confirm(); delete confirm.commandId;
  assert.equal((await fetch(f.url + path, { method: 'POST', headers: { Authorization: 'Bearer ' + ownerKey, 'Content-Type': 'application/json', Origin: f.url }, body: JSON.stringify({ ...body, ...confirm }) })).status, 409);
  assert.equal((await f.api(path, { ...body, ...confirm })).status, 200); await until(() => f.job().status === 'completed');
  assert.equal((await f.accepts()).length, 1); assert.equal((await f.api(path, { ...body, ...confirm })).status, 409);
});

test('legacy owner approval API does not acquire a new mandatory idempotency header', async t => {
  const f = await workspace(t); let observed;
  f.app.codex.decide = (...args) => { observed = args; };
  const r = await fetch(f.url + '/api/jobs/legacy-job/approve', { method: 'POST', headers: { Authorization: 'Bearer ' + ownerKey, 'Content-Type': 'application/json', Origin: f.url }, body: JSON.stringify({ approvalId: 'legacy-approval', decision: 'decline' }) });
  assert.equal(r.status, 200); assert.deepEqual(observed.slice(0, 3), ['legacy-job', 'legacy-approval', 'decline']); assert.equal(observed[3].commandId, undefined);
});

for (const kind of ['unknown', 'permission', 'file', 'hidden']) test(`${kind} native requests remain blocked before owner confirmation`, async t => {
  const f = await fixture(t, { modify(method, params) { const p = { ...params };
    if (kind === 'unknown') p.futurePermission = {};
    if (kind === 'permission') p.additionalPermissions = { network: true };
    if (kind === 'hidden') p.command = 'printf sk-fixture-private-credential12345';
    return { method: kind === 'file' ? 'item/fileChange/requestApproval' : method, params: p }; } });
  assert.equal(f.approval().scope.state, 'blocked'); assert.equal(f.proofs, 0);
  assert.throws(() => f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()), /requires_scoped_support/); assert.equal((await f.accepts()).length, 0);
});

test('two owner requests share one selected intent and never duplicate a response', async t => {
  let release; const gate = new Promise(r => { release = r; }); t.after(() => release());
  const f = await fixture(t, { proof: async f => { if (f.proofs === 2) await gate; } });
  const first = f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()); await until(() => f.approval().scope.state === 'selected');
  assert.throws(() => f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()), /requires_scoped_support/);
  release(); await first; await until(async () => (await f.accepts()).length === 1); assert.equal((await f.accepts()).length, 1);
});

for (const change of ['authority', 'runtime', 'manifest', 'capture', 'scope', 'deadline', 'branch']) test(`${change} change after ready cannot approve a different command environment`, async t => {
  const f = await fixture(t), confirm = f.confirm();
  if (change === 'authority') f.app.store.transact(s => { s.bindings[0].authority.revokedAt = new Date().toISOString(); });
  if (change === 'runtime') f.runtime = 'fixture-runtime-v2';
  if (change === 'manifest') { const manifest = f.codex.workspaces.manifest(f.jobId); await rm(join(manifest.copyRoot, '..', 'manifest.json')); }
  if (change === 'capture') await rm(join(f.directory, 'execution-evidence', f.job().capture.artifactId, 'raw.ndjson'));
  if (change === 'scope') f.app.store.transact(s => { s.jobs[0].approvals[0].scope.command = 'different-command'; });
  if (change === 'deadline') f.app.store.transact(s => { s.jobs[0].deadlineAt = new Date(Date.now() - 1000).toISOString(); });
  if (change === 'branch') execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '-qb', 'changed-fixture'], { cwd: f.cwd, stdio: 'ignore' });
  await assert.rejects(async () => f.codex.decide(f.jobId, 'managed-approval', 'accept', confirm)); assert.equal((await f.accepts()).length, 0);
});

test('revocation while owner proof is pending prevents a late response', async t => {
  let release; const gate = new Promise(r => { release = r; }); t.after(() => release());
  const f = await fixture(t, { proof: async f => { if (f.proofs === 2) await gate; } });
  const pending = f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()); await until(() => f.approval().scope.state === 'selected');
  await f.codex.revokeBinding(f.bindingId); release(); await assert.rejects(pending); assert.equal((await f.accepts()).length, 0);
});

test('room/work scope revocation during owner proof prevents a stale command', async t => {
  let release; const gate = new Promise(r => { release = r; }); t.after(() => release());
  const f = await fixture(t, { work: true, proof: async f => { if (f.proofs === 2) await gate; } });
  const pending = f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()); await until(() => f.approval().scope.state === 'selected');
  f.workAllowed = false; release(); await assert.rejects(pending, /work_execution_scope_changed/); assert.equal((await f.accepts()).length, 0);
});

test('reused native RPC IDs cannot replace an already sent decision with a cancellation record', async t => {
  const f = await fixture(t, { hold: true }), rpc = f.codex.processes.get(f.bindingId), original = f.approval();
  await f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm());
  await until(async () => (await f.accepts()).length === 1);
  f.codex.approval(f.bindingId, rpc, original.rpcId, original.method, original.params);
  assert.equal(f.approval().scope.state, 'sent'); assert.equal(f.approval().scope.choice.delivery, 'sent');
  assert.equal(f.job().capture.complete, false); assert.equal((await f.accepts()).length, 1);
});

test('uncertain response transmission retains intent and never retries acceptance', async t => {
  const f = await fixture(t), rpc = f.codex.processes.get(f.bindingId); rpc.respond = () => { throw Error('synthetic_pipe_failure'); };
  await assert.rejects(f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()), /synthetic_pipe_failure/);
  assert.equal(f.job().status, 'reconciling'); assert.equal(f.approval().scope.state, 'unconfirmed'); assert.equal(f.approval().scope.choice.delivery, 'unconfirmed');
  assert.throws(() => f.codex.decide(f.jobId, 'managed-approval', 'accept', f.confirm()), /approval_not_pending/); assert.equal((await f.accepts()).length, 0);
});

test('restart keeps an unsent owner intent unconfirmed with no approval replay', async t => {
  const f = await fixture(t); f.app.store.transact(s => { const scope = s.jobs[0].approvals[0].scope; scope.state = 'selected'; scope.choice = { commandId: 'owner-before-crash', selectedAt: new Date().toISOString(), delivery: 'prepared' }; });
  f.codex.close(); f.codex.closed = false; f.codex.recover();
  assert.equal(f.approval().scope.state, 'unconfirmed'); assert.equal(f.approval().scope.choice.delivery, 'unconfirmed');
  assert.equal(f.job().status, 'reconciling'); assert.equal((await f.accepts()).length, 0);
});
