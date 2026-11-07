import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, rename, symlink, link, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { ProtectedWorkspaces } from '../dist/server/execution/workspace-protection.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const matches = code => error => error.code === 'protected_workspace_' + code;
const initial = 'export const value = 1;\n';
const changed = 'export const value = 2;\n';

// Git runs only against fresh synthetic repositories. Neither fixture setup nor
// the implementation uses a user config, real account, source repo or model.
async function fixture(t, files = { 'README.md': 'Synthetic fixture\n', 'src/one.ts': initial }) {
  const directory = await mkdtemp(join(tmpdir(), 'protected-workspace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'), storage = join(directory, 'private'), outside = join(directory, 'outside');
  await mkdir(source); await mkdir(outside);
  const git = (...args) => {
    const output = join(directory, 'git-output'), fd = fs.openSync(output, 'w');
    try {
      execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'init.templateDir=', '-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
        cwd: source, stdio: ['ignore', fd, fd], env: { PATH: '/usr/bin:/bin', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      });
      return fs.readFileSync(output, 'utf8').trim();
    } finally { fs.closeSync(fd); }
  };
  git('init', '--quiet', '--initial-branch', 'fixture-work');
  for (const [path, bytes] of Object.entries(files)) { await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), bytes); }
  git('add', '--all'); git('commit', '--quiet', '-m', 'Synthetic baseline');
  const binding = { repoRoot: source, cwd: source, branch: 'fixture-work', head: git('rev-parse', 'HEAD') };
  const protection = new ProtectedWorkspaces(storage);
  return { directory, source, storage, outside, git, binding, protection };
}
async function ready(t, files) {
  const f = await fixture(t, files), manifest = await f.protection.prepare('job-a', f.binding);
  await writeFile(join(manifest.copyRoot, 'src/one.ts'), changed);
  const draft = await f.protection.inspect('job-a'); assert.equal(draft.status, 'ready');
  return { ...f, manifest, draft };
}
function interceptRead(t, target, mutate) {
  const original = fs.readSync; let triggered = false;
  const mock = t.mock.method(fs, 'readSync', function (fd, ...args) {
    const n = original.call(this, fd, ...args);
    if (!triggered && fs.readlinkSync('/proc/self/fd/' + fd) === target) { triggered = true; mutate(fd); }
    return n;
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  return () => triggered;
}
function interceptWrite(t, target, mutate) {
  const original = fs.writeSync; let triggered = false;
  const mock = t.mock.method(fs, 'writeSync', function (fd, ...args) {
    const n = original.call(this, fd, ...args);
    if (!triggered && fs.readlinkSync('/proc/self/fd/' + fd) === target) { triggered = true; mutate(fd); }
    return n;
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  return () => triggered;
}

test('prepares a private bounded text tree with persistent authenticated manifest and isolated baseline', async t => {
  const f = await fixture(t, {
    'README.md': 'Synthetic fixture\n', 'src/one.ts': initial, 'image.bin': Buffer.from([0, 255, 1]),
    '.env': 'FAKE_ONLY=secret\n', '.env.production': 'FAKE_ONLY=secret\n', 'secrets/fixture.txt': 'secret\n',
    'credentials.json': '{"fake":"secret"}\n', '.ssh/id_ed25519': 'fake key\n', '.codex/config.toml': 'fake=true\n',
    '.npmrc': '//example.invalid/:_authToken=fake\n', '.gitconfig': '[alias]\nfixture = !false\n',
  });
  await writeFile(join(f.source, 'untracked.txt'), 'untracked private material\n');
  await symlink(f.outside, join(f.source, 'node_modules'));
  const m = await f.protection.prepare('job-a', f.binding);
  assert.equal(m.version, 1); assert.equal(m.sourceRoot, f.source); assert.equal(m.sourceCwd, f.source);
  assert.equal(m.branch, f.binding.branch); assert.equal(m.head, f.binding.head);
  assert.deepEqual(m.files.map(x => x.path), ['README.md', 'src/one.ts']);
  assert.equal((await stat(m.copyRoot)).mode & 0o777, 0o700);
  assert.deepEqual((await readdir(m.copyRoot)).sort(), ['README.md', 'src']);
  const baseline = m.files.find(x => x.path === 'src/one.ts'), original = await stat(join(f.source, baseline.path), { bigint: true });
  assert.equal(baseline.digest, digest(initial)); assert.equal(baseline.size, Buffer.byteLength(initial));
  assert.equal(baseline.dev, original.dev.toString()); assert.equal(baseline.ino, original.ino.toString());
  assert.notEqual((await stat(join(m.copyRoot, baseline.path), { bigint: true })).ino, original.ino);
  const { digest: manifestDigest, ...unsigned } = m; assert.equal(manifestDigest, digest(JSON.stringify(unsigned)));
  m.files[0].digest = 'caller mutation';
  const recovered = new ProtectedWorkspaces(f.storage).manifest('job-a'); assert.notEqual(recovered.files[0].digest, 'caller mutation');
  assert.equal((await f.protection.inspect('job-a')).status, 'unchanged');
  await assert.rejects(f.protection.prepare('job-a', f.binding));
});

test('one existing UTF8 content change yields stable actual diff and a working copy cwd', async t => {
  const f = await fixture(t); f.binding.cwd = join(f.source, 'src');
  const m = await f.protection.prepare('job-a', f.binding); assert.equal(m.copyCwd, join(m.copyRoot, 'src'));
  await writeFile(join(m.copyRoot, 'src/one.ts'), '한글\nconst value = 2;');
  const d = await f.protection.inspect('job-a'); assert.equal(d.status, 'ready'); assert.equal(d.reason, null);
  assert.equal(d.manifestDigest, m.digest); assert.match(d.diffDigest, /^[a-f0-9]{64}$/); assert.equal(d.files.length, 1);
  assert.equal(d.files[0].path, 'src/one.ts'); assert.equal(d.files[0].beforeDigest, digest(initial));
  assert.equal(d.files[0].afterDigest, digest('한글\nconst value = 2;')); assert.equal(d.files[0].before, initial);
  assert.match(d.files[0].diff, /^--- a\/src\/one.ts\n\+\+\+ b\/src\/one.ts/); assert.match(d.files[0].diff, /No newline at end of file/);
  assert.deepEqual(await f.protection.inspect('job-a'), d); assert.equal(await readFile(join(f.source, 'src/one.ts'), 'utf8'), initial);
});

test('applies exactly one approved file, preserves inode/mode and source secrets/untracked, rejects replay after restart', async t => {
  const f = await ready(t), path = join(f.source, 'src/one.ts'), before = await stat(path, { bigint: true });
  await writeFile(join(f.source, '.env.late'), 'FAKE_ONLY=late secret\n');
  await writeFile(join(f.source, 'untracked.txt'), 'untracked private material\n');
  const order = []; let authorized = false;
  const actualWrite = fs.writeSync;
  const mock = t.mock.method(fs, 'writeSync', function (fd, ...args) {
    if (fs.readlinkSync('/proc/self/fd/' + fd) === path) { assert.equal(authorized, true); order.push('write'); }
    return actualWrite.call(this, fd, ...args);
  }); syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const receipt = await f.protection.apply('job-a', f.draft.diffDigest, () => {
    assert.equal(fs.readFileSync(path, 'utf8'), initial);
    assert.ok(fs.existsSync(join(dirname(f.manifest.copyRoot), 'apply-intent.json'))); order.push('guard'); authorized = true;
  });
  assert.deepEqual(order, ['guard', 'write']);
  assert.deepEqual({ ...receipt, appliedAt: '<time>' }, { path: 'src/one.ts', beforeDigest: digest(initial), afterDigest: digest(changed), appliedAt: '<time>' });
  assert.ok(Number.isFinite(Date.parse(receipt.appliedAt))); assert.equal(await readFile(path, 'utf8'), changed);
  const after = await stat(path, { bigint: true }); assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode);
  assert.equal(await readFile(join(f.source, '.env.late'), 'utf8'), 'FAKE_ONLY=late secret\n');
  assert.equal(await readFile(join(f.source, 'untracked.txt'), 'utf8'), 'untracked private material\n');
  assert.equal(await readFile(join(f.source, 'README.md'), 'utf8'), 'Synthetic fixture\n');
  const restarted = new ProtectedWorkspaces(f.storage);
  await assert.rejects(restarted.apply('job-a', f.draft.diffDigest), matches('apply_already_attempted'));
  assert.equal((await restarted.inspect('job-a')).status, 'blocked');
  assert.equal(f.git('rev-parse', 'HEAD'), f.binding.head);
});

test('handles shrinking and empty replacements without leaving old bytes', async t => {
  for (const after of ['x', '']) {
    const f = await ready(t); await writeFile(join(f.manifest.copyRoot, 'src/one.ts'), after);
    const d = await f.protection.inspect('job-a'); await f.protection.apply('job-a', d.diffDigest);
    assert.equal(await readFile(join(f.source, 'src/one.ts'), 'utf8'), after);
  }
});

test('stale, foreign-job and changed-since-inspection diff digests cannot apply', async t => {
  const f = await ready(t); await assert.rejects(f.protection.apply('job-a', '0'.repeat(64)), matches('stale_diff'));
  const other = await f.protection.prepare('job-b', f.binding); await writeFile(join(other.copyRoot, 'src/one.ts'), changed);
  await assert.rejects(f.protection.apply('job-b', f.draft.diffDigest), matches('stale_diff'));
  await writeFile(join(f.manifest.copyRoot, 'src/one.ts'), 'export const value = 3;\n');
  await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest), matches('stale_diff'));
  assert.equal(await readFile(join(f.source, 'src/one.ts'), 'utf8'), initial);
});

test('synchronous guard revocation and accidentally asynchronous guards cause zero source writes', async t => {
  for (const guard of [() => { throw Object.assign(Error('revoked'), { code: 'guard_revoked' }); }, async () => {}]) {
    const f = await ready(t), path = join(f.source, 'src/one.ts'); let writes = 0;
    const triggered = interceptWrite(t, path, () => { writes++; });
    await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest, guard));
    assert.equal(triggered(), false); assert.equal(writes, 0); assert.equal(await readFile(path, 'utf8'), initial);
    await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest), matches('apply_already_attempted'));
  }
});

test('new/deleted/renamed/multiple/binary/chmod/empty-directory changes all block inspection and application', async t => {
  const mutations = [
    m => writeFile(join(m.copyRoot, 'new.txt'), 'new\n'),
    m => rm(join(m.copyRoot, 'src/one.ts')),
    m => rename(join(m.copyRoot, 'src/one.ts'), join(m.copyRoot, 'src/renamed.ts')),
    async m => { await writeFile(join(m.copyRoot, 'src/one.ts'), changed); await writeFile(join(m.copyRoot, 'README.md'), 'second\n'); },
    m => writeFile(join(m.copyRoot, 'src/one.ts'), Buffer.from([0xc0, 0xaf])),
    m => writeFile(join(m.copyRoot, 'src/one.ts'), Buffer.from([0])),
    m => chmod(join(m.copyRoot, 'src/one.ts'), 0o755),
    m => chmod(join(m.copyRoot, 'src'), 0o500),
    m => mkdir(join(m.copyRoot, 'new-directory')),
    m => writeFile(join(m.copyRoot, '.env.new'), 'FAKE_ONLY=new\n'),
  ];
  for (const mutate of mutations) {
    const f = await fixture(t), m = await f.protection.prepare('job-a', f.binding); await mutate(m);
    const d = await f.protection.inspect('job-a'); assert.equal(d.status, 'blocked'); assert.ok(d.reason);
    await assert.rejects(f.protection.apply('job-a', d.diffDigest)); assert.equal(await readFile(join(f.source, 'src/one.ts'), 'utf8'), initial);
    await chmod(join(m.copyRoot, 'src'), 0o700);
  }
});

test('rejects source hardlinks, symlinks, directory aliases and root aliases', async t => {
  const mutations = [
    async f => { await link(join(f.source, 'src/one.ts'), join(f.outside, 'alias')); },
    async f => { await rm(join(f.source, 'src/one.ts')); await writeFile(join(f.outside, 'target'), initial); await symlink(join(f.outside, 'target'), join(f.source, 'src/one.ts')); },
    async f => { await rename(join(f.source, 'src'), join(f.outside, 'src')); await symlink(join(f.outside, 'src'), join(f.source, 'src')); },
    async f => { const alias = join(f.directory, 'alias'); await symlink(f.source, alias); f.binding.repoRoot = alias; f.binding.cwd = alias; },
  ];
  for (const mutate of mutations) { const f = await fixture(t); await mutate(f); await assert.rejects(f.protection.prepare('job-a', f.binding)); }
});

test('rejects source/private overlaps, protected cwd, path aliases and path-like job IDs', async t => {
  const f = await fixture(t);
  for (const job of ['../escape', '/absolute', '.', 'job/a', 'a\0b']) await assert.rejects(f.protection.prepare(job, f.binding), matches('job_id_invalid'));
  await assert.rejects(f.protection.prepare('alias', { ...f.binding, repoRoot: f.source + '/.', cwd: f.source }), matches('canonical_path_required'));
  await mkdir(join(f.source, '.env.directory'));
  await assert.rejects(f.protection.prepare('protected', { ...f.binding, cwd: join(f.source, '.env.directory') }), matches('protected_path'));
  const nested = new ProtectedWorkspaces(join(f.source, 'private'));
  await assert.rejects(nested.prepare('overlap', f.binding), matches('source_root_protected_or_overlapping'));
  await assert.rejects(f.protection.prepare('parent', { ...f.binding, repoRoot: f.directory, cwd: f.source }), matches('source_root_protected_or_overlapping'));
  const publicDirectory = join(f.directory, 'public'); await mkdir(publicDirectory, { mode: 0o755 });
  assert.throws(() => new ProtectedWorkspaces(publicDirectory), matches('private_directory_required'));
});

test('Git hooks, fsmonitor, includes, submodules and linked worktree metadata cannot run or escape', async t => {
  const f = await fixture(t), marker = join(f.outside, 'hook-ran');
  await mkdir(join(f.source, '.git/hooks'), { recursive: true });
  await writeFile(join(f.source, '.git/hooks/post-checkout'), '#!/bin/sh\ntouch ' + marker + '\n', { mode: 0o755 });
  await f.protection.prepare('hooks', f.binding); assert.equal(fs.existsSync(marker), false);
  const config = await readFile(join(f.source, '.git/config'), 'utf8');
  for (const extra of ['\n[core]\nfsmonitor = !touch ' + marker + '\n', '\n[include]\npath = ' + join(f.outside, 'not-read') + '\n']) {
    await writeFile(join(f.source, '.git/config'), config + extra);
    await assert.rejects(f.protection.prepare('config-' + digest(extra), f.binding), matches('unsafe_git_configuration')); assert.equal(fs.existsSync(marker), false);
  }
  await writeFile(join(f.source, '.git/config'), config);
  await writeFile(join(f.source, '.gitmodules'), '[submodule "fake"]\npath=vendor/fake\n'); f.git('add', '.gitmodules');
  await assert.rejects(f.protection.prepare('submodule', f.binding), matches('submodule_unsupported'));
  await rename(join(f.source, '.git'), join(f.outside, 'git'));
  await writeFile(join(f.source, '.git'), 'gitdir: ' + join(f.outside, 'git') + '\n');
  await assert.rejects(f.protection.prepare('gitdir', f.binding));
});

test('changed source content, inode, permissions, branch and HEAD invalidate application', async t => {
  const mutations = [
    f => writeFile(join(f.source, 'src/one.ts'), 'concurrent author\n'),
    async f => { await rm(join(f.source, 'src/one.ts')); await writeFile(join(f.source, 'src/one.ts'), initial); },
    f => chmod(join(f.source, 'src/one.ts'), 0o755),
    async f => { f.git('switch', '--quiet', '-c', 'another-branch'); },
    async f => { await writeFile(join(f.source, 'other.txt'), 'new commit\n'); f.git('add', 'other.txt'); f.git('commit', '--quiet', '-m', 'Different head'); },
  ];
  for (const mutate of mutations) {
    const f = await ready(t); await mutate(f); const prior = await readFile(join(f.source, 'src/one.ts')); let called = false;
    await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest, () => { called = true; })); assert.equal(called, false);
    assert.deepEqual(await readFile(join(f.source, 'src/one.ts')), prior);
  }
});

test('replaced source root or parent and source/copy link swaps leave outside content untouched', async t => {
  for (const kind of ['root', 'parent', 'source-link', 'copy-link', 'copy-hardlink']) {
    const f = await ready(t); await mkdir(join(f.outside, 'src')); await writeFile(join(f.outside, 'src/one.ts'), 'outside sentinel\n');
    if (kind === 'root') { await rename(f.source, join(f.directory, 'moved-source')); await symlink(f.outside, f.source); }
    if (kind === 'parent') { await rename(join(f.source, 'src'), join(f.directory, 'moved-src')); await symlink(join(f.outside, 'src'), join(f.source, 'src')); }
    if (kind === 'source-link') { await rm(join(f.source, 'src/one.ts')); await symlink(join(f.outside, 'src/one.ts'), join(f.source, 'src/one.ts')); }
    if (kind === 'copy-link') { await rm(join(f.manifest.copyRoot, 'src/one.ts')); await symlink(join(f.outside, 'src/one.ts'), join(f.manifest.copyRoot, 'src/one.ts')); }
    if (kind === 'copy-hardlink') { await rm(join(f.manifest.copyRoot, 'src/one.ts')); await link(join(f.outside, 'src/one.ts'), join(f.manifest.copyRoot, 'src/one.ts')); }
    await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest)); assert.equal(await readFile(join(f.outside, 'src/one.ts'), 'utf8'), 'outside sentinel\n');
  }
});

test('private manifest, immutable baseline, key and storage directory substitutions fail closed', async t => {
  for (const kind of ['manifest', 'baseline', 'key', 'tree', 'storage']) {
    const f = await ready(t), job = dirname(f.manifest.copyRoot);
    if (kind === 'manifest') {
      const path = join(job, 'manifest.json'), data = JSON.parse(await readFile(path, 'utf8'));
      data.body.manifest.files[0].digest = '0'.repeat(64); const { digest: _digest, ...unsigned } = data.body.manifest;
      data.body.manifest.digest = digest(JSON.stringify(unsigned)); await writeFile(path, JSON.stringify(data));
    }
    if (kind === 'baseline') { const path = join(job, 'baseline', digest('src/one.ts')); await chmod(path, 0o600); await writeFile(path, 'forged baseline\n'); await chmod(path, 0o400); }
    if (kind === 'key') { await rm(join(f.storage, 'seal.key')); await symlink(join(f.outside, 'key'), join(f.storage, 'seal.key')); }
    if (kind === 'tree') { await rename(f.manifest.copyRoot, join(job, 'saved-tree')); await symlink(f.outside, f.manifest.copyRoot); }
    if (kind === 'storage') { await rename(f.storage, join(f.directory, 'saved-private')); await symlink(join(f.directory, 'saved-private'), f.storage); }
    assert.equal((await f.protection.inspect('job-a')).status, 'blocked'); await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest));
    assert.equal(await readFile(join(f.source, 'src/one.ts'), 'utf8'), initial);
  }
});

test('mutating a source descriptor during capture never produces a valid manifest', async t => {
  const f = await fixture(t), path = join(f.source, 'src/one.ts');
  const triggered = interceptRead(t, path, () => fs.writeFileSync(path, 'source changed during read\n'));
  await assert.rejects(f.protection.prepare('job-a', f.binding)); assert.equal(triggered(), true);
  assert.throws(() => f.protection.manifest('job-a'));
});

test('descriptor substitution during capture is detected before any manifest can be published', async t => {
  const f = await fixture(t), path = join(f.source, 'src/one.ts'), outside = join(f.outside, 'sentinel');
  await writeFile(outside, 'outside sentinel\n');
  const triggered = interceptRead(t, path, fd => { fs.closeSync(fd); assert.equal(fs.openSync(outside, 'r'), fd); });
  await assert.rejects(f.protection.prepare('job-a', f.binding)); assert.equal(triggered(), true);
  assert.throws(() => f.protection.manifest('job-a')); assert.equal(await readFile(outside, 'utf8'), 'outside sentinel\n');
});

test('private tree substitution during preparation cannot publish a usable path or write outside storage', async t => {
  const f = await fixture(t), job = join(f.storage, 'job-' + digest('job-a')), tree = join(job, 'tree');
  const triggered = interceptWrite(t, join(tree, 'src/one.ts'), () => { fs.renameSync(tree, join(job, 'saved-tree')); fs.symlinkSync(f.outside, tree); });
  await assert.rejects(f.protection.prepare('job-a', f.binding)); assert.equal(triggered(), true);
  assert.throws(() => f.protection.manifest('job-a')); assert.deepEqual(await readdir(f.outside), []);
});

test('new protected copy path introduced after traversal blocks inspection', async t => {
  const f = await ready(t), baseline = join(dirname(f.manifest.copyRoot), 'baseline', digest('src/one.ts'));
  const triggered = interceptRead(t, baseline, () => fs.writeFileSync(join(f.manifest.copyRoot, '.env.late'), 'FAKE_ONLY=late\n'));
  const result = await f.protection.inspect('job-a'); assert.equal(triggered(), true); assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'protected_workspace_copy_changed_during_inspection');
  assert.equal(await readFile(join(f.source, 'src/one.ts'), 'utf8'), initial);
});

test('a parent swap during capture cannot redirect subsequent reads to an outside file', async t => {
  const f = await fixture(t), path = join(f.source, 'src/one.ts'); await mkdir(join(f.outside, 'src')); await writeFile(join(f.outside, 'src/one.ts'), 'outside sentinel\n');
  const triggered = interceptRead(t, path, () => { fs.renameSync(join(f.source, 'src'), join(f.directory, 'moved-src')); fs.symlinkSync(join(f.outside, 'src'), join(f.source, 'src')); });
  await assert.rejects(f.protection.prepare('job-a', f.binding)); assert.equal(triggered(), true);
  assert.equal(await readFile(join(f.outside, 'src/one.ts'), 'utf8'), 'outside sentinel\n');
});

test('an observed write race is unconfirmed, preserves outside target and blocks all automatic replay', async t => {
  const f = await ready(t), path = join(f.source, 'src/one.ts'); await writeFile(join(f.outside, 'sentinel'), 'outside sentinel\n');
  const triggered = interceptWrite(t, path, () => { fs.renameSync(path, join(f.source, 'src/moved.ts')); fs.symlinkSync(join(f.outside, 'sentinel'), path); });
  await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest), e => matches('apply_unconfirmed')(e) && e.uncertain === true);
  assert.equal(triggered(), true); assert.equal(await readFile(join(f.outside, 'sentinel'), 'utf8'), 'outside sentinel\n');
  const restarted = new ProtectedWorkspaces(f.storage);
  await assert.rejects(restarted.apply('job-a', f.draft.diffDigest), matches('apply_already_attempted'));
  assert.ok((await readdir(f.storage)).some(x => x.startsWith('lease-')));
});

test('an observed concurrent content writer after write is unconfirmed rather than a receipt', async t => {
  const f = await ready(t), path = join(f.source, 'src/one.ts');
  const triggered = interceptWrite(t, path, () => execFileSync(process.execPath, ['--input-type=module', '-e', 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[1], "concurrent author during application\\n");', path], { stdio: 'ignore' }));
  await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest), e => matches('apply_unconfirmed')(e) && e.uncertain === true);
  assert.equal(triggered(), true); assert.equal(fs.existsSync(join(dirname(f.manifest.copyRoot), 'apply-receipt.json')), false);
});

test('an interrupted source write leaves durable intent and lease, with no retry or false receipt', async t => {
  const f = await ready(t), path = join(f.source, 'src/one.ts'), original = fs.writeSync; let partial = false;
  await writeFile(join(f.manifest.copyRoot, 'src/one.ts'), 'CHANGED body\n'); f.draft = await f.protection.inspect('job-a');
  const mock = t.mock.method(fs, 'writeSync', function (fd, buffer, offset, length, position) {
    if (fs.readlinkSync('/proc/self/fd/' + fd) === path) {
      if (partial) throw Object.assign(Error('synthetic disk error'), { code: 'EIO' });
      partial = true; return original.call(this, fd, buffer, offset, 4, position);
    }
    return original.call(this, fd, buffer, offset, length, position);
  }); syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(f.protection.apply('job-a', f.draft.diffDigest), e => matches('apply_unconfirmed')(e) && e.uncertain === true);
  assert.ok(partial); assert.equal(fs.existsSync(join(dirname(f.manifest.copyRoot), 'apply-intent.json')), true);
  assert.equal(fs.existsSync(join(dirname(f.manifest.copyRoot), 'apply-receipt.json')), false);
  await assert.rejects(new ProtectedWorkspaces(f.storage).apply('job-a', f.draft.diffDigest), matches('apply_already_attempted'));
  assert.notEqual(await readFile(path, 'utf8'), initial);
  const other = await f.protection.prepare('job-b', f.binding); await writeFile(join(other.copyRoot, 'src/one.ts'), changed);
  const draft = await f.protection.inspect('job-b'); const before = await readFile(path);
  await assert.rejects(f.protection.apply('job-b', draft.diffDigest), matches('source_apply_lease_exists')); assert.deepEqual(await readFile(path), before);
});

test('packed refs are read without Git execution and gitlinks without .gitmodules are rejected', async t => {
  const f = await fixture(t); f.git('pack-refs', '--all');
  const m = await f.protection.prepare('packed', f.binding); assert.equal(m.head, f.binding.head);
  f.git('update-index', '--add', '--cacheinfo', '160000,' + f.binding.head + ',vendor/fake');
  await assert.rejects(f.protection.prepare('gitlink', f.binding), matches('submodule_unsupported'));
});

// Characterize the acknowledged LIMITATION of baseline-check + synchronous
// descriptor write. This deliberately demonstrates why the app must serialize
// source writers; it is not evidence of an atomic kernel compare-and-write.
test('documents the external writer comparison/write gap within the managed single-writer contract', async t => {
  const f = await ready(t), path = join(f.source, 'src/one.ts'), original = fs.writeSync; let externalWrite = false;
  const mock = t.mock.method(fs, 'writeSync', function (fd, ...args) {
    if (!externalWrite && fs.readlinkSync('/proc/self/fd/' + fd) === path) {
      externalWrite = true;
      execFileSync(process.execPath, ['--input-type=module', '-e', 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[1], "external update\\n");', path], { stdio: 'ignore' });
      assert.equal(fs.readFileSync(path, 'utf8'), 'external update\n');
    }
    return original.call(this, fd, ...args);
  }); syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const receipt = await f.protection.apply('job-a', f.draft.diffDigest);
  assert.equal(externalWrite, true); assert.equal(receipt.afterDigest, digest(changed));
  assert.equal(await readFile(path, 'utf8'), changed); // External update was overwritten: outside the caller's single-writer boundary.
});

test('copy budgets reject per-file excess, more than 2000 entries and more than 32MiB text', async t => {
  const oversized = await fixture(t, { 'large.txt': 'a'.repeat(1_048_577) });
  await assert.rejects(oversized.protection.prepare('large', oversized.binding), matches('file_too_large'));
  const many = await fixture(t, Object.fromEntries(Array.from({ length: 2001 }, (_, i) => ['f-' + i + '.txt', 'x'])));
  await assert.rejects(many.protection.prepare('many', many.binding), matches('too_many_files'));
  const total = await fixture(t, Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['f-' + i + '.txt', 'a'.repeat(1_048_576)])));
  await assert.rejects(total.protection.prepare('total', total.binding), matches('copy_budget_exceeded'));
});
