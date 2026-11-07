import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Store } from '../dist/server/workspace/store.js';
import { CodexExecutor } from '../dist/server/execution/codex.js';
// Synthetic only: no model or user-session fixture. Build before standalone use.
import { ExecutionIsolation } from '../dist/server/execution/isolation.js';
import { isolationEnvironment, outerIdentity } from '../dist/server/execution/outer-bwrap.js';
const run = promisify(execFile);
const sh = s => `'${s.replaceAll("'", "'\\''")}'`;
const available = name => (process.env.PATH ?? '').split(':').filter(Boolean).some(p => existsSync(join(p, name)));
const namespaceErrors = new Set([
  'bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.',
  'bwrap: Creating new namespace failed: Operation not permitted',
  'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted',
]);
const namespaceUnavailable = (status, stdout, stderr) => status === 1 && !stdout.includes('ISOLATION_TOOL_STARTED\n') && stderr.split(/\r?\n/).some(line => namespaceErrors.has(line));
async function fixture(t, command = ['codex', 'app-server']) {
  const base = await mkdtemp(join(homedir(), 'wj-isolation-test-'));
  const source = join(base, 'source'), state = join(base, 'state'), copy = join(state, 'job', 'copy'), auth = join(base, '.codex'), chrome = join(base, 'chrome');
  for (const p of [join(source, 'sub'), join(copy, 'sub'), auth, chrome, join(state, 'probes')]) await mkdir(p, { recursive: true, mode: 0o700 });
  await writeFile(join(state, 'probes', 'empty.config.toml'), '', { mode: 0o400 });
  for (const p of [join(source, '.env'), join(source, 'tracked'), join(auth, 'auth.json'), join(state, 'secret'), join(chrome, 'secret')]) await writeFile(p, 'FAKE');
  await writeFile(join(copy, 'tracked'), 'COPY');
  await writeFile(join(auth, 'config.toml'), 'default_permissions=":danger-full-access"\n');
  const previous = process.env.CODEX_HOME; process.env.CODEX_HOME = auth;
  t.after(async () => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; await rm(base, { recursive: true, force: true }); });
  return { base, source, state, copy, auth, chrome, binding: { repoRoot: source, cwd: join(source, 'sub') },
    isolation: new ExecutionIsolation(command, [state, chrome], join(state, 'probes'), process.env.WJ_TEST_OUTER_BWRAP) };
}
test('outer helper rejects caller-selected paths and inherits no loader/preload environment', async t => {
  const f = await fixture(t); const path = join(f.base, 'bwrap');
  await symlink('/usr/bin/bwrap', path);
  for (const p of [path, '/usr/bin/bwrap', '/tmp/bwrap', 'bwrap']) assert.throws(() => outerIdentity(p), /outer_fixed_path_required/);
  const iso = new ExecutionIsolation(['codex', 'app-server'], [f.state], join(f.state, 'probes'), path);
  await assert.rejects(iso.verify(f.binding, f.copy), /outer_fixed_path_required/);
  assert.throws(() => iso.commandFor(f.binding, f.copy), /verify_copy_required/);
  assert.deepEqual(isolationEnvironment(), { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });
  assert.ok(iso.config(f.source, '/usr/bin', f.auth).some(arg => arg.includes('PATH="/usr/bin:/bin:')));
});
test('requires canonical, separate private copies and refuses an unverified launch', async t => {
  const f = await fixture(t);
  assert.equal(f.isolation.profileId, 'webjjoku_copy');
  assert.throws(() => f.isolation.commandFor(f.binding, f.copy), /verify_copy_required/);
  await assert.rejects(f.isolation.verify({ ...f.binding, cwd: f.base }, f.copy), /cwd_outside_repository/);
  await assert.rejects(f.isolation.verify(f.binding, f.source), /private_copy_required/);
  await symlink(f.copy, join(f.base, 'alias'));
  await assert.rejects(f.isolation.verify(f.binding, join(f.base, 'alias')), /canonical_directory_required/);
  await rm(join(f.copy, 'sub'), { recursive: true }); await symlink(f.source, join(f.copy, 'sub'));
  await assert.rejects(f.isolation.verify(f.binding, f.copy), /canonical_directory_required/);
  assert.equal(await readFile(join(f.source, 'tracked'), 'utf8'), 'FAKE');
});
test('real App Server can register a new protected-read session without any model turn', { skip: !process.env.WJ_TEST_OUTER_BWRAP }, async t => {
  const f = await fixture(t); const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = args => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=', ...args], { cwd: f.source, env });
  git(['init', '-q', '-b', 'r6-preflight']); git(['add', 'tracked']);
  git(['-c', 'user.name=R6 Fixture', '-c', 'user.email=r6@example.invalid', 'commit', '-qm', 'synthetic baseline']);
  const store = new Store(f.state), ex = new CodexExecutor(store, ['codex', 'app-server'], [f.source], [f.state, f.chrome], { protectRead: true, outerBwrap: process.env.WJ_TEST_OUTER_BWRAP });
  try {
    const id = await ex.register({ sessionMode: 'new', label: 'No-model preflight', cwd: f.source, expiresInHours: 1 });
    const binding = store.read().bindings.find(b => b.id === id);
    assert.equal(binding.readProtection, 1); assert.equal(binding.managedSession.state, 'initial'); assert.equal(binding.status, 'ready');
    assert.equal(store.read().jobs.length, 0); await ex.revokeBinding(id);
  } finally { ex.close(); store.close(); }
});
test('does not create probe directories through symlinks or in the original repository', async t => {
  const f = await fixture(t); await symlink(f.source, join(f.base, 'redirect'));
  for (const directory of [join(f.source, 'probes'), join(f.base, 'redirect', 'probes')]) {
    const iso = new ExecutionIsolation(['codex', 'app-server'], [f.state], directory);
    await assert.rejects(iso.verify(f.binding, f.copy), /private_directory_overlap|canonical_directory_required/);
  }
  await assert.rejects(readFile(join(f.source, 'probes')), { code: 'ENOENT' });
});
for (const version of ['0.165.0', '0.999.0']) test(`version ${version} without named profile support fails closed`, async t => {
  if (!available('bwrap')) return t.skip('bubblewrap is not installed; no host capability proof is possible');
  const f = await fixture(t); const bin = join(f.base, 'bin'); await mkdir(bin);
  const cli = join(bin, 'codex'); const trace = join(f.base, 'calls');
  await writeFile(cli, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${sh(trace)}\ncase "$*" in\n--version) printf 'codex-cli ${version}\\n';;\n'sandbox --help') printf 'legacy sandbox help\\n';;\n*) exit 91;;\nesac\n`, { mode: 0o700 });
  const iso = new ExecutionIsolation([cli, 'app-server'], [f.state], join(f.state, 'probes'));
  await assert.rejects(iso.verify(f.binding, f.copy), /named_profiles_unsupported/);
  assert.equal(await readFile(trace, 'utf8'), '--version\nsandbox --help\n');
  assert.throws(() => iso.commandFor(f.binding, f.copy), /verify_copy_required/);
});
test('outer namespace proves copy alias, late-file exclusion, masked state and trusted auth separation, or reports unavailable', async t => {
  if (!available('bwrap')) return t.skip('bubblewrap is not installed');
  const f = await fixture(t);
  const script = `set -eu\n[ "$PWD" = ${sh(f.binding.cwd)} ]\n[ ! -e ../.env ]\n[ ! -e ${sh(join(f.state, 'secret'))} ]\n[ ! -e ${sh(join(f.chrome, 'secret'))} ]\n[ "$(cat ${sh(join(f.auth, 'auth.json'))})" = FAKE ]\nprintf LOG > ${sh(join(f.auth, 'log'))}\nif /bin/cat ${sh(`/proc/${process.pid}/root${f.auth}/auth.json`)} >/dev/null 2>&1; then exit 91; fi\nif (printf BAD > ${sh(join(f.base, 'root-write'))}) 2>/dev/null; then exit 90; fi\nprintf READY\\n\nread -r release\n[ ! -e ../late-secret ]\nprintf CHANGED > ../tracked\nprintf NEW > new\nprintf OK`;
  const argv = f.isolation.wrap(f.source, f.binding.cwd, f.copy, f.auth, [f.state, f.chrome], ['/bin/sh', '-c', `printf 'ISOLATION_TOOL_STARTED\\n'\n${script}`]);
  let out = '', err = '', changed = false;
  const status = await new Promise((ok, fail) => {
    const p = spawn(argv[0], argv.slice(1), { env: {}, stdio: 'pipe' }); const timeout = setTimeout(() => p.kill('SIGKILL'), 15_000);
    p.on('error', fail); p.stderr.on('data', d => { err += d; }); p.stdin.on('error', () => {});
    p.stdout.on('data', d => { out += d; if (!changed && out.includes('READY')) { changed = true; void writeFile(join(f.source, 'late-secret'), 'FAKE-LATE').then(() => p.stdin.end('go\n'), fail); } });
    p.on('close', code => { clearTimeout(timeout); ok(code); });
  });
  if (namespaceUnavailable(status, out, err)) return t.skip(`Outer namespace unavailable; no containment proof: ${err.trim()}`);
  assert.equal(status, 0, err); assert.equal(out.endsWith('OK'), true);
  assert.equal(await readFile(join(f.source, 'tracked'), 'utf8'), 'FAKE');
  assert.equal(await readFile(join(f.copy, 'tracked'), 'utf8'), 'CHANGED');
  assert.equal(await readFile(join(f.copy, 'sub', 'new'), 'utf8'), 'NEW');
  assert.equal(await readFile(join(f.auth, 'log'), 'utf8'), 'LOG');
});
test('actual named profile confines persistent writes and denies secret reads/tmp/network, or reports unavailable', async t => {
  if (!available('codex') || !available('bwrap')) return t.skip('Real Codex and bubblewrap are required; no profile containment proof');
  const f = await fixture(t); const c = f.isolation.context(f.binding, f.copy);
  // The profile grants the original alias, never the physical copy under denied state.
  const alias = join(f.base, 'synthetic-alias'); await mkdir(join(alias, 'sub'), { recursive: true }); await writeFile(join(alias, 'tracked'), 'COPY');
  const server = createServer(s => { s.destroy(); }); let connections = 0; server.on('connection', () => connections++);
  try { await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); }); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) return t.skip('Host forbids the synthetic network listener; no profile containment proof'); throw e; }
  t.after(() => new Promise(ok => server.close(ok)));
  const port = server.address().port;
  const forbidden = [join(f.source, '.env'), join(f.state, 'secret'), join(f.auth, 'auth.json'), join(f.chrome, 'secret')];
  const checks = forbidden.map((p, i) => `if /bin/cat ${sh(p)} >/dev/null 2>&1; then printf LEAK_${i}; exit 81; fi\n(printf BAD >> ${sh(p)}) 2>/dev/null || :`).join('\n');
  const script = `printf 'ISOLATION_TOOL_STARTED\\n'\nset -eu\n[ "$(/bin/cat ../tracked)" = COPY ]\nprintf TOOL-EDIT > ../tracked\nprintf NEW > new\n${checks}\nif /bin/ls /tmp >/dev/null 2>&1 || (printf BAD > /tmp/wj-isolation-test) 2>/dev/null; then exit 82; fi\n/bin/bash -c 'exit 0'\n${sh(process.execPath)} -e 'if (process.versions.node !== ${JSON.stringify(process.versions.node)}) process.exit(87)'\nif /bin/bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}' 2>/dev/null; then exit 84; fi\nprintf PROFILE_OK`;
  let result;
  try { result = await run(c.cli, ['sandbox', '--include-managed-config', '-P', f.isolation.profileId, '-C', join(alias, 'sub'), ...f.isolation.config(alias, c.runtime, f.auth), '--', '/bin/sh', '-c', script], { env: { PATH: process.env.PATH, HOME: f.base, CODEX_HOME: f.auth }, cwd: f.base, timeout: 20_000 }); }
  catch (e) { if (namespaceUnavailable(e.code, e.stdout ?? '', e.stderr ?? '')) return t.skip(`CLI namespace unavailable; no profile containment proof: ${e.stderr.trim()}`); throw e; }
  assert.equal(result.stdout, 'ISOLATION_TOOL_STARTED\nPROFILE_OK'); assert.equal(connections, 0);
  for (const p of forbidden.slice(0, 4)) assert.equal(await readFile(p, 'utf8'), 'FAKE');
  assert.equal(await readFile(join(alias, 'tracked'), 'utf8'), 'TOOL-EDIT');
});
test('namespace wording never turns a canary failure or CLI panic into an environment skip', async t => {
  const f = await fixture(t); const message = [...namespaceErrors][0];
  for (const [stdout, stderr, exit] of [
    ['', `${message}\n`, 81], ['ISOLATION_TOOL_STARTED\n', `${message}\n`, 1],
    ['', `canary: ${message}\n`, 1], ['', 'filesystem-restricted execution requires bubblewrap to isolate app-server sockets\n', 101],
  ]) {
    await assert.rejects(f.isolation.runProbe(['/bin/sh', '-c', `printf %s ${sh(stdout)}; printf %s ${sh(stderr)} >&2; exit ${exit}`], f.base, async () => {}), new RegExp(`profile_canary_probe_failed_${exit}$`));
  }
  assert.throws(() => f.isolation.commandFor(f.binding, f.copy), /verify_copy_required/);
});
test('full runtime proof is mandatory; no successful version/schema-only fallback', async t => {
  if (!available('codex') || !available('bwrap')) return t.skip('Real Codex and bubblewrap are required; WRITE remains unverified');
  const f = await fixture(t);
  try { await f.isolation.verify(f.binding, f.copy); }
  catch (e) {
    assert.match(e.message, /^execution_isolation_unverified: host_(namespace|network_probe)_unavailable$/, String(e.cause?.message ?? ''));
    assert.throws(() => f.isolation.commandFor(f.binding, f.copy), /verify_copy_required/);
    return t.skip(`No positive runtime proof; WRITE remains blocked: ${e.message}`);
  }
  const argv = f.isolation.commandFor(f.binding, f.copy);
  assert.ok(argv.includes('--ro-bind')); assert.ok(argv.includes('--unshare-pid'));
  assert.ok(argv.includes('default_permissions="webjjoku_copy"')); assert.equal(argv.some(a => /sandboxPolicy/.test(a)), false);
  const readBinding = { ...f.binding, allowWrite: false };
  assert.throws(() => f.isolation.commandFor(readBinding, f.copy), /verify_copy_required/);
  await f.isolation.verify(readBinding, f.copy);
  const readArgs = f.isolation.commandFor(readBinding, f.copy);
  assert.ok(readArgs.includes('default_permissions="webjjoku_read"'));
  const alias = readArgs.indexOf(f.copy); assert.equal(readArgs[alias - 1], '--ro-bind');
  // Reconnect uses the same modified copy; it never prepares or replays source.
  await writeFile(join(f.copy, 'continued'), 'CONTINUE');
  assert.deepEqual(f.isolation.commandFor(f.binding, f.copy), argv);
  await f.isolation.verify(f.binding, f.copy);
  assert.equal(await readFile(join(f.copy, 'continued'), 'utf8'), 'CONTINUE');
});

test('npm native Codex package is readable without granting its parent dependencies or unrelated secrets', async t => {
  const f = await fixture(t); const packages = join(f.base, 'packages', '@openai');
  const runtime = join(packages, 'codex'); const nativeName = process.arch === 'arm64' ? 'codex-linux-arm64' : 'codex-linux-x64'; const native = join(packages, nativeName);
  await mkdir(runtime, { recursive: true }); await mkdir(native, { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: '@openai/codex', version: 'fixture' }));
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: '@openai/' + nativeName, version: 'fixture' }));
  // npm resolution walks node_modules, even when the wrapper and native package are siblings.
  const modules = join(f.base, 'packages', 'node_modules', '@openai'); await mkdir(modules, { recursive: true });
  await symlink(native, join(modules, nativeName));
  const args = f.isolation.config(f.source, runtime, f.auth); const permissions = args.find(a => a.startsWith('permissions='));
  assert.ok(permissions.includes(JSON.stringify(native) + '="read"'));
  assert.ok(permissions.includes(JSON.stringify(runtime) + '="read"'));
  assert.ok(!permissions.includes(JSON.stringify(packages) + '="read"'));
  assert.ok(permissions.includes(JSON.stringify(f.auth) + '="deny"'));
  assert.ok(permissions.includes(JSON.stringify(f.state) + '="deny"'));
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: '@openai/codex', version: 'fixture-linux-' + process.arch, os: ['linux'], cpu: [process.arch] }));
  assert.ok(f.isolation.config(f.source, runtime, f.auth).some(a => a.includes(JSON.stringify(native) + '="read"')));
  await mkdir(join(runtime, 'vendor')); await writeFile(join(native, 'package.json'), JSON.stringify({ name: 'wrong-package' }));
  assert.throws(() => f.isolation.config(f.source, runtime, f.auth), /native_package_identity/);
});
