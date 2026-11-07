// Explicit administrator operation only. Importing this module never changes the host.
import { constants as F, lstatSync, readFileSync, openSync, closeSync, fstatSync, readSync,
  writeFileSync, fchownSync, fchmodSync, fsyncSync, mkdirSync, rmdirSync, unlinkSync,
  chmodSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST = Object.freeze({ binary: '/usr/local/libexec/webjjoku/bwrap',
  directory: '/usr/local/libexec/webjjoku', parent: '/usr/local/libexec', stock: '/usr/bin/bwrap',
  profile: '/etc/apparmor.d/webjjoku-outer-bwrap', name: 'webjjoku_outer_bwrap',
  stockPolicy: '/etc/apparmor.d/bwrap-userns-restrict', profiles: '/sys/kernel/security/apparmor/profiles' });
const template = fileURLToPath(new URL('./fixtures/webjjoku-outer-bwrap.apparmor', import.meta.url));
const templateDigest = '08af326bd49ee2bbcf1b1d64851808599312a4de32448ba1f6f99e98ad0b0ff6';
const env = { PATH: '/usr/sbin:/usr/bin', LANG: 'C', LC_ALL: 'C' };
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const fail = reason => { throw new Error(reason); };
const exists = path => { try { lstatSync(path); return true; } catch (e) { if (e.code !== 'ENOENT') throw e; return false; } };
const run = (path, args, input) => execFileSync(path, args, { env, input, encoding: 'utf8', timeout: 20_000, maxBuffer: 1_048_576 });

export function assertNode(st, kind, mode, gid, packagedLinks = false) {
  if (st.isSymbolicLink() || !(kind === 'directory' ? st.isDirectory() : st.isFile()) || st.uid !== 0 ||
    (st.mode & 0o022) || (mode !== undefined && (st.mode & 0o7777) !== mode) ||
    (gid !== undefined && st.gid !== gid) || (kind === 'file' && st.nlink !== 1 && !packagedLinks)) fail('untrusted_file_or_parent');
}
export function assertElf(bytes) {
  if (bytes.length < 64 || bytes.toString('hex', 0, 4) !== '7f454c46' ||
    bytes[4] !== 2 || bytes[5] !== 1 || ![2, 3].includes(bytes.readUInt16LE(16))) fail('stock_binary_not_native_elf');
}
export function assertChecksum(bytes, sums, path) {
  const entries = sums.split('\n').filter(line => line.slice(34) === path.slice(1));
  if (entries.length !== 1 || !/^[a-f0-9]{32}  /.test(entries[0]) || hash(bytes, 'md5') !== entries[0].slice(0, 32)) fail('package_binary_mismatch');
}
export function assertStockPolicy(text) {
  if (!/profile bwrap \/usr\/bin\/bwrap flags=/.test(text) ||
    !/allow pix \/\*\* -> &bwrap\/\/&unpriv_bwrap,/.test(text) ||
    !/profile unpriv_bwrap flags=/.test(text) || !/\n\s*audit deny capability,/.test(text)) fail('unsupported_stock_policy');
}
export function assertConffile(bytes, records, path) {
  const rows = records.split('\n').map(line => line.trim().split(/\s+/)).filter(row => row[0] === path);
  if (rows.length !== 1 || rows[0].length !== 2 || hash(bytes, 'md5') !== rows[0][1]) fail('stock_policy_package_mismatch');
}
export function assertProfileList(text, installed) {
  const names = text.split('\n').filter(line => line.includes(HOST.name));
  if (installed ? names.length !== 1 || names[0] !== `${HOST.name} (enforce)` : names.length !== 0) fail('unexpected_loaded_profile');
  for (const name of ['bwrap', 'unpriv_bwrap']) if (!text.split('\n').includes(`${name} (enforce)`)) fail('stock_profile_not_enforcing');
}
export function assertIdleProcesses(processes) {
  if (processes.some(p => p.label.includes(HOST.name) || p.exe === HOST.binary || p.exe === `${HOST.binary} (deleted)`)) fail('dedicated_execution_still_running');
}
function parents(path) {
  for (let p = dirname(path); ; p = dirname(p)) { assertNode(lstatSync(p), 'directory'); if (p === '/') break; }
}
function trusted(path, limit = 16_777_216, packagedLinks = false) {
  parents(path); const before = lstatSync(path); assertNode(before, 'file', undefined, undefined, packagedLinks);
  const fd = openSync(path, F.O_RDONLY | F.O_NOFOLLOW);
  try {
    const st = fstatSync(fd); assertNode(st, 'file', undefined, undefined, packagedLinks);
    if (st.ino !== before.ino || st.dev !== before.dev || st.size > limit) fail('file_identity_or_size_changed');
    const bytes = Buffer.alloc(st.size); let count = 0;
    while (count < bytes.length) { const n = readSync(fd, bytes, count, bytes.length - count, null); if (!n) fail('short_file_read'); count += n; }
    const after = fstatSync(fd);
    if (st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs) fail('file_changed_during_read');
    return bytes;
  } finally { closeSync(fd); }
}
function packaged(path, pkg, packagedLinks = false) {
  const bytes = trusted(path, undefined, packagedLinks);
  const sums = trusted(`/var/lib/dpkg/info/${pkg}.md5sums`, 8_388_608).toString('utf8');
  assertChecksum(bytes, sums, path); return bytes;
}
function profileList() { return readFileSync(HOST.profiles, 'utf8'); }
function idle() {
  // Refuse permission failures; a hidden process is not evidence of an idle host.
  const processes = [];
  for (const pid of readdirSync('/proc').filter(p => /^[0-9]+$/.test(p))) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      if (/^Kthread:\s+1$/m.test(status)) continue;
      let exe = ''; try { exe = readlinkSync(`/proc/${pid}/exe`); } catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e; }
      processes.push({ exe, label: readFileSync(`/proc/${pid}/attr/current`, 'utf8') });
    } catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e; }
  }
  assertIdleProcesses(processes);
}
function prerequisites() {
  if (process.platform !== 'linux') fail('linux_required');
  // Validate the package database's fixed binaries before executing any helper.
  packaged('/usr/bin/dpkg-query', 'dpkg'); packaged('/usr/sbin/apparmor_parser', 'apparmor'); packaged('/usr/sbin/getcap', 'libcap2-bin');
  const id = realpathSync('/usr/bin/id');
  if (!['/usr/bin/id', '/usr/lib/cargo/bin/coreutils/id'].includes(id)) fail('unsupported_id_binary');
  // Ubuntu's packaged Rust coreutils share one root-owned executable by hardlink.
  // Only this fixed, checksum-verified read may have links; installed paths may not.
  parents('/usr/bin/id'); packaged(id, id === '/usr/bin/id' ? 'coreutils' : 'rust-coreutils', id !== '/usr/bin/id');
  for (const pkg of ['bubblewrap', 'apparmor', 'libcap2-bin', 'dpkg', id === '/usr/bin/id' ? 'coreutils' : 'rust-coreutils']) {
    if (run('/usr/bin/dpkg-query', ['-W', '-f=${Status}', pkg]) !== 'install ok installed') fail('package_not_installed');
  }
  const uid = Number(run(id, ['-u', 'firewine']).trim()), gid = Number(run(id, ['-g', 'firewine']).trim());
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0 || run(id, ['-gn', 'firewine']).trim() !== 'firewine') fail('nonroot_firewine_account_required');
  const stock = packaged(HOST.stock, 'bubblewrap'); assertElf(stock);
  const st = lstatSync(HOST.stock);
  if (st.gid !== 0 || ![0o755, 0o4755].includes(st.mode & 0o7777) || run('/usr/sbin/getcap', ['-n', HOST.stock]).trim()) fail('unsupported_stock_binary_permissions');
  const policy = trusted(HOST.stockPolicy);
  assertConffile(policy, run('/usr/bin/dpkg-query', ['-W', '-f=${Conffiles}', 'apparmor']), HOST.stockPolicy);
  assertStockPolicy(policy.toString('utf8'));
  for (const p of ['/etc/apparmor.d/local/bwrap-userns-restrict', '/etc/apparmor.d/local/unpriv_bwrap']) if (exists(p)) fail('stock_local_override_requires_review');
  const approved = readFileSync(template);
  if (hash(approved) !== templateDigest) fail('unapproved_profile_template');
  parents(HOST.profile); parents(HOST.parent);
  if (exists(HOST.parent)) assertNode(lstatSync(HOST.parent), 'directory', 0o755, 0);
  return { stock, approved, gid };
}
function installed(ctx) {
  assertNode(lstatSync(HOST.directory), 'directory', 0o755, 0);
  assertNode(lstatSync(HOST.binary), 'file', 0o750, ctx.gid);
  assertNode(lstatSync(HOST.profile), 'file', 0o644, 0);
  if (!trusted(HOST.binary).equals(ctx.stock) || !trusted(HOST.profile).equals(ctx.approved) || run('/usr/sbin/getcap', ['-n', HOST.binary]).trim()) fail('installed_content_or_capability_mismatch');
}
// This installed parser reads stdin only when no positional filename is given;
// a literal '-' is treated as a filename and rejected before installation.
const parse = (action, path, input) => run('/usr/sbin/apparmor_parser', ['--config-file', '/dev/null', action, '--skip-cache', ...(path === '-' ? [] : [path])], input);
export function compileProfile(bytes) { parse('--skip-kernel-load', '-', bytes); }
function create(path, bytes, mode, gid, created) {
  const fd = openSync(path, F.O_WRONLY | F.O_CREAT | F.O_EXCL | F.O_NOFOLLOW, 0o600);
  created.push({ path, st: fstatSync(fd) });
  try { writeFileSync(fd, bytes); fchownSync(fd, 0, gid); fchmodSync(fd, mode); fsyncSync(fd); } finally { closeSync(fd); }
}
function cleanup(created) {
  for (const entry of [...created].reverse()) {
    const st = lstatSync(entry.path);
    if (st.ino !== entry.st.ino || st.dev !== entry.st.dev || st.isSymbolicLink()) fail('rollback_path_identity_changed');
    if (st.isDirectory()) rmdirSync(entry.path); else unlinkSync(entry.path);
  }
}
function install(ctx) {
  for (const p of [HOST.directory, HOST.binary, HOST.profile]) if (exists(p)) fail('installation_path_exists');
  assertProfileList(profileList(), false);
  // Compile without loading or caches before creating any root-owned path.
  // Parse verified bytes via stdin: the user-owned template path could change.
  compileProfile(ctx.approved);
  const created = []; let loadAttempted = false;
  try {
    for (const p of [HOST.parent, HOST.directory]) if (!exists(p)) {
      mkdirSync(p, { mode: 0o755 }); created.push({ path: p, st: lstatSync(p) });
      // mkdir's mode is affected by sudo's umask; make the reviewed mode explicit.
      chmodSync(p, 0o755); assertNode(lstatSync(p), 'directory', 0o755, 0);
    }
    // Keep the binary non-executable until its profile is enforcing.
    create(HOST.binary, ctx.stock, 0o640, ctx.gid, created);
    create(HOST.profile, ctx.approved, 0o644, 0, created);
    loadAttempted = true; parse('--add', HOST.profile); assertProfileList(profileList(), true);
    chmodSync(HOST.binary, 0o750); installed(ctx);
  } catch (error) {
    try {
      if (created.some(e => e.path === HOST.binary)) chmodSync(HOST.binary, 0o640);
      if (loadAttempted && profileList().includes(HOST.name)) {
        assertProfileList(profileList(), true); idle(); parse('--remove', HOST.profile);
      }
      assertProfileList(profileList(), false); cleanup(created);
    } catch (rollback) { fail(`install_failed; rollback_incomplete: ${rollback.message}; review only the dedicated paths`); }
    throw error;
  }
}
function remove(ctx) {
  installed(ctx); assertProfileList(profileList(), true); idle();
  if (readdirSync(HOST.directory).join('\n') !== 'bwrap') fail('unexpected_installation_directory_content');
  // Block new owner executions before checking again and unloading this profile only.
  chmodSync(HOST.binary, 0o640);
  try { idle(); parse('--remove', HOST.profile); assertProfileList(profileList(), false); }
  catch (error) {
    if (profileList().split('\n').includes(`${HOST.name} (enforce)`)) chmodSync(HOST.binary, 0o750);
    throw error;
  }
  unlinkSync(HOST.binary); unlinkSync(HOST.profile); rmdirSync(HOST.directory);
  // /usr/local/libexec may predate us. Never remove it without an ownership receipt.
}
export function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['install', 'check', 'remove'].includes(args[0])) fail('Usage: node scripts/execution-isolation-host.mjs install|check|remove');
  const [action] = args;
  if (action !== 'check' && (process.getuid?.() !== 0 || process.geteuid?.() !== 0)) fail('administrator_required: run the reviewed command explicitly with sudo/root; this script never calls sudo');
  const ctx = prerequisites();
  if (action === 'install') install(ctx);
  else if (action === 'remove') remove(ctx);
  else { installed(ctx); assertProfileList(profileList(), true); }
  console.log(JSON.stringify({ action, status: 'PASS', binary: HOST.binary, profile: HOST.profile,
    stockSha256: hash(ctx.stock), runtimeStacking: 'UNVERIFIED', containment: 'UNVERIFIED' }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
