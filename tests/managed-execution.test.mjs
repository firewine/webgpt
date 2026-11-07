import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../dist/server/workspace/store.js';
import { CodexExecutor } from '../dist/server/execution/codex.js';
import { until } from './workspace-helpers.mjs';

const script = fileURLToPath(new URL('fixtures/managed-codex-rpc.mjs', import.meta.url));
async function fixture(t, mode = 'normal', protectRead = true) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-managed-')), cwd = join(directory, 'source'), stateDir = join(directory, 'remote');
  await mkdir(cwd); await mkdir(stateDir);
  const gitEnv = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const previous = Object.fromEntries(Object.keys(gitEnv).map(k => [k, process.env[k]])); Object.assign(process.env, gitEnv);
  const git = (...args) => { const fd = openSync(join(directory, 'git-output'), 'w'); try {
    execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'init.templateDir=', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, stdio: ['ignore', fd, fd] });
  } finally { closeSync(fd); } };
  git('init', '-q', '-b', 'managed-fixture'); await writeFile(join(cwd, 'source.txt'), 'baseline\n');
  await writeFile(join(cwd, '.env'), 'SYNTHETIC_SECRET=not-a-real-key\n'); git('add', 'source.txt', '.env'); git('commit', '-qm', 'synthetic baseline');
  const f = { directory, cwd, stateDir, mode, store: new Store(join(directory, 'app')), copies: [] };
  f.create = () => {
    const codex = new CodexExecutor(f.store, [process.execPath, script, mode, stateDir], [cwd], [], { protectRead });
    // Explicit synthetic DI: real copy/inspection/capture, no claim of OS isolation.
    codex.isolation.verify = async () => {};
    codex.isolation.commandFor = (_binding, copyRoot) => { f.copies.push(copyRoot); return [process.execPath, script, f.mode, stateDir]; };
    return codex;
  };
  f.codex = f.create();
  t.after(async () => { f.codex.close(); f.store.close(); await rm(directory, { recursive: true, force: true });
    for (const [k, value] of Object.entries(previous)) { if (value === undefined) delete process.env[k]; else process.env[k] = value; } });
  f.bindingId = await f.codex.register({ cwd, label: 'Synthetic managed session', sessionMode: 'new' });
  f.binding = () => f.store.read().bindings.find(b => b.id === f.bindingId);
  f.job = id => f.store.read().jobs.find(j => j.id === id);
  f.submit = requestId => f.codex.submit({ bindingId: f.bindingId, prompt: 'Read source.txt; synthetic protocol test only.', requestId });
  f.trace = async () => (await readFile(join(stateDir, 'rpc-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  f.rpc = () => f.codex.processes.get(f.bindingId);
  f.checked = id => until(() => f.job(id)?.readCopy?.status === 'checked');
  return f;
}

test('managed registration sends zero turns; first dispatch reuses its creator and second resumes the persisted fixed ID', async t => {
  const f = await fixture(t, 'normal', false), creator = f.rpc();
  assert.equal(f.binding().readProtection, 1); assert.deepEqual(f.binding().managedSession, { version: 1, state: 'initial', firstRequestId: null });
  assert.equal(f.codex.isolation.profileFor(f.binding()), 'webjjoku_read'); assert.equal(f.codex.isolation.profileFor({ allowWrite: true }), 'webjjoku_copy');
  assert.equal((await f.trace()).filter(m => m.method === 'turn/start').length, 0);
  await assert.rejects(readFile(join(f.stateDir, 'thread.json')), { code: 'ENOENT' });
  const sent = [], request = creator.request.bind(creator);
  creator.request = (method, params, ...rest) => { if (method === 'turn/start') sent.push(f.binding().managedSession); return request(method, params, ...rest); };
  const first = f.submit('first'); await f.checked(first);
  assert.deepEqual(sent, [{ version: 1, state: 'dispatched', firstRequestId: 'first' }]);
  assert.equal(f.rpc(), creator); assert.equal(f.codex.validateResult(first), null);
  assert.equal(f.job(first).capture.complete, true); assert.equal(f.job(first).activities[0].command.exitCode, 0); assert.equal(f.job(first).draft, undefined);
  assert.equal(f.codex.workspaces.manifest(first).copyRoot, f.copies[0]);
  await assert.rejects(readFile(join(f.copies[0], '.env')), { code: 'ENOENT' });
  const second = f.submit('second'); await f.checked(second);
  assert.equal(f.codex.validateResult(second), null); assert.notEqual(f.copies[0], f.copies[1]);
  const trace = await f.trace(), starts = trace.filter(m => m.method === 'thread/start'), turns = trace.filter(m => m.method === 'turn/start'), resumes = trace.filter(m => m.method === 'thread/resume');
  assert.equal(starts.length, 1); assert.equal(turns.length, 2); assert.equal(resumes.length, 1);
  assert.equal(turns[0].pid, starts[0].pid); assert.notEqual(turns[1].pid, starts[0].pid);
  for (const m of [...turns, ...resumes]) { assert.equal(m.params.threadId, f.binding().threadId); assert.equal(m.params.permissions, 'webjjoku_read'); assert.equal(m.params.sandboxPolicy, undefined); }
  assert.equal(await readFile(join(f.cwd, 'source.txt'), 'utf8'), 'baseline\n');
});

test('an initial pre-dispatch guard failure loses only its prepared session and permits explicit owner replacement', async t => {
  const f = await fixture(t); f.codex.beforeDispatch = () => { throw new Error('fixture_guard_denied'); };
  const id = f.submit('guarded-first'); await until(() => f.job(id)?.status === 'failed' && f.binding().managedSession.state === 'lost');
  assert.equal((await f.trace()).filter(m => m.method === 'turn/start').length, 0);
  await f.codex.register({ cwd: f.cwd, label: 'Explicit replacement after no dispatch', sessionMode: 'new' });
  assert.equal(f.binding().managedSession.state, 'initial');
  assert.equal((await f.trace()).filter(m => m.method === 'thread/start').length, 2);
  assert.equal(f.store.read().jobs.length, 1);
});
test('future or missing managed protection metadata is rejected without silently migrating it', async t => {
  const f = await fixture(t); const { initializeExecutionProtection } = await import('../dist/server/execution/authority.js');
  for (const mutate of [s => { s.bindings[0].managedSession.version = 2; }, s => { s.bindings[0].readProtection = 2; },
    s => { delete s.executionProtectionVersion; delete s.bindings[0].authority; }]) {
    const s = f.store.read(); mutate(s); assert.throws(() => initializeExecutionProtection(s), /invalid_managed_session_state|execution_protection_state_missing/);
  }
});
test('creator disconnect before its initial request blocks the binding without automatic replacement or replay', async t => {
  const f = await fixture(t); f.rpc().close(); await until(() => f.binding().managedSession.state === 'lost');
  assert.equal(f.binding().status, 'blocked'); assert.throws(() => f.submit('after-disconnect'), /managed_session_lost|execution_binding_not_ready/);
  f.codex.kick(); assert.equal(f.store.read().jobs.length, 0);
  const trace = await f.trace(); assert.equal(trace.filter(m => m.method === 'thread/start').length, 1); assert.equal(trace.filter(m => m.method === 'turn/start').length, 0);
});

test('read reconciliation re-proves its original copy and never falls back to an unprotected connection', async t => {
  const f = await fixture(t, 'hold'), jid = f.submit('reconcile-read'); await until(() => f.job(jid)?.turnId);
  const copy = f.codex.workspaces.manifest(jid).copyRoot, traceBefore = (await f.trace()).length;
  f.codex.close(); f.codex = f.create(); f.codex.recover();
  assert.equal(f.job(jid).status, 'reconciling');
  f.codex.isolation.verify = async () => { throw new Error('synthetic_proof_denied'); };
  await assert.rejects(f.codex.reconcile(jid), /protected_execution_unavailable/);
  assert.equal((await f.trace()).length, traceBefore); assert.equal(f.copies.length, 1);
  const metadata = join(f.stateDir, 'thread.json'), remote = JSON.parse(await readFile(metadata, 'utf8'));
  remote.turn.status = 'interrupted'; await writeFile(metadata, JSON.stringify(remote));
  let verified = 0;
  f.codex.isolation.verify = async (binding, copyRoot) => { verified++; assert.equal(binding.readProtection, 1); assert.equal(copyRoot, copy); };
  await f.codex.reconcile(jid); await until(() => f.job(jid).readCopy.status === 'blocked');
  assert.equal(verified, 1); assert.equal(f.copies.at(-1), copy);
  assert.equal(f.job(jid).status, 'interrupted'); assert.notEqual(f.codex.validateResult(jid), null);
  const trace = await f.trace(); assert.equal(trace.filter(m => m.method === 'thread/start').length, 1);
  assert.equal(trace.filter(m => m.method === 'turn/start').length, 1); assert.equal(trace.filter(m => m.method === 'thread/resume').length, 0);
});

test('cold restart marks an initial durable session lost rather than starting or resuming it', async t => {
  const f = await fixture(t); f.codex.close(); f.store.close(); f.store = new Store(join(f.directory, 'app'));
  assert.equal(f.binding().managedSession.state, 'initial'); f.codex = f.create(); f.codex.recover();
  assert.equal(f.binding().managedSession.state, 'lost'); assert.equal(f.binding().status, 'blocked');
  assert.throws(() => f.submit('after-restart'), /managed_session_lost|execution_binding_not_ready/); assert.equal(f.store.read().jobs.length, 0);
  const trace = await f.trace(); assert.equal(trace.filter(m => m.method === 'thread/start').length, 1); assert.equal(trace.filter(m => ['thread/resume', 'turn/start'].includes(m.method)).length, 0);
});

test('protected read forbids permission escalation and steering while preserving explicit decline', async t => {
  const f = await fixture(t, 'hold'), running = f.submit('immutable'); await until(() => f.job(running)?.turnId);
  await assert.rejects(f.codex.steer(running, f.job(running).turnId, 'changed input'), /protected_input_immutable/);
  await f.rpc().request('fixture/complete'); await f.checked(running); f.mode = 'approval';
  const jid = f.submit('approval'); await until(() => f.job(jid)?.status === 'blocked_approval');
  assert.throws(() => f.codex.decide(jid, 'managed-approval', 'accept'), /protected_approval_requires_scoped_support/);
  f.codex.decide(jid, 'managed-approval', 'decline'); await until(() => f.job(jid).readCopy.status === 'blocked');
  assert.equal(f.job(jid).status, 'interrupted'); assert.notEqual(f.codex.validateResult(jid), null);
  const trace = await f.trace(); assert.equal(trace.filter(m => m.method === 'turn/steer').length, 0); assert.equal(trace.filter(m => m.id === 'managed-approval' && m.result?.decision === 'accept').length, 0);
});

for (const damage of ['missing', 'tampered']) test(`checked read still rejects ${damage} sealed evidence at publication`, async t => {
  const f = await fixture(t), jid = f.submit('checked-' + damage); await f.checked(jid);
  const manifest = f.codex.workspaces.manifest(jid), path = join(dirname(manifest.copyRoot), 'manifest.json');
  if (damage === 'missing') await rm(path);
  else { const envelope = JSON.parse(await readFile(path, 'utf8')); envelope.body.manifest.head = '0'.repeat(40); await writeFile(path, JSON.stringify(envelope)); }
  assert.equal(f.codex.validateResult(jid), 'execution_read_copy_integrity_changed');
});
for (const damage of ['missing', 'tampered', 'changed']) test(`protected read cannot publish a completed turn with ${damage} copy evidence`, async t => {
  const f = await fixture(t, 'hold'), jid = f.submit('damaged-' + damage); await until(() => f.job(jid)?.turnId);
  const manifest = f.codex.workspaces.manifest(jid), path = join(dirname(manifest.copyRoot), 'manifest.json');
  if (damage === 'missing') await rm(path);
  else if (damage === 'tampered') { const envelope = JSON.parse(await readFile(path, 'utf8')); envelope.body.manifest.head = '0'.repeat(40); await writeFile(path, JSON.stringify(envelope)); }
  else await writeFile(join(manifest.copyRoot, 'source.txt'), 'unauthorized read-copy modification\n');
  await f.rpc().request('fixture/complete'); await until(() => f.job(jid)?.readCopy?.status === 'blocked');
  assert.equal(f.job(jid).status, 'completed'); assert.equal(f.job(jid).capture.complete, true); assert.ok(f.job(jid).readCopy.reason);
  assert.notEqual(f.codex.validateResult(jid), null); assert.equal(await readFile(join(f.cwd, 'source.txt'), 'utf8'), 'baseline\n');
});

test('a checked read cannot publish after private capture is lost even if its mutable descriptor still claims complete', async t => {
  const f = await fixture(t), jid = f.submit('capture-loss'); await f.checked(jid);
  assert.equal(f.codex.validateResult(jid), null); const capture = f.job(jid).capture;
  await rm(join(f.store.directory, 'execution-evidence', capture.artifactId, 'raw.ndjson'));
  f.store.transact(s => { const j = s.jobs.find(j => j.id === jid); j.capture = { ...capture, complete: true }; j.readCopy.status = 'checked'; });
  assert.equal(f.codex.validateResult(jid), 'execution_capture_integrity_changed');
  assert.equal((await f.trace()).filter(m => m.method === 'turn/start').length, 1);
});
