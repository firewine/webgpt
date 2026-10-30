import { constants, openSync, closeSync, fstatSync, readSync, opendirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import type { BigIntStats } from 'node:fs';
import type { MaterialFile, MaterialPackage } from './model.js';
import { AppError, id, now, object, string, strings } from './util.js';

export const MATERIAL_LIMITS = { files: 8, fileBytes: 32_768, totalBytes: 65_536, directoryEntries: 100 };
const inside = (root: string, path: string) => { const r = relative(root, path); return r === '' || !r.startsWith('..') && !isAbsolute(r); };
const protectedName = (name: string) => /^(?:\.env.*|\.git|\.ssh|\.gnupg|\.aws|\.azure|\.codex|\.npmrc|\.pypirc|credentials?|secrets?|vault|access-token|master-key|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx)|.*(?:credentials|service-account)\.json)$/i.test(name);
const identity = (s: BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(':');

// Linux descriptor traversal: no component (including an allowlist root) may
// be a symlink. Each lookup is relative to an already opened directory inode.
// Reopen the full path after reading to detect replaced ancestors/files too.
function openPath(path: string): number {
  if (process.platform !== 'linux') throw new AppError('materials_platform_unsupported', 409);
  let fd = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const parts = path.split('/').filter(Boolean);
    for (const [index, part] of parts.entries()) {
      const next = openSync('/proc/self/fd/' + fd + '/' + part, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
        (index < parts.length - 1 ? constants.O_DIRECTORY : 0));
      closeSync(fd); fd = next;
    }
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

export class LocalMaterials {
  constructor(private readonly roots: string[], private readonly protectedPaths: string[]) {}
  private allowed(value: unknown): string {
    const raw = string(value, 2000);
    if (!isAbsolute(raw) || raw.includes('\0') || raw.split('/').includes('..')) throw new AppError('material_path_invalid');
    const path = resolve(raw);
    if (!this.roots.some(root => inside(resolve(root), path))) throw new AppError('material_path_not_allowed', 403);
    const boundaries = this.protectedPaths.flatMap(p => { try { return [resolve(p), realpathSync(p)]; } catch { return [resolve(p)]; } });
    if (path.split('/').some(protectedName) || boundaries.some(p => inside(p, path)) || ['/proc', '/sys', '/dev'].some(p => inside(p, path))) throw new AppError('material_path_protected', 403);
    return path;
  }
  private read(value: unknown): MaterialFile {
    const path = this.allowed(value); let fd: number | undefined; let check: number | undefined;
    try {
      fd = openPath(path); const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n) throw new AppError('material_regular_unlinked_file_required', 403);
      if (before.size > BigInt(MATERIAL_LIMITS.fileBytes)) throw new AppError('material_file_too_large', 413);
      const bytes = Buffer.alloc(Number(before.size) + 1); let count = 0;
      while (count < bytes.length) { const n = readSync(fd, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
      check = openPath(path);
      if (count !== Number(before.size) || identity(before) !== identity(fstatSync(fd, { bigint: true })) || identity(before) !== identity(fstatSync(check, { bigint: true }))) throw new AppError('material_changed', 409);
      const raw = bytes.subarray(0, count); let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); } catch { throw new AppError('material_utf8_required', 415); }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new AppError('material_text_required', 415);
      return { path, text, size: count, digest: createHash('sha256').update(raw).digest('hex'), observedAt: now(), excerpt: false, identity: identity(before) };
    } catch (error) { if (error instanceof AppError) throw error; throw new AppError('material_path_unavailable_or_link', 403); }
    finally { if (check !== undefined) closeSync(check); if (fd !== undefined) closeSync(fd); }
  }
  prepare(input: unknown): MaterialPackage {
    const body = object(input); const paths = strings(body.paths, MATERIAL_LIMITS.files);
    if (!paths.length || new Set(paths.map(p => resolve(p))).size !== paths.length) throw new AppError('material_selection_invalid');
    const files = paths.map(p => this.read(p));
    this.checkBudget(files);
    return { id: id('materials'), label: string(body.label, 100), createdAt: now(), files };
  }
  checkBudget(files: MaterialFile[]): void {
    if (files.length > MATERIAL_LIMITS.files || files.reduce((n, f) => n + f.size, 0) > MATERIAL_LIMITS.totalBytes) throw new AppError('material_package_too_large', 413);
  }
  verify(packages: MaterialPackage[]): void {
    this.checkBudget(packages.flatMap(p => p.files));
    for (const file of packages.flatMap(p => p.files)) {
      const current = this.read(file.path);
      if (current.identity !== file.identity || current.digest !== file.digest) throw new AppError('material_changed', 409);
    }
  }
  list(value: unknown) {
    const path = this.allowed(value); let fd: number | undefined;
    try {
      fd = openPath(path);
      if (!fstatSync(fd).isDirectory()) throw new AppError('material_directory_required');
      const directory = opendirSync('/proc/self/fd/' + fd); const entries: { name: string; directory: boolean }[] = [];
      try {
        let count = 0;
        for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
          if (++count > MATERIAL_LIMITS.directoryEntries) throw new AppError('material_directory_too_large', 413);
          if (!entry.isFile() && !entry.isDirectory()) continue;
          try { this.allowed(path + '/' + entry.name); } catch { continue; }
          entries.push({ name: entry.name, directory: entry.isDirectory() });
        }
      } finally { directory.closeSync(); }
      return { path, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
    } catch (error) { if (error instanceof AppError) throw error; throw new AppError('material_path_unavailable_or_link', 403); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
}

export function materialMetadata(p: MaterialPackage) {
  return { ...p, files: p.files.map(({ text: _text, identity: _identity, ...f }) => f) };
}
