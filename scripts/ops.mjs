import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
const run = promisify(execFile); const root = fileURLToPath(new URL('../', import.meta.url));
const config = loadWorkspaceConfig(); const action = process.argv[2];
const quote = value => { if (/[\r\n\0]/.test(value)) throw new Error('Invalid unit path'); return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$')}"`; };
try {
  if (action === 'token') {
    if (config.accessToken) console.log(config.accessToken);
    else { await mkdir(config.stateDir, { recursive: true, mode: 0o700 }); const path = join(config.stateDir, 'access-token');
      try { await writeFile(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600, flush: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      await chmod(path, 0o600); console.log((await readFile(path, 'utf8')).trim()); }
  } else if (action === 'doctor') {
    const checks = { node: { version: process.version, ok: Number(process.versions.node.split('.')[0]) === 24 }, server: { os: platform(), arch: arch(), origin: config.origin },
      capabilities: { sourceFetch: config.sourceFetch, chrome: !!config.chromeCommand, noVnc: config.noVncPort !== null, codexRoots: config.workspaceRoots.length }, liveProviders: 'NOT_RUN' };
    for (const [name, executable, args] of [['git', 'git', ['--version']], ['tailscale', 'tailscale', ['version']], ['codex', config.codexCommand[0], ['--version']], ['bubblewrap', 'bwrap', ['--version']]]) {
      try { const result = await run(executable, args, { timeout: 4000, maxBuffer: 16000 }); checks[name] = { installed: true, version: result.stdout.trim().split('\n')[0] }; }
      catch { checks[name] = { installed: false }; }
    }
    try { checks.health = await (await fetch(`http://127.0.0.1:${process.env.WJ_PORT ?? '3000'}/health`, { signal: AbortSignal.timeout(2000) })).json(); } catch { checks.health = 'NOT_RUNNING'; }
    console.log(JSON.stringify(checks, null, 2)); if (!checks.node.ok) process.exitCode = 1;
  } else if (action === 'install') {
    if (platform() !== 'linux') throw new Error('The user service installer supports Linux only.');
    await access(join(root, 'dist/server/main.js'));
    const directory = join(homedir(), '.config', 'systemd', 'user'); await mkdir(directory, { recursive: true, mode: 0o700 });
    const servicePath = `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`;
    const unit = (description, script) => `[Unit]\nDescription=${description}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${root.replaceAll('%', '%%')}\nExecStart=${quote(process.execPath)} ${quote(`--env-file-if-exists=${join(root, '.env')}`)} ${quote(join(root, script))}\nEnvironment=DISPLAY=:99\nEnvironment=${quote(`PATH=${servicePath}`)}\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=45\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
    for (const [name, script] of [['webjjoku', 'dist/server/main.js'], ['webjjoku-desktop', 'scripts/desktop.mjs']]) {
      await writeFile(join(directory, `${name}.service`), unit(name, script), { mode: 0o600 });
    }
    await run('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 });
    console.log('Installed user units. Start: systemctl --user enable --now webjjoku');
    console.log('Optional Chrome display: systemctl --user enable --now webjjoku-desktop');
    console.log('Enable linger for this OS user to keep services after logout. See docs/operations-runbook.md.');
  } else if (action === 'serve') {
    const origin = new URL(config.origin); if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.ts.net')) throw new Error('Set WJ_PUBLIC_ORIGIN to the full Tailnet HTTPS origin first.');
    const port = Number(origin.port || '443'); const { stdout } = await run('tailscale', ['serve', 'status', '--json'], { timeout: 10000 });
    const status = JSON.parse(stdout); const occupied = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => key === String(port) || key.endsWith(`:${port}`) || occupied(child));
    if (occupied(status)) throw new Error('The selected Serve port already has configuration. Inspect tailscale serve status; no settings were changed.');
    const self = JSON.parse((await run('tailscale', ['status', '--json'], { timeout: 10000 })).stdout).Self;
    if (String(self?.DNSName).replace(/\.$/, '') !== origin.hostname) throw new Error('The origin does not identify this Tailscale host.');
    await run('tailscale', ['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${process.env.WJ_PORT ?? '3000'}`], { timeout: 20000 });
    console.log(`Private Serve configured: ${config.origin}. Verify access from an allowed Tailnet device.`);
  } else if (action === 'backup') {
    const { DatabaseSync, backup } = await import('node:sqlite'); const target = process.argv[3] ? resolve(process.argv[3]) : join(config.stateDir, 'backups', `${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
    if (!isAbsolute(target)) throw new Error('Use an absolute backup path.'); await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
    try { await access(target); throw new Error('Backup destination already exists.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const database = new DatabaseSync(join(config.stateDir, 'workspace.sqlite'), { readOnly: true });
    try { await backup(database, target); await chmod(target, 0o600); } finally { database.close(); }
    console.log(`Created private state backup: ${target}. Provider tokens are excluded; reconnect accounts after recovery.`);
  } else throw new Error('Usage: ops.mjs token | doctor | install | serve | backup [absolute-file]');
} catch (error) { console.error(error instanceof Error ? error.message : 'Operation failed'); process.exitCode = 1; }
