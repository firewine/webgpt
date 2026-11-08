import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, writeSync, fchmodSync, ftruncateSync, fsyncSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { AppError } from '../workspace/util.js';

export const NATIVE_METADATA_DIRECTORIES = ['.agents', '.aws', '.codex', '.git'] as const;

export type WorkspaceProtectionBinding = { repoRoot: string; cwd: string; branch: string; head: string };
export type ProtectedFileBaseline = { path: string; digest: string; size: number; mode: number; dev: string; ino: string };
export type ProtectedManifest = {
  version: 1; jobId: string; sourceRoot: string; sourceCwd: string; branch: string; head: string;
  copyRoot: string; copyCwd: string; files: ProtectedFileBaseline[]; digest: string;
};
export type DraftFileChange = {
  path: string; beforeDigest: string | null; afterDigest: string | null; diff: string; before?: string; after?: string;
};
export type DraftInspection = {
  status: 'unchanged' | 'ready' | 'blocked'; reason: string | null; manifestDigest: string; diffDigest: string; files: DraftFileChange[];
};
export type ApplyReceipt = { path: string; beforeDigest: string; afterDigest: string; appliedAt: string };

const LIMIT = { file: 1_048_576, total: 33_554_432, files: 2000, metadata: 8_388_608, entries: 6000, depth: 64 };
const READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const DIRECTORY = READ | constants.O_DIRECTORY;
const DUP_DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK;
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
function fail(reason: string): never { throw new AppError('protected_workspace_' + reason, 409); }
const inside = (root: string, path: string): boolean => { const r = relative(root, path); return r === '' || r !== '..' && !r.startsWith('../') && !isAbsolute(r); };
const overlap = (a: string, b: string): boolean => inside(a, b) || inside(b, a);
const protectedName = (name: string): boolean => NATIVE_METADATA_DIRECTORIES.some(target => target === name) || /^(?:\.env.*|\.git.*|\.ssh|\.codex|\.gnupg|\.aws|\.azure|\.gcp|\.config|\.docker|\.kube|\.direnv|\.envrc|\.vscode|\.idea|node_modules|\.npmrc|\.yarnrc.*|\.pypirc|\.netrc|\.bashrc|\.zshrc|\.profile|credentials?(?:[._-].*)?|secrets?(?:[._-].*)?|vault|access[-_]token.*|master[-_]key.*|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore)|.*(?:credentials|service[-_]account)\.(?:json|ya?ml))$/i.test(name);
function relativePath(path: string, allowEmpty = false): void {
  if (typeof path !== 'string' || path.length > 1024 || path.split('/').length > LIMIT.depth || (!path && !allowEmpty) || isAbsolute(path) || /[\x00-\x1f\x7f\\]/.test(path) || path.split('/').some(p => p === '.' || p === '..' || !p && !!path)) fail('path_invalid');
}
function allowedPath(path: string, allowEmpty = false): void {
  relativePath(path, allowEmpty);
  if (path.split('/').some(protectedName)) fail('protected_path');
}
function absolutePath(path: string): void {
  if (typeof path !== 'string' || !isAbsolute(path) || path !== resolve(path) || /[\x00-\x1f\x7f\\]/.test(path)) fail('canonical_path_required');
}
type Identity = { dev: string; ino: string; mode: number };
type Stamp = Identity & { size: number; mtime: string; ctime: string };
type Anchors = Record<string, Identity>;
type ReadFile = { bytes: Buffer; stamp: Stamp };
type Repository = { branch: string; head: string; paths: string[]; metadata: Record<string, string> };
type RecordBody = { manifest: ProtectedManifest; anchors: Anchors; storageAnchors: Anchors; stamps: Record<string, Stamp>; directories: string[]; repository: Repository };
type Envelope = { body: RecordBody; seal: string };
const identity = (s: BigIntStats): Identity => ({ dev: s.dev.toString(), ino: s.ino.toString(), mode: Number(s.mode & 0o7777n) });
const stamp = (s: BigIntStats): Stamp => ({ ...identity(s), size: Number(s.size), mtime: s.mtimeNs.toString(), ctime: s.ctimeNs.toString() });
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const at = (fd: number, name = ''): string => '/proc/self/fd/' + fd + (name ? '/' + name : '');
function anchor(path: string, s: BigIntStats, anchors?: Anchors, capture = false): void {
  if (!s.isDirectory()) fail('directory_required');
  if (!anchors) return;
  if (anchors[path] && !equal(anchors[path], identity(s))) fail('directory_changed');
  if (capture) anchors[path] = identity(s);
}

// Linux lookups are relative to held directory descriptors. O_NOFOLLOW applies
// to every actual component; the only followed link is our own /proc/self/fd/N.
function openDirectory(path: string, anchors?: Anchors, capture = false, create = false): number {
  absolutePath(path);
  let fd = openSync('/', DIRECTORY); let current = '/';
  try {
    anchor(current, fstatSync(fd, { bigint: true }), anchors, capture);
    for (const part of path.split('/').filter(Boolean)) {
      if (create) { try { mkdirSync(at(fd, part), { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
      const next = openSync(at(fd, part), DIRECTORY); closeSync(fd); fd = next; current = join(current, part);
      anchor(current, fstatSync(fd, { bigint: true }), anchors, capture);
    }
    return fd;
  } catch (e) { closeSync(fd); throw e; }
}
function childDirectory(root: number, path: string, rootPath?: string, anchors?: Anchors, capture = false): number {
  relativePath(path, true);
  let fd = openSync(at(root), DUP_DIRECTORY); let current = rootPath;
  try {
    for (const part of path.split('/').filter(Boolean)) {
      const next = openSync(at(fd, part), DIRECTORY); closeSync(fd); fd = next;
      current = current === undefined ? undefined : join(current, part);
      if (current !== undefined) anchor(current, fstatSync(fd, { bigint: true }), anchors, capture);
    }
    return fd;
  } catch (e) { closeSync(fd); throw e; }
}
function regular(s: BigIntStats): void {
  if (!s.isFile() || s.nlink !== 1n || s.mode & 0o7000n) fail('regular_unaliased_file_required');
}
function readAt(root: number, path: string, max: number, rootPath?: string, anchors?: Anchors, capture = false): ReadFile {
  relativePath(path);
  const parent = childDirectory(root, dirname(path) === '.' ? '' : dirname(path), rootPath, anchors, capture);
  let fd: number | undefined; let check: number | undefined;
  try {
    const name = path.slice(path.lastIndexOf('/') + 1); fd = openSync(at(parent, name), READ);
    const s = fstatSync(fd, { bigint: true }); regular(s);
    if (s.size > BigInt(max)) fail('file_too_large');
    const bytes = Buffer.alloc(Number(s.size) + 1); let length = 0;
    while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, length); if (!n) break; length += n; }
    check = openSync(at(parent, name), READ); const current = fstatSync(check, { bigint: true }); regular(current);
    if (length !== Number(s.size) || !equal(stamp(s), stamp(fstatSync(fd, { bigint: true }))) || !equal(stamp(s), stamp(current))) fail('file_changed_during_read');
    return { bytes: bytes.subarray(0, length), stamp: stamp(s) };
  } finally { if (check !== undefined) closeSync(check); if (fd !== undefined) closeSync(fd); closeSync(parent); }
}
function text(bytes: Buffer): string {
  let result: string;
  try { result = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail('utf8_text_required'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result)) fail('utf8_text_required');
  return result;
}
function privateDirectory(fd: number): void {
  const s = fstatSync(fd, { bigint: true });
  if (!s.isDirectory() || Number(s.uid) !== process.getuid?.() || s.mode & 0o077n) fail('private_directory_required');
}
function createFile(root: number, path: string, bytes: Buffer, mode = 0o600): void {
  relativePath(path);
  const parent = childDirectory(root, dirname(path) === '.' ? '' : dirname(path));
  let fd: number | undefined;
  try {
    fd = openSync(at(parent, path.slice(path.lastIndexOf('/') + 1)), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, mode);
    let written = 0;
    while (written < bytes.length) { const n = writeSync(fd, bytes, written, bytes.length - written, written); if (!n) fail('short_write'); written += n; }
    fchmodSync(fd, mode); fsyncSync(fd);
  } finally { if (fd !== undefined) closeSync(fd); closeSync(parent); }
}
function makeDirectory(root: number, path: string): void {
  relativePath(path, true); let fd = openSync(at(root), DUP_DIRECTORY);
  try {
    for (const part of path.split('/').filter(Boolean)) {
      try { mkdirSync(at(fd, part), { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      const next = openSync(at(fd, part), DIRECTORY); closeSync(fd); fd = next; privateDirectory(fd);
    }
  } finally { closeSync(fd); }
}
function verifyAnchors(anchors: Anchors): void {
  for (const path of Object.keys(anchors)) { const fd = openDirectory(path, anchors); closeSync(fd); }
}

// Read the small local identity/index subset directly. No Git executable,
// hooks, includes, filters, user config, object history or credential helper run.
// Linked worktrees, split/sparse/v4 indexes and unusual config fail closed.
function repository(root: number, rootPath: string, anchors?: Anchors, capture = false): Repository {
  const metadata: Record<string, string> = {};
  const read = (path: string, max: number): Buffer => {
    const r = readAt(root, '.git/' + path, max, rootPath, anchors, capture); metadata[path] = hash(r.bytes); return r.bytes;
  };
  const config = text(read('config', 65_536));
  if (/^\s*\[\s*(?:include|includeif|filter|credential|alias|diff|merge|extensions|submodule)(?:\s|\])/im.test(config) || /^\s*(?:worktree|hookspath|fsmonitor|sshcommand|gitproxy|pager|editor)\s*=/im.test(config) || /^\s*bare\s*=\s*(?:true|1|yes)\s*$/im.test(config)) fail('unsafe_git_configuration');
  const headText = text(read('HEAD', 4096)); const match = /^ref: refs\/heads\/([A-Za-z0-9][A-Za-z0-9._/-]{0,199})\n?$/.exec(headText);
  const branch = match?.[1];
  if (!branch || branch.includes('..') || branch.includes('//') || branch.split('/').some(p => p.endsWith('.lock') || p.endsWith('.') || p.startsWith('.'))) fail('attached_branch_required');
  let head: string;
  try { head = text(read('refs/heads/' + branch, 128)).trim(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const packed = text(read('packed-refs', LIMIT.metadata));
    head = packed.split('\n').find(line => line.endsWith(' refs/heads/' + branch))?.split(' ')[0] ?? '';
  }
  if (!/^[a-f0-9]{40}$/.test(head)) fail('git_head_invalid');
  const index = read('index', LIMIT.metadata);
  return { branch, head, paths: indexPaths(index), metadata };
}
function indexPaths(bytes: Buffer): string[] {
  if (bytes.length < 32 || bytes.toString('ascii', 0, 4) !== 'DIRC' || ![2, 3].includes(bytes.readUInt32BE(4)) || !createHash('sha1').update(bytes.subarray(0, -20)).digest().equals(bytes.subarray(-20))) fail('git_index_unsupported');
  const count = bytes.readUInt32BE(8); if (count > LIMIT.files) fail('too_many_files');
  const paths: string[] = []; let offset = 12;
  for (let n = 0; n < count; n++) {
    const start = offset; if (offset + 62 >= bytes.length - 20) fail('git_index_invalid');
    const mode = bytes.readUInt32BE(offset + 24); const flags = bytes.readUInt16BE(offset + 60);
    if (flags & 0x7000) fail('git_index_unsupported');
    const end = bytes.indexOf(0, offset + 62); if (end < 0 || end >= bytes.length - 20) fail('git_index_invalid');
    const path = text(bytes.subarray(offset + 62, end)); relativePath(path);
    if (mode === 0o160000 || path.split('/').some(p => p.toLowerCase() === '.gitmodules')) fail('submodule_unsupported');
    if (mode !== 0o100644 && mode !== 0o100755 && !path.split('/').some(protectedName)) fail('git_index_link_or_special_file');
    paths.push(path); offset = start + Math.ceil((end + 1 - start) / 8) * 8;
    if (offset > bytes.length - 20) fail('git_index_invalid');
  }
  while (offset < bytes.length - 20) {
    if (offset + 8 > bytes.length - 20 || !/^[A-Z][A-Za-z0-9 ]{3}$/.test(bytes.toString('ascii', offset, offset + 4))) fail('git_index_unsupported');
    offset += 8 + bytes.readUInt32BE(offset + 4); if (offset > bytes.length - 20) fail('git_index_invalid');
  }
  if (new Set(paths).size !== paths.length) fail('git_index_invalid');
  return paths.sort();
}
function diff(path: string, before: string, after: string): string {
  const lines = (value: string, prefix: string): string[] => {
    if (!value) return [];
    const parts = value.split('\n'); if (value.endsWith('\n')) parts.pop();
    const result = parts.map(line => prefix + line + '\n');
    if (!value.endsWith('\n')) result.push('\\ No newline at end of file\n');
    return result;
  };
  const a = lines(before, '-'), b = lines(after, '+');
  const count = (value: string): number => value ? value.split('\n').length - (value.endsWith('\n') ? 1 : 0) : 0;
  return `--- a/${path}\n+++ b/${path}\n@@ -${before ? 1 : 0},${count(before)} +${after ? 1 : 0},${count(after)} @@\n` + a.join('') + b.join('');
}
function inspection(manifestDigest: string, status: DraftInspection['status'], reason: string | null, files: DraftFileChange[] = []): DraftInspection {
  return { status, reason, manifestDigest, diffDigest: hash(JSON.stringify({ manifestDigest, status, reason, files: files.map(({ path, beforeDigest, afterDigest }) => ({ path, beforeDigest, afterDigest })) })), files };
}

export class ProtectedWorkspaces {
  private readonly root: string;
  private readonly anchors: Anchors = {};
  private readonly key: Buffer;
  constructor(privateDirectoryPath: string) {
    if (process.platform !== 'linux') fail('platform_unsupported');
    absolutePath(privateDirectoryPath); this.root = privateDirectoryPath;
    const fd = openDirectory(this.root, this.anchors, true, true);
    try {
      privateDirectory(fd);
      try { createFile(fd, 'seal.key', randomBytes(32)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      const key = readAt(fd, 'seal.key', 32);
      if (key.bytes.length !== 32 || key.stamp.mode !== 0o600) fail('private_key_invalid');
      this.key = key.bytes; fsyncSync(fd); verifyAnchors(this.anchors);
    } finally { closeSync(fd); }
  }
  private openPrivate(): number {
    let fd: number | undefined;
    try {
      fd = openDirectory(this.root, this.anchors);
      privateDirectory(fd); const key = readAt(fd, 'seal.key', 32);
      if (key.stamp.mode !== 0o600 || !key.bytes.equals(this.key)) fail('private_key_changed');
      return fd;
    } catch (e) { if (fd !== undefined) closeSync(fd); if (e instanceof AppError) throw e; return fail('unavailable_or_link'); }
  }
  private jobName(jobId: string): string {
    if (typeof jobId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(jobId)) fail('job_id_invalid');
    return 'job-' + hash(jobId);
  }
  private seal(body: unknown): string { return createHmac('sha256', this.key).update(JSON.stringify(body)).digest('hex'); }
  private load(jobId: string, root: number): { body: RecordBody; job: number } {
    const job = childDirectory(root, this.jobName(jobId));
    try {
      privateDirectory(job); const raw = readAt(job, 'manifest.json', LIMIT.metadata);
      if (raw.stamp.mode !== 0o600) fail('manifest_tampered');
      const parsed: unknown = JSON.parse(text(raw.bytes)); const envelope = parsed as Envelope;
      if (!envelope?.body || typeof envelope.seal !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.seal) || !timingSafeEqual(Buffer.from(envelope.seal, 'hex'), Buffer.from(this.seal(envelope.body), 'hex'))) fail('manifest_tampered');
      const m = envelope.body.manifest; const { digest, ...unsigned } = m;
      if (m.version !== 1 || m.jobId !== jobId || m.copyRoot !== join(this.root, this.jobName(jobId), 'tree') || m.copyCwd !== join(m.copyRoot, relative(m.sourceRoot, m.sourceCwd)) || digest !== hash(JSON.stringify(unsigned))) fail('manifest_tampered');
      this.checkBinding({ repoRoot: m.sourceRoot, cwd: m.sourceCwd, branch: m.branch, head: m.head });
      if (!Array.isArray(m.files) || m.files.length > LIMIT.files || new Set(m.files.map(f => f.path)).size !== m.files.length || m.files.reduce((n, f) => n + f.size, 0) > LIMIT.total) fail('manifest_tampered');
      for (const file of m.files) { allowedPath(file.path); if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMIT.file || !/^[a-f0-9]{64}$/.test(file.digest)) fail('manifest_tampered'); }
      verifyAnchors(envelope.body.storageAnchors);
      return { body: envelope.body, job };
    } catch (e) { closeSync(job); throw e; }
  }
  private checkBinding(binding: WorkspaceProtectionBinding): void {
    absolutePath(binding.repoRoot); absolutePath(binding.cwd);
    const forbidden = [this.root, ...['.codex', '.ssh', '.gnupg', '.aws', '.azure', '.config'].map(p => join(homedir(), p)), '/proc', '/sys', '/dev'];
    if (!inside(binding.repoRoot, binding.cwd) || forbidden.some(p => overlap(p, binding.repoRoot)) || binding.repoRoot.split('/').some(protectedName)) fail('source_root_protected_or_overlapping');
    allowedPath(relative(binding.repoRoot, binding.cwd), true);
    if (typeof binding.branch !== 'string' || typeof binding.head !== 'string') fail('binding_invalid');
  }
  async prepare(jobId: string, binding: WorkspaceProtectionBinding): Promise<ProtectedManifest> {
    this.jobName(jobId); this.checkBinding(binding);
    const anchors: Anchors = {};
    let source: number | undefined; let storage: number | undefined; let job: number | undefined; let tree: number | undefined; let baseline: number | undefined;
    try {
      source = openDirectory(binding.repoRoot, anchors, true);
      const cwd = openDirectory(binding.cwd, anchors, true); closeSync(cwd);
      const repo = repository(source, binding.repoRoot, anchors, true);
      if (repo.branch !== binding.branch || repo.head !== binding.head) fail('binding_changed');
      storage = this.openPrivate(); const name = this.jobName(jobId);
      mkdirSync(at(storage, name), { mode: 0o700 }); job = childDirectory(storage, name); privateDirectory(job);
      makeDirectory(job, 'tree'); makeDirectory(job, 'baseline'); tree = childDirectory(job, 'tree'); baseline = childDirectory(job, 'baseline');
      const files: ProtectedFileBaseline[] = []; const stamps: Record<string, Stamp> = Object.create(null) as Record<string, Stamp>; const directories = new Set<string>(['']); let total = 0;
      const addDirectory = (path: string): void => {
        for (let p = path; p && p !== '.'; p = dirname(p)) directories.add(p);
        if (directories.size + files.length > LIMIT.entries) fail('copy_budget_exceeded');
      };
      addDirectory(relative(binding.repoRoot, binding.cwd));
      // Native bwrap needs these mount targets. Prepare private empty targets
      // before sealing, so its scaffold mkdir cannot add public-mode directories
      // to the captured tree. Their source contents are never copied.
      for (const parent of ['', relative(binding.repoRoot, binding.cwd)]) for (const name of NATIVE_METADATA_DIRECTORIES) addDirectory(parent ? parent + '/' + name : name);
      for (const path of repo.paths) {
        if (path.split('/').some(protectedName)) continue;
        allowedPath(path); const file = readAt(source, path, LIMIT.file, binding.repoRoot, anchors, true);
        try { text(file.bytes); } catch (e) { if (e instanceof AppError && e.code === 'protected_workspace_utf8_text_required') continue; throw e; }
        if ((total += file.bytes.length) > LIMIT.total || files.length >= LIMIT.files) fail('copy_budget_exceeded');
        const item: ProtectedFileBaseline = { path, digest: hash(file.bytes), size: file.bytes.length, mode: file.stamp.mode, dev: file.stamp.dev, ino: file.stamp.ino };
        files.push(item); stamps[path] = file.stamp; addDirectory(dirname(path));
        const parent = dirname(path) === '.' ? '' : dirname(path); makeDirectory(tree, parent);
        createFile(tree, path, file.bytes, item.mode); createFile(baseline, hash(path), file.bytes, 0o400);
      }
      for (const path of directories) makeDirectory(tree, path);
      // Validate the whole captured baseline again after copying, including
      // source ancestors and Git identity. A torn read never becomes a draft.
      if (!equal(repo, repository(source, binding.repoRoot, anchors))) fail('source_changed');
      for (const file of files) {
        const current = readAt(source, file.path, LIMIT.file, binding.repoRoot, anchors);
        if (hash(current.bytes) !== file.digest || !equal(current.stamp, stamps[file.path])) fail('source_changed');
      }
      verifyAnchors(anchors); verifyAnchors(this.anchors);
      const unsigned = { version: 1 as const, jobId, sourceRoot: binding.repoRoot, sourceCwd: binding.cwd, branch: repo.branch, head: repo.head,
        copyRoot: join(this.root, name, 'tree'), copyCwd: join(this.root, name, 'tree', relative(binding.repoRoot, binding.cwd)), files };
      const manifest: ProtectedManifest = { ...unsigned, digest: hash(JSON.stringify(unsigned)) };
      const storageAnchors: Anchors = { [join(this.root, name)]: identity(fstatSync(job, { bigint: true })),
        [manifest.copyRoot]: identity(fstatSync(tree, { bigint: true })), [join(this.root, name, 'baseline')]: identity(fstatSync(baseline, { bigint: true })) };
      const body: RecordBody = { manifest, anchors, storageAnchors, stamps, directories: [...directories].sort(), repository: repo };
      const manifestBytes = Buffer.from(JSON.stringify({ body, seal: this.seal(body) } satisfies Envelope));
      if (manifestBytes.length > LIMIT.metadata) fail('copy_budget_exceeded');
      createFile(job, 'manifest.json', manifestBytes);
      fsyncSync(job); fsyncSync(storage);
      verifyAnchors(storageAnchors); verifyAnchors(this.anchors);
      return structuredClone(manifest);
    } catch (e) { if (e instanceof AppError) throw e; return fail('unavailable_or_link'); }
    finally { if (baseline !== undefined) closeSync(baseline); if (tree !== undefined) closeSync(tree); if (job !== undefined) closeSync(job); if (storage !== undefined) closeSync(storage); if (source !== undefined) closeSync(source); }
  }
  manifest(jobId: string): ProtectedManifest {
    const root = this.openPrivate(); let job: number | undefined;
    try { const loaded = this.load(jobId, root); job = loaded.job; const result = structuredClone(loaded.body.manifest); verifyAnchors(this.anchors); return result; }
    catch (e) { if (e instanceof AppError) throw e; return fail('unavailable_or_link'); }
    finally { if (job !== undefined) closeSync(job); closeSync(root); }
  }
  private inspectRecord(body: RecordBody, job: number): DraftInspection {
    const m = body.manifest; const tree = childDirectory(job, 'tree'); let baseline: number | undefined;
    try {
      baseline = childDirectory(job, 'baseline');
      privateDirectory(tree); privateDirectory(baseline);
      const actual = new Map<string, ReadFile>(); const directories: string[] = []; const directoryStamps = new Map<string, Stamp>(); let entries = 0; let total = 0;
      const nativeTargets = new Set(['', relative(m.sourceRoot, m.sourceCwd)].flatMap(parent => NATIVE_METADATA_DIRECTORIES.map(name => parent ? parent + '/' + name : name)));
      const walk = (dir: number, path: string, depth: number): void => {
        if (depth > LIMIT.depth) fail('copy_budget_exceeded');
        privateDirectory(dir); const before = stamp(fstatSync(dir, { bigint: true })); directories.push(path); directoryStamps.set(path, before);
        if (before.mode !== 0o700) fail('copy_mode_changed');
        const listing = readdirSync(at(dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of listing) {
          if (++entries > LIMIT.entries) fail('copy_budget_exceeded');
          const next = path ? path + '/' + entry.name : entry.name;
          // Only known empty targets recorded in this sealed baseline qualify.
          // New contents, missing targets and mode changes keep failing closed.
          if (!(entry.isDirectory() && nativeTargets.has(next) && body.directories.includes(next))) allowedPath(next);
          if (entry.isDirectory()) { const child = childDirectory(dir, entry.name); try { walk(child, next, depth + 1); } finally { closeSync(child); } }
          else {
            if (!entry.isFile()) fail('copy_link_or_special_file');
            const file = readAt(tree, next, LIMIT.file); text(file.bytes); actual.set(next, file);
            if ((total += file.bytes.length) > LIMIT.total || actual.size > LIMIT.files) fail('copy_budget_exceeded');
          }
        }
        if (!equal(before, stamp(fstatSync(dir, { bigint: true })))) fail('copy_changed_during_inspection');
      };
      walk(tree, '', 0);
      const expectedPaths = m.files.map(f => f.path).sort(); const actualPaths = [...actual.keys()].sort();
      if (!equal(expectedPaths, actualPaths) || !equal(body.directories, directories.sort())) return inspection(m.digest, 'blocked', 'protected_workspace_copy_structure_changed');
      const files: DraftFileChange[] = [];
      for (const file of m.files) {
        const original = readAt(baseline, hash(file.path), LIMIT.file);
        if (original.stamp.mode !== 0o400 || hash(original.bytes) !== file.digest || original.bytes.length !== file.size) fail('baseline_tampered');
        const current = actual.get(file.path)!;
        if (current.stamp.mode !== file.mode) return inspection(m.digest, 'blocked', 'protected_workspace_copy_mode_changed');
        const afterDigest = hash(current.bytes);
        if (afterDigest !== file.digest) { const before = text(original.bytes), after = text(current.bytes); files.push({ path: file.path, beforeDigest: file.digest, afterDigest, diff: diff(file.path, before, after), before, after }); }
        const reread = readAt(tree, file.path, LIMIT.file);
        if (!equal(current.stamp, reread.stamp) || !current.bytes.equals(reread.bytes)) fail('copy_changed_during_inspection');
      }
      for (const [path, expected] of directoryStamps) {
        const fd = childDirectory(tree, path);
        try { if (!equal(stamp(fstatSync(fd, { bigint: true })), expected)) fail('copy_changed_during_inspection'); }
        finally { closeSync(fd); }
      }
      verifyAnchors(body.storageAnchors);
      if (files.length > 1) return inspection(m.digest, 'blocked', 'protected_workspace_exactly_one_file_required', files);
      return inspection(m.digest, files.length ? 'ready' : 'unchanged', null, files);
    } finally { closeSync(tree); if (baseline !== undefined) closeSync(baseline); }
  }
  private unattempted(job: number): void {
    try { readAt(job, 'apply-intent.json', LIMIT.metadata); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    fail('apply_already_attempted');
  }
  async inspect(jobId: string): Promise<DraftInspection> {
    let manifestDigest = ''; let root: number | undefined; let job: number | undefined;
    try {
      root = this.openPrivate(); const loaded = this.load(jobId, root); job = loaded.job; manifestDigest = loaded.body.manifest.digest;
      this.unattempted(job);
      const result = this.inspectRecord(loaded.body, job); verifyAnchors(this.anchors);
      // Reauthenticate persisted metadata after reading mutable draft files.
      const check = this.load(jobId, root); closeSync(check.job);
      if (!equal(check.body, loaded.body)) fail('manifest_tampered');
      return result;
    } catch (e) { return inspection(manifestDigest, 'blocked', e instanceof AppError ? e.code : 'protected_workspace_unavailable_or_link'); }
    finally { if (job !== undefined) closeSync(job); if (root !== undefined) closeSync(root); }
  }
  async apply(jobId: string, expectedDiffDigest: string, beforeWrite?: () => void): Promise<ApplyReceipt> {
    const root = this.openPrivate(); let job: number | undefined; let source: number | undefined; let parent: number | undefined; let target: number | undefined;
    let lease: string | undefined; let writing = false; let sourceTouched = false;
    try {
      const loaded = this.load(jobId, root); job = loaded.job; const { body } = loaded; const m = body.manifest;
      this.unattempted(job);
      const current = this.inspectRecord(body, job);
      if (current.status !== 'ready') fail('draft_not_ready');
      if (typeof expectedDiffDigest !== 'string' || current.diffDigest !== expectedDiffDigest) fail('stale_diff');
      source = openDirectory(m.sourceRoot, body.anchors);
      if (!equal(repository(source, m.sourceRoot, body.anchors), body.repository)) fail('source_repository_changed');
      for (const file of m.files) {
        const observed = readAt(source, file.path, LIMIT.file, m.sourceRoot, body.anchors);
        if (!equal(observed.stamp, body.stamps[file.path]) || hash(observed.bytes) !== file.digest) fail('source_changed');
      }
      verifyAnchors(body.anchors); verifyAnchors(body.storageAnchors); verifyAnchors(this.anchors);
      const check = this.load(jobId, root); closeSync(check.job); if (!equal(check.body, body)) fail('manifest_tampered');
      const change = current.files[0]!; const file = m.files.find(f => f.path === change.path)!; allowedPath(file.path);
      const leaseName = 'lease-' + hash(m.sourceRoot);
      const intent = { jobId, manifestDigest: m.digest, diffDigest: expectedDiffDigest, path: file.path, beforeDigest: file.digest, afterDigest: change.afterDigest, attemptedAt: new Date().toISOString() };
      const intentBytes = Buffer.from(JSON.stringify({ body: intent, seal: this.seal(intent) }));
      try { createFile(root, leaseName, intentBytes); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') fail('source_apply_lease_exists'); throw e; }
      lease = leaseName; fsyncSync(root);
      // Both records survive restart. In particular a partial write must never
      // be retried automatically, even by a second instance of this class.
      createFile(job, 'apply-intent.json', intentBytes); fsyncSync(job);
      parent = childDirectory(source, dirname(file.path) === '.' ? '' : dirname(file.path), m.sourceRoot, body.anchors);
      target = openSync(at(parent, file.path.slice(file.path.lastIndexOf('/') + 1)), constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const observed = readAt(source, file.path, LIMIT.file, m.sourceRoot, body.anchors);
      const held = fstatSync(target, { bigint: true }); regular(held);
      if (!equal(stamp(held), body.stamps[file.path]) || !equal(observed.stamp, stamp(held)) || hash(observed.bytes) !== file.digest) fail('source_changed');
      if (!equal(repository(source, m.sourceRoot, body.anchors), body.repository)) fail('source_repository_changed');
      verifyAnchors(body.anchors); verifyAnchors(body.storageAnchors); verifyAnchors(this.anchors);
      // Final comparison uses the SAME descriptor that will be written, without
      // an await boundary. This is a baseline check within the app's managed
      // single-writer boundary, NOT a kernel atomic CAS against external writers.
      // An uncooperative process can still write after this comparison. Detected
      // races/partial writes remain unconfirmed; never restore or auto retry.
      // An external write entirely inside the comparison/write gap can be lost
      // without detection, even when verification returns a receipt. The caller
      // must keep other source writers quiescent during this managed operation.
      const before = Buffer.alloc(file.size + 1); let length = 0;
      while (length < before.length) { const n = readSync(target, before, length, before.length - length, length); if (!n) break; length += n; }
      if (length !== file.size || hash(before.subarray(0, length)) !== file.digest || !equal(stamp(fstatSync(target, { bigint: true })), body.stamps[file.path])) fail('source_changed');
      const after = Buffer.from(change.after!, 'utf8');
      // The trusted guard must synchronously assert current binding, job, work
      // scope and durable parent intent; it must not mutate source files. Reject
      // accidentally asynchronous guards rather than writing before they settle.
      const guarded: unknown = beforeWrite?.();
      if (guarded instanceof Promise) { void guarded.catch(() => {}); fail('synchronous_guard_required'); }
      if (guarded !== null && typeof guarded === 'object' && 'then' in guarded) fail('synchronous_guard_required');
      writing = true; sourceTouched = true;
      let written = 0;
      while (written < after.length) { const n = writeSync(target, after, written, after.length - written, written); if (!n) fail('short_write'); written += n; }
      ftruncateSync(target, after.length); fsyncSync(target);
      const result = readAt(source, file.path, LIMIT.file, m.sourceRoot, body.anchors); const final = fstatSync(target, { bigint: true }); regular(final);
      if (final.dev.toString() !== file.dev || final.ino.toString() !== file.ino || Number(final.mode & 0o7777n) !== file.mode || !equal(result.stamp, stamp(final)) || !result.bytes.equals(after)) fail('post_write_verification_failed');
      if (!equal(repository(source, m.sourceRoot, body.anchors), body.repository)) fail('source_repository_changed');
      verifyAnchors(body.anchors); verifyAnchors(body.storageAnchors); verifyAnchors(this.anchors);
      const receipt: ApplyReceipt = { path: file.path, beforeDigest: file.digest, afterDigest: hash(after), appliedAt: new Date().toISOString() };
      createFile(job, 'apply-receipt.json', Buffer.from(JSON.stringify({ body: receipt, seal: this.seal(receipt) }))); fsyncSync(job); fsyncSync(parent);
      writing = false;
      return receipt;
    } catch (e) {
      if (writing) throw new AppError('protected_workspace_apply_unconfirmed', 409, true);
      if (e instanceof AppError) throw e;
      throw new AppError('protected_workspace_unavailable_or_link', 409);
    } finally {
      let cleanupFailed = false;
      for (const fd of [target, parent, source, job]) if (fd !== undefined) { try { closeSync(fd); } catch { cleanupFailed = true; } }
      // Keep the workspace lease after an unknown write until explicit parent
      // reconciliation. Removing it on an error would allow an automatic retry.
      if (lease !== undefined && !writing && !cleanupFailed) { try { unlinkSync(at(root, lease)); fsyncSync(root); } catch { cleanupFailed = true; } }
      try { closeSync(root); } catch { cleanupFailed = true; }
      if (cleanupFailed) throw new AppError(sourceTouched ? 'protected_workspace_apply_unconfirmed' : 'protected_workspace_unavailable_or_link', 409, sourceTouched);
    }
  }
}
