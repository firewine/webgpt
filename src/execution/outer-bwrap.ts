import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

export const OUTER_BWRAP = '/usr/local/libexec/webjjoku/bwrap';
const PROFILE = '/etc/apparmor.d/webjjoku-outer-bwrap';
const error = (reason: string): never => { throw new Error('execution_isolation_unverified: outer_' + reason); };
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function trusted(path: string, file = true): string {
  if (realpathSync(path) !== path) error('canonical_path_required');
  const s = lstatSync(path);
  if (s.uid !== 0 || s.mode & 0o022 || (file ? !s.isFile() || s.nlink !== 1 : !s.isDirectory())) error('root_owned_path_required');
  if (file) for (let p = dirname(path); p !== '/'; p = dirname(p)) trusted(p, false);
  return `${s.dev}:${s.ino}:${s.mode}:${s.uid}:${s.gid}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
}

/** A bounded read is required: AppArmor's revision fd waits for a policy change
 * after its first record, so readFile/cat-to-EOF would hang the execution gate. */
function policyRevision(): string {
  const fd = openSync('/sys/kernel/security/apparmor/revision', constants.O_RDONLY);
  try {
    const bytes = Buffer.alloc(64); const n = readSync(fd, bytes, 0, bytes.length, 0);
    const value = bytes.subarray(0, n).toString('ascii').trim();
    if (!/^\d+$/.test(value)) error('policy_revision_required');
    return value;
  } finally { closeSync(fd); }
}

/** This does not prove containment. It pins the reviewed host inputs before the
 * real nested canary, and invalidates a proof after policy/package replacement. */
export function outerIdentity(path: string): string {
  if (path !== OUTER_BWRAP) error('fixed_path_required');
  const outer = trusted(path); const stock = trusted('/usr/bin/bwrap'); const policy = trusted(PROFILE);
  if ((lstatSync(path).mode & 0o7777) !== 0o750) error('mode_required');
  const data = readFileSync(path), original = readFileSync('/usr/bin/bwrap');
  if (data.length < 4 || !data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || !data.equals(original)) error('packaged_binary_required');
  trusted('/usr/sbin/getcap');
  if (execFileSync('/usr/sbin/getcap', ['-n', path], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeout: 2000 }).trim()) error('file_capabilities_forbidden');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = fstatSync(fd); if (s.ino !== lstatSync(path).ino || s.uid !== 0) error('binary_changed'); }
  finally { closeSync(fd); }
  return JSON.stringify([outer, stock, hash(data), policy, hash(readFileSync(PROFILE)), policyRevision()]);
}

/** No dynamic-loader, Node preload, or caller-selected bwrap is inherited. */
export function isolationEnvironment(): NodeJS.ProcessEnv {
  return { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
}
