import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { OUTER_BWRAP, outerIdentity } from './outer-bwrap.js';

type Binding = { repoRoot: string; cwd: string; allowWrite?: boolean };
const execute = promisify(execFile);
const lifetime = 60_000;
const toolStarted = 'ISOLATION_TOOL_STARTED\n';
const namespaceErrors = new Set([
  'bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.',
  'bwrap: Creating new namespace failed: Operation not permitted',
  'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted',
]);
const namespaceUnavailable = (status: number | null, stdout: string, stderr: string): boolean =>
  status === 1 && !stdout.includes(toolStarted) && stderr.split(/\r?\n/).some(line => namespaceErrors.has(line));
const quote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
const inside = (root: string, path: string): boolean => { const r = relative(root, path); return r !== '..' && !r.startsWith('../') && !isAbsolute(r); };
const denied = (stage: string): Error => new Error(`execution_isolation_unverified: ${stage}`);
function directory(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path || !statSync(path).isDirectory()) throw denied('canonical_directory_required');
  return path;
}
function executable(name: string): string {
  const path = isAbsolute(name) ? name : (process.env.PATH ?? '').split(':').filter(Boolean).map(p => join(p, name)).find(p => existsSync(p));
  if (!path) throw denied('executable_missing');
  return realpathSync(path);
}
function runtimeRoots(runtime: string): string[] {
  const metadata = join(runtime, 'package.json');
  const launcher = existsSync(metadata) ? JSON.parse(readFileSync(metadata, 'utf8')) as Record<string, unknown> : null;
  if (launcher?.name !== '@openai/codex') return [runtime];
  const platformPackage = process.arch === 'x64' ? '@openai/codex-linux-x64' : process.arch === 'arm64' ? '@openai/codex-linux-arm64' : null;
  if (!platformPackage) throw denied('unsupported_native_platform');
  let nativeMetadata: string;
  try { nativeMetadata = createRequire(metadata).resolve(platformPackage + '/package.json'); }
  catch {
    if (existsSync(join(runtime, 'vendor'))) return [runtime];
    throw denied('native_runtime_missing');
  }
  // Only resolution failure can use the launcher's legacy vendor fallback.
  const native = JSON.parse(readFileSync(nativeMetadata, 'utf8')) as Record<string, unknown>;
  // Current npm optional dependencies are aliases of the platform-tagged codex package.
  const aliased = native.name === '@openai/codex' && native.version === `${launcher.version}-linux-${process.arch}` &&
    Array.isArray(native.os) && native.os.includes('linux') && Array.isArray(native.cpu) && native.cpu.includes(process.arch);
  if (native.name !== platformPackage && !aliased) throw denied('native_package_identity');
  return [...new Set([runtime, directory(realpathSync(dirname(nativeMetadata)))])];
}
function identity(path: string): string {
  const s = statSync(path); return `${path}:${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
}
function inode(path: string): string {
  const s = statSync(path); return `${path}:${s.dev}:${s.ino}:${s.mode}`;
}
function property(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const found = (obj.properties as Record<string, Record<string, unknown>> | undefined)?.[key];
  return found ?? Object.values(obj).map(v => property(v, key)).find(Boolean);
}

/** Capability proof only: the parent owns copy sanitization, locking, approvals and reconnects.
 * Never prepares/replays a job, inspects an owner's session, or launches a model turn.
 */
export class ExecutionIsolation {
  readonly profileId = 'webjjoku_copy';
  readonly readProfileId = 'webjjoku_read';
  profileFor(binding: Binding): string { return binding.allowWrite === false ? this.readProfileId : this.profileId; }
  private readonly command: string[];
  private readonly protectedPaths: string[];
  private readonly privateDirectory: string;
  private readonly proofs = new Map<string, number>();
  private readonly ready = new Map<string, number>();
  constructor(command: string[], protectedPaths: string[], privateDirectory: string, private readonly outerBwrap?: string) {
    this.command = [...command]; this.protectedPaths = [...protectedPaths]; this.privateDirectory = privateDirectory;
  }
  private context(binding: Binding, copyRoot?: string) {
    if (process.platform !== 'linux' || this.command.length !== 2 || this.command[1] !== 'app-server') throw denied('trusted_app_server_command_required');
    const repo = directory(binding.repoRoot); const cwd = directory(binding.cwd);
    if (repo === '/' || !inside(repo, cwd)) throw denied('cwd_outside_repository');
    const auth = directory(realpathSync(process.env.CODEX_HOME ?? join(homedir(), '.codex')));
    const candidates = [...new Set([...this.protectedPaths, this.privateDirectory,
      join(homedir(), '.config', 'google-chrome'), join(homedir(), '.config', 'chromium')].filter(p => existsSync(p)).map(p => realpathSync(p)))];
    // A denied parent already covers its descendants. Redundant child masks can
    // make the CLI's filesystem helper try mkdir under an already read-only mask.
    const masks = candidates.filter(p => !candidates.some(parent => parent !== p && inside(parent, p)));
    if (inside(repo, auth) || inside(auth, repo) || masks.some(p => p === '/' || inside(p, repo) || inside(p, auth) || inside(auth, p))) throw denied('protected_path_overlap');
    if (!isAbsolute(this.privateDirectory) || inside(repo, resolve(this.privateDirectory))) throw denied('private_directory_overlap');
    if (copyRoot) {
      directory(copyRoot);
      if (inside(repo, copyRoot) || inside(copyRoot, repo) || inside(auth, copyRoot) || !masks.some(p => inside(p, copyRoot))) throw denied('private_copy_required');
      if (!inside(copyRoot, directory(join(copyRoot, relative(repo, cwd))))) throw denied('copy_cwd_escape');
    }
    const cli = executable(this.command[0]!); const bwrap = this.outerBwrap ? '/usr/bin/bwrap' : executable('bwrap');
    const outer = this.outerBwrap ? outerIdentity(this.outerBwrap) : null;
    // The npm launcher needs its own narrowly scoped runtime package inside the tool sandbox.
    const packageRoot = dirname(dirname(cli));
    const runtime = existsSync(join(packageRoot, 'package.json')) && JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).name === '@openai/codex' ? packageRoot : dirname(cli);
    const runtimes = runtimeRoots(runtime);
    for (const path of runtimes) {
      if (path === '/' || path === homedir() || inside(repo, path) || inside(path, repo) || inside(auth, path) || inside(path, auth) || masks.some(mask => inside(mask, path) || inside(path, mask))) throw denied('unsafe_cli_runtime');
      if (copyRoot && (inside(path, copyRoot) || inside(copyRoot, path))) throw denied('private_copy_required');
    }
    const host = ['user', 'mnt', 'pid', 'net'].map(n => readlinkSync(`/proc/self/ns/${n}`));
    const empty = join(this.privateDirectory, 'empty.config.toml');
    const key = JSON.stringify([this.command, identity(cli), identity(bwrap), outer, runtimes.map(identity), identity(process.execPath), existsSync(empty) ? identity(empty) : null, inode(auth), masks.map(inode), process.env.PATH, host, readFileSync('/proc/sys/kernel/random/boot_id', 'utf8')]);
    return { repo, cwd, cli, bwrap, runtime, auth, masks, key };
  }
  private config(root: string, runtime: string, auth: string, masks = this.protectedPaths, readOnly = false): string[] {
    // Override the entire permissions table, not dotted path keys (paths may contain dots).
    const node = dirname(dirname(realpathSync(process.execPath)));
    if (node === '/' || node === homedir()) throw denied('unsafe_node_runtime');
    const fs: Record<string, string> = { ':root': 'deny', ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny', [runtime]: 'read', [node]: 'read', [auth]: 'deny', [root]: readOnly ? 'read' : 'write' };
    for (const p of runtimeRoots(runtime)) fs[p] = 'read';
    for (const p of masks) fs[p] = 'deny';
    const filesystem = Object.entries(fs).map(([p, access]) => `${JSON.stringify(p)}=${JSON.stringify(access)}`).join(',');
    const path = this.outerBwrap ? `/usr/bin:/bin:${join(node, 'bin')}` : `${join(node, 'bin')}:/usr/bin:/bin`;
    const profile = readOnly ? this.readProfileId : this.profileId;
    return [`permissions={${profile}={filesystem={${filesystem}},network={enabled=false}}}`,
      `default_permissions=${JSON.stringify(profile)}`, 'approval_policy="never"', 'allow_login_shell=false',
      `shell_environment_policy={inherit="none",include_only=[],exclude=["*"],set={PATH=${JSON.stringify(path)}}}`,
      'mcp_servers={}', 'plugins={}', 'hooks={}', 'notify=[]', 'apps={_default={enabled=false}}',
      'features.codex_hooks=false', 'features.hooks=false', 'features.apps=false', 'features.plugins=false', 'features.multi_agent=false',
      'features.js_repl=false', 'web_search="disabled"'].flatMap(c => ['-c', c]);
  }
  private wrap(repo: string, cwd: string, copy: string, auth: string, masks: string[], command: string[], readOnly = false): string[] {
    const empty = join(this.privateDirectory, 'empty.config.toml');
    if (this.outerBwrap) outerIdentity(this.outerBwrap);
    const argv = [this.outerBwrap ?? executable('bwrap'), '--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
      '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/var/tmp', '--tmpfs', '/run',
      '--bind', auth, auth, '--clearenv'];
    // The outer executable is selected by absolute path; the inner CLI must find
    // the reviewed stock bwrap, never a user PATH shim or this outer launcher.
    const path = this.outerBwrap ? `/usr/bin:/bin:${dirname(process.execPath)}` : process.env.PATH ?? '/usr/bin:/bin';
    for (const [key, value] of Object.entries({ PATH: path, HOME: homedir(), CODEX_HOME: auth, LANG: 'C.UTF-8' })) argv.push('--setenv', key, value);
    for (const p of masks) argv.push(...(statSync(p).isDirectory() ? ['--tmpfs', p] : ['--ro-bind', '/dev/null', p]));
    // Sources are resolved in the host namespace, even when the state parent is masked.
    argv.push(readOnly ? '--ro-bind' : '--bind', copy, repo);
    for (const path of [join(auth, 'config.toml')]) {
      if (existsSync(path)) argv.push('--ro-bind', empty, path);
    }
    for (const path of [join(auth, 'plugins'), join(auth, 'hooks'), join(auth, 'skills'), join(homedir(), '.agents')]) {
      if (existsSync(path)) argv.push('--tmpfs', path);
    }
    // Prevent ancestor project config from reintroducing MCP servers or hooks.
    for (let parent = dirname(repo); parent !== '/'; parent = dirname(parent)) {
      const config = join(parent, '.codex', 'config.toml');
      if (existsSync(config)) argv.push('--ro-bind', empty, config);
    }
    return [...argv, '--chdir', cwd, '--', ...command];
  }
  async verify(binding: Binding, copyRoot?: string): Promise<void> {
    let stage = 'paths';
    try {
      // Create only this module's private probe directory, never a source or job copy.
      if (!isAbsolute(this.privateDirectory) || resolve(this.privateDirectory) !== this.privateDirectory ||
          inside(resolve(binding.repoRoot), this.privateDirectory) || inside(this.privateDirectory, resolve(binding.repoRoot))) throw denied('private_directory_overlap');
      const auth = realpathSync(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
      if (inside(auth, this.privateDirectory) || inside(this.privateDirectory, auth)) throw denied('private_directory_overlap');
      let ancestor = this.privateDirectory;
      while (!existsSync(ancestor)) ancestor = dirname(ancestor);
      directory(ancestor);
      await mkdir(this.privateDirectory, { recursive: true, mode: 0o700 }); directory(this.privateDirectory);
      if (statSync(this.privateDirectory).mode & 0o077) throw denied('private_directory_permissions');
      const empty = join(this.privateDirectory, 'empty.config.toml');
      try { const file = await open(empty, 'wx', 0o400); await file.close(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (realpathSync(empty) !== empty || !statSync(empty).isFile() || (await readFile(empty)).length) throw denied('empty_config_required');
      const c = this.context(binding, copyRoot);
      if ((this.proofs.get(c.key) ?? 0) < Date.now()) {
        stage = 'local_cli_schema_or_host_profile'; await this.probe(c.cli, c.runtime);
        // Directory timestamps change during probes; capture the completed host state.
        this.proofs.set(this.context(binding, copyRoot).key, Date.now() + lifetime);
      }
      if (copyRoot) this.ready.set(this.bindingKey(binding, copyRoot), Date.now() + lifetime);
    } catch (error) {
      this.ready.clear();
      if (error instanceof Error && error.message.startsWith('execution_isolation_unverified:')) throw error;
      throw denied(stage);
    }
  }
  private bindingKey(binding: Binding, copy: string): string {
    return JSON.stringify([this.context(binding, copy).key, this.profileFor(binding), binding.repoRoot, binding.cwd, inode(binding.repoRoot), inode(binding.cwd), inode(copy)]);
  }
  commandFor(binding: Binding, copyRoot: string): string[] {
    if (!this.ready.size) throw denied('verify_copy_required');
    const c = this.context(binding, copyRoot);
    if ((this.ready.get(this.bindingKey(binding, copyRoot)) ?? 0) < Date.now()) throw denied('verify_copy_required');
    return this.wrap(c.repo, c.cwd, copyRoot, c.auth, c.masks, [c.cli, ...this.command.slice(1), ...this.config(c.repo, c.runtime, c.auth, c.masks, binding.allowWrite === false)], binding.allowWrite === false);
  }
  private async probe(cli: string, runtime: string): Promise<void> {
    const base = await mkdtemp(join(this.privateDirectory, 'isolation-')); await chmod(base, 0o700);
    const source = join(base, 'source'), state = join(base, 'state'), copy = join(state, 'job', 'copy');
    const auth = join(base, 'home', '.codex'), chrome = join(base, 'chrome'), sibling = join(base, 'sibling');
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(base, 'home'), CODEX_HOME: auth, LANG: 'C.UTF-8' };
    const run = (args: string[]) => execute(cli, args, { env, cwd: base, timeout: 20_000, maxBuffer: 1_000_000 });
    const listener = createServer(socket => { socket.destroy(); }); let connections = 0;
    listener.on('connection', () => { connections++; });
    let canary: Awaited<ReturnType<typeof open>> | undefined;
    try {
      for (const dir of [join(source, 'sub'), join(copy, 'sub'), auth, chrome, sibling]) await mkdir(dir, { recursive: true });
      for (const path of [join(source, '.env'), join(source, 'tracked'), join(state, 'secret'), join(auth, 'auth.json'), join(chrome, 'secret'), join(sibling, 'secret')]) await writeFile(path, 'FAKE-CANARY');
      await writeFile(join(auth, 'config.toml'), 'default_permissions=":danger-full-access"\n');
      await writeFile(join(copy, 'tracked'), 'SANITIZED-COPY');
      const version = (await run(['--version'])).stdout.trim();
      const help = (await run(['sandbox', '--help'])).stdout;
      if (!/^codex-cli \d+\.\d+\.\d+/.test(version) || !help.includes('--permission-profile') || !help.includes('--include-managed-config')) throw denied('named_profiles_unsupported');
      const schema = join(base, 'schema'); await run(['app-server', 'generate-json-schema', '--experimental', '--out', schema]);
      const files = await readdir(schema, { recursive: true });
      const load = async (name: string) => {
        const found = files.filter(p => p === `${name}.json` || p.endsWith(`/${name}.json`));
        if (found.length !== 1) throw denied('schema_file_ambiguous_or_missing');
        return JSON.parse(await readFile(join(schema, found[0]!), 'utf8')) as unknown;
      };
      for (const name of ['TurnStartParams', 'ThreadResumeParams', 'ThreadStartParams']) {
        const type = property(await load(name), 'permissions')?.type;
        if (!(type === 'string' || Array.isArray(type) && type.includes('string'))) throw denied('permissions_schema_missing');
      }
      if (property(await load('InitializeParams'), 'experimentalApi')?.type !== 'boolean' ||
          !property(await load('PermissionProfileListParams'), 'cwd') || property(await load('PermissionProfileListResponse'), 'allowed')?.type !== 'boolean' ||
          !JSON.stringify(await load('ClientRequest')).includes('"permissionProfile/list"')) throw denied('experimental_schema_missing');
      try { await new Promise<void>((ok, fail) => { listener.once('error', fail); listener.listen(0, '127.0.0.1', ok); }); }
      catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw denied('host_network_probe_unavailable'); throw error; }
      const port = (listener.address() as { port: number }).port;
      canary = await open(join(sibling, 'secret'), 'r');
      const secrets = [join(source, '.env'), join(state, 'secret'), join(auth, 'auth.json'), join(chrome, 'secret'), join(sibling, 'secret'), join(auth, 'config.toml'), join(auth, 'server.log'),
        `/proc/${process.pid}/root${sibling}/secret`, `/proc/${process.pid}/fd/${canary.fd}`, `/proc/1/root${auth}/auth.json`];
      // bwrap can create disposable scaffold files at denied paths. Check host canaries
      // afterward as well as read denials; a successful write must never reach the host.
      const forbidden = secrets.map((p, i) => `if /bin/cat ${quote(p)} >/dev/null 2>&1; then printf CANARY_READ_${i} >&2; exit 81; fi; (printf BAD >> ${quote(p)}) 2>/dev/null || :;`).join('\n');
      const hostGuards = this.outerBwrap ? `\nlabel=$(/bin/cat /proc/self/attr/current)\ncase "$label" in *webjjoku_outer_bwrap*) ;; *) exit 90;; esac\ncase "$label" in *unpriv_bwrap*) ;; *) exit 91;; esac\nif ${quote(OUTER_BWRAP)} --version >/dev/null 2>&1; then exit 88; fi\nif /usr/bin/unshare --user --map-root-user --mount /bin/true >/dev/null 2>&1; then exit 89; fi\n` : '';
      const tool = `printf 'ISOLATION_TOOL_STARTED\\n'\nset -eu\n[ "$PWD" = ${quote(join(source, 'sub'))} ]\n[ "$(/bin/cat ../tracked)" = SANITIZED-COPY ]\nprintf COPY-EDIT > ../tracked\nprintf CREATED > new-file\n${forbidden}\nif /bin/ls /tmp >/dev/null 2>&1 || (printf BAD > /tmp/webjjoku-probe) 2>/dev/null; then exit 86; fi\n/bin/bash -c 'exit 0'\n${quote(process.execPath)} -e 'if (process.versions.node !== ${JSON.stringify(process.versions.node)}) process.exit(87)'\nif /bin/bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}' 2>/dev/null; then exit 84; fi\n${hostGuards}\nprintf 'ISOLATION_READY\\n'\nread -r release\n[ ! -e ../late-secret ]\nprintf 'ISOLATION_OK\\n'`;
      const inner = [cli, 'sandbox', '--include-managed-config', '-P', this.profileId, '-C', join(source, 'sub'), ...this.config(source, runtime, auth, [state, chrome, sibling]), '--', '/bin/sh', '-c', tool];
      const outer = `set -eu\n[ ! -e ${quote(join(source, '.env'))} ]\n[ "$(/bin/cat ${quote(join(auth, 'auth.json'))})" = FAKE-CANARY ]\nprintf LOG > ${quote(join(auth, 'server.log'))}\nif (printf BAD > ${quote(join(sibling, 'root-write'))}) 2>/dev/null; then exit 85; fi\nexec ${inner.map(quote).join(' ')}`;
      await this.runProbe(this.wrap(source, join(source, 'sub'), copy, auth, [state, chrome], ['/bin/sh', '-c', outer]), base, async () => {
        await writeFile(join(source, 'late-secret'), 'FAKE-LATE-SECRET');
      });
      // The write canary may create a disposable .env in the alias copy while
      // attempting host writes. It contains no host secret; start read proof clean.
      await rm(join(copy, '.env'), { force: true });
      // A successful write proof must never stand in for least-read containment.
      const readTool = `printf 'ISOLATION_TOOL_STARTED\\n'\nset -eu\n[ "$(/bin/cat ../tracked)" = COPY-EDIT ]\nif (printf BAD > ../tracked) 2>/dev/null || (printf BAD > ../read-created) 2>/dev/null; then exit 92; fi\n${forbidden}\n${hostGuards}\nif /bin/bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}' 2>/dev/null; then exit 84; fi\nprintf 'ISOLATION_READY\\n'\nread -r release\nprintf 'ISOLATION_OK\\n'`;
      const readInner = [cli, 'sandbox', '--include-managed-config', '-P', this.readProfileId, '-C', join(source, 'sub'), ...this.config(source, runtime, auth, [state, chrome, sibling], true), '--', '/bin/sh', '-c', readTool];
      await this.runProbe(this.wrap(source, join(source, 'sub'), copy, auth, [state, chrome], readInner, true), base, async () => {});
      if (connections || await readFile(join(source, 'tracked'), 'utf8') !== 'FAKE-CANARY' ||
          await readFile(join(copy, 'tracked'), 'utf8') !== 'COPY-EDIT' || await readFile(join(copy, 'sub', 'new-file'), 'utf8') !== 'CREATED' ||
          await readFile(join(auth, 'server.log'), 'utf8') !== 'LOG') throw denied('canary_mismatch');
      for (const path of secrets.slice(0, 5)) if (await readFile(path, 'utf8') !== 'FAKE-CANARY') throw denied('canary_modified');
    } finally {
      await canary?.close();
      if (listener.listening) await new Promise<void>(ok => listener.close(() => ok()));
      await rm(base, { recursive: true, force: true });
    }
  }
  private async runProbe(argv: string[], cwd: string, release: () => Promise<void>): Promise<void> {
    await new Promise<void>((ok, fail) => {
      const child = spawn(argv[0]!, argv.slice(1), { cwd, env: {}, stdio: 'pipe' }); let output = '', stderr = '', released = false, failed = false;
      const stop = () => { failed = true; child.kill('SIGKILL'); };
      const timer = setTimeout(stop, 20_000);
      child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8000); });
      child.stdin.on('error', stop); child.once('error', stop);
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString(); if (output.length > 64_000) stop();
        if (!released && output.includes('ISOLATION_READY\n')) { released = true; void release().then(() => child.stdin.end('continue\n'), stop); }
      });
      child.once('close', status => {
        clearTimeout(timer);
        if (!failed && status === 0 && released && output.endsWith('ISOLATION_OK\n')) ok();
        else fail(Object.assign(denied(!failed && namespaceUnavailable(status, output, stderr) ? 'host_namespace_unavailable' : `profile_canary_probe_failed_${status}`), { cause: new Error(stderr) }));
      });
    });
  }
}
