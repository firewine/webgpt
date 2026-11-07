import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ExecutionIsolation } from '../dist/server/execution/isolation.js';
import { approvalProviderConfig, proveApprovedCommand } from '../dist/server/execution/approval-probe.js';
import { startApprovalResponses } from '../dist/server/execution/approval-responses.js';
import { CodexExecutor } from '../dist/server/execution/codex.js';
import { Store } from '../dist/server/workspace/store.js';
import { until } from './workspace-helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

test('approval fake-provider config refuses every non-loopback or credential-bearing URL', () => {
  for (const url of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://127.0.0.1', 'http://user:pass@127.0.0.1:1234', 'http://example.invalid:1234', 'http://127.0.0.1:1234/?key=x']) assert.throws(() => approvalProviderConfig(url), /loopback_required/);
  assert.ok(approvalProviderConfig('http://127.0.0.1:1234/v1').some(v => v.includes('requires_openai_auth=false')));
});

test('native plain approval runs only the supplied synthetic command under its selected profile', { skip: !process.env.WJ_TEST_OUTER_BWRAP }, async t => {
  const base = await mkdtemp(join(homedir(), 'wj-native-approval-')), source = join(base, 'source'), state = join(base, 'state'), copy = join(state, 'copy'), auth = join(base, 'auth');
  for (const p of [source, state, copy, auth, join(state, 'probes')]) await mkdir(p, { recursive: true, mode: 0o700 });
  await writeFile(join(state, 'probes/empty.config.toml'), '', { mode: 0o400 });
  await writeFile(join(auth, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'FAKE-SYNTHETIC-NOT-A-KEY' }), { mode: 0o600 });
  await writeFile(join(copy, 'tracked'), 'SYNTHETIC-COPY');
  const previous = process.env.CODEX_HOME; process.env.CODEX_HOME = auth;
  t.after(async () => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; await rm(base, { recursive: true, force: true }); });
  const isolation = new ExecutionIsolation(['codex', 'app-server'], [state], join(state, 'probes'), process.env.WJ_TEST_OUTER_BWRAP);
  const binding = { repoRoot: source, cwd: source, allowWrite: false }, context = isolation.context(binding, copy);
  const result = await proveApprovedCommand({ command: 'cat tracked; printf APPROVED_SYNTHETIC_OK', cwd: source, profile: isolation.readProfileId,
    launch: url => isolation.wrap(source, source, copy, auth, [state], [context.cli, 'app-server', ...isolation.config(source, context.runtime, auth, [state], true), ...approvalProviderConfig(url)], true) });
  assert.equal(result.approvals, 1); assert.equal(result.exitCode, 0); assert.match(result.output, /SYNTHETIC-COPYAPPROVED_SYNTHETIC_OK/);
  assert.equal(await readFile(join(copy, 'tracked'), 'utf8'), 'SYNTHETIC-COPY');
});

test('native accepted read and write retain every combined containment boundary', { skip: !process.env.WJ_TEST_OUTER_BWRAP }, async t => {
  const base = await mkdtemp(join(homedir(), 'wj-approved-containment-')), source = join(base, 'source'), state = join(base, 'state'), copy = join(state, 'copy'), auth = join(base, 'auth');
  for (const p of [source, state, copy, auth]) await mkdir(p, { recursive: true, mode: 0o700 });
  const previous = process.env.CODEX_HOME; process.env.CODEX_HOME = auth;
  t.after(async () => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; await rm(base, { recursive: true, force: true }); });
  const isolation = new ExecutionIsolation(['codex', 'app-server'], [state], join(state, 'probes'), process.env.WJ_TEST_OUTER_BWRAP);
  await isolation.verifyApproval({ repoRoot: source, cwd: source, allowWrite: false }, copy);
});

for (const write of [false, true]) test(`native App Server completes a scoped ${write ? 'write/apply' : 'read'} controller approval with fake inference and real capture/copy checks`, { skip: !process.env.WJ_TEST_OUTER_BWRAP }, async t => {
  const base = await mkdtemp(join(homedir(), 'wj-native-scoped-')), source = join(base, 'source'), state = join(base, 'state'), auth = join(base, 'auth');
  for (const p of [source, state, auth]) await mkdir(p, { recursive: true, mode: 0o700 });
  const git = args => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=', ...args], { cwd: source, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'ignore' });
  git(['init', '-q', '-b', 'native-scoped']); await writeFile(join(source, 'source.txt'), 'BASELINE\n'); git(['add', 'source.txt']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic baseline']);
  await writeFile(join(auth, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'FAKE-SYNTHETIC-NOT-A-KEY' }), { mode: 0o600 });
  const previous = process.env.CODEX_HOME; process.env.CODEX_HOME = auth;
  const fixture = await startApprovalResponses({ cwd: source, command: (write ? "printf 'DRAFT_ONLY\\n' > source.txt; " : '') + 'cat source.txt; printf NATIVE_CONTROLLER_OK' });
  const store = new Store(state), codex = new CodexExecutor(store, ['codex', 'app-server'], [source], [state], { protectRead: true, scopedApprovals: true, outerBwrap: process.env.WJ_TEST_OUTER_BWRAP });
  t.after(async () => { codex.close(); store.close(); await fixture.close(); if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; await rm(base, { recursive: true, force: true }); });
  // Substitute only the inference transport; actual CLI, profiles, runtime pin,
  // native approval proof, journal, command, copy and capture remain real.
  const launch = codex.isolation.commandFor.bind(codex.isolation);
  codex.isolation.commandFor = (...args) => [...launch(...args), ...approvalProviderConfig(fixture.baseUrl)];
  const bindingId = await codex.register({ cwd: source, label: 'Synthetic native controller', sessionMode: 'new', allowWrite: write });
  const jobId = codex.submit({ bindingId, prompt: 'Local synthetic controller proof only.', requestId: 'native-scoped', maxDurationMs: 15000 });
  const job = () => store.read().jobs.find(j => j.id === jobId);
  await until(() => job()?.approvals[0]?.scope?.state === 'ready', 10000);
  const approval = job().approvals[0]; assert.equal(approval.scope.command.includes('cat source.txt'), true);
  const copyRoot = codex.workspaces.manifest(jobId).copyRoot;
  await codex.decide(jobId, approval.id, 'accept', { expectedScopeDigest: approval.scope.digest, ownerConfirmed: true, commandId: 'synthetic-native-owner-one' });
  await until(() => {
    const current = job();
    if (current.draft?.status === 'blocked' || current.readCopy?.status === 'blocked' || current.status === 'failed') {
      const dirs = [copyRoot, ...readdirSync(copyRoot, { recursive: true, withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(e.parentPath, e.name))].map(path => { const s = statSync(path); return { path, uid: s.uid, mode: (s.mode & 0o777).toString(8) }; });
      throw new Error(JSON.stringify({ status: current.status, error: current.error, draft: current.draft, readCopy: current.readCopy, dirs, uid: process.getuid(), capture: current.capture, activities: current.activities }));
    }
    return write ? current.draft?.status === 'pending' : current.readCopy?.status === 'checked';
  }, 10000);
  assert.equal(job().approvals[0].scope.state, 'sent'); assert.equal(job().capture.complete, true);
  const command = job().activities.find(a => a.command)?.command; assert.equal(command.exitCode, 0); assert.match(command.output, write ? /DRAFT_ONLY\nNATIVE_CONTROLLER_OK/ : /BASELINE\nNATIVE_CONTROLLER_OK/);
  assert.equal(fixture.requests.length, 2); assert.equal(await readFile(join(source, 'source.txt'), 'utf8'), 'BASELINE\n');
  if (write) {
    const diff = await codex.inspectDraft(jobId); assert.equal(diff.files.length, 1); assert.equal(diff.files[0].path, 'source.txt');
    const receipt = await codex.applyDraft(jobId, diff.diffDigest, 'synthetic-native-apply-one'); assert.equal(receipt.path, 'source.txt');
    assert.equal(await readFile(join(source, 'source.txt'), 'utf8'), 'DRAFT_ONLY\n');
  }
  assert.equal(codex.validateResult(jobId), null);
});
