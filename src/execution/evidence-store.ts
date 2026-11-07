import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { redactOutput } from './output-policy.js';

export const EVIDENCE_MAX_BYTES = 16 * 1024 * 1024;
export const EVIDENCE_MAX_RECORDS = 4096;
export const EVIDENCE_PAGE_BYTES = 16 * 1024;
const PAGE_TEXT_BYTES = 12 * 1024; // JSON-escaped text; reserve room for the entire response envelope.
const MAX_METADATA_BYTES = 8192;
const NOFOLLOW = constants.O_NOFOLLOW;

export interface ExecutionEvidenceDescriptor {
  version: 1;
  artifactId: string;
  jobId: string;
  digest: string;
  byteLength: number;
  pageCount: number;
  complete: boolean;
  reason: string | null;
}
export interface ExecutionEvidencePage extends ExecutionEvidenceDescriptor {
  pageIndex: number;
  nextPage: number | null;
  text: string;
}
type Metadata = ExecutionEvidenceDescriptor & { state: 'open' | 'complete' | 'incomplete'; records: number; owner: string };
type Snapshot = { metadata: Metadata; descriptor: ExecutionEvidenceDescriptor; raw: Buffer | null; ranges: [number, number][]; stat: Stats | null };
class CaptureFault extends Error { constructor(readonly reason: string) { super(reason); } }
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
function fail(code: string): never { throw new Error(`evidence_${code}`); }
function existsError(error: unknown, code: string): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === code; }

function jobKey(jobId: string): string {
  if (typeof jobId !== 'string' || !/^[a-z\d][a-z\d_-]{0,127}$/i.test(jobId)) fail('invalid_job_id');
  return `ev_${hash(jobId)}`;
}
function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o700 || (process.getuid && stat.uid !== process.getuid())) throw new CaptureFault('unsafe-directory');
}
function privateFile(stat: Stats): void {
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600 || (process.getuid && stat.uid !== process.getuid())) throw new CaptureFault('unsafe-file');
}
function readBounded(fd: number, limit: number): { raw: Buffer; stat: Stats } {
  const stat = fstatSync(fd); privateFile(stat);
  if (stat.size > limit) throw new CaptureFault('resource-limit');
  const bytes = Buffer.alloc(stat.size + 1);
  let length = 0;
  while (length < bytes.length) {
    const count = readSync(fd, bytes, length, bytes.length - length, length);
    if (!count) break;
    length += count;
  }
  const after = fstatSync(fd); privateFile(after);
  if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new CaptureFault('capture-changed');
  return { raw: bytes.subarray(0, length), stat };
}
function readPrivate(path: string, limit: number): { raw: Buffer; stat: Stats } {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try { return readBounded(fd, limit); } finally { closeSync(fd); }
}
function writeAll(fd: number, bytes: Buffer): void {
  let written = 0;
  while (written < bytes.length) {
    const count = writeSync(fd, bytes, written, bytes.length - written);
    if (!count) throw new CaptureFault('capture-write-failed');
    written += count;
  }
  fsyncSync(fd);
}
function createPrivate(path: string, bytes: Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
  try { fchmodSync(fd, 0o600); writeAll(fd, bytes); } finally { closeSync(fd); }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** UTF-8 offsets, budgeted by their size INSIDE JSON, independent of descriptor/status changes. */
function pageRanges(raw: Buffer): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0, offset = 0, size = 0;
  while (offset < raw.length) {
    const byte = raw[offset]!;
    const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
    const cost = byte === 0x22 || byte === 0x5c || [8, 9, 10, 12, 13].includes(byte) ? 2 : byte < 0x20 ? 6 : width;
    if (size + cost > PAGE_TEXT_BYTES) { ranges.push([start, offset]); start = offset; size = 0; }
    size += cost; offset += width;
  }
  if (offset > start) ranges.push([start, offset]);
  return ranges;
}

/** Validate before JSON.stringify: no dropped fields, getters, toJSON coercion, cycles or unbounded trees. */
function serialize(value: unknown): Buffer {
  let budget = EVIDENCE_MAX_BYTES - 1, nodes = 0;
  const ancestors = new Set<object>();
  const spend = (amount: number): void => { budget -= amount; if (budget < 0) throw new CaptureFault('resource-limit'); };
  const string = (text: string): void => {
    spend(2 + Buffer.byteLength(text));
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) spend(1);
      else if (code < 32) spend(5);
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) i++;
      else if (code >= 0xd800 && code <= 0xdfff) spend(3); // JSON escapes lone surrogates, UTF-8 would replace them.
    }
  };
  const visit = (input: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 64) throw new CaptureFault('resource-limit');
    if (input === null) { spend(4); return; }
    if (typeof input === 'string') { string(input); return; }
    if (typeof input === 'boolean') { spend(input ? 4 : 5); return; }
    if (typeof input === 'number' && Number.isFinite(input)) { spend(String(input).length); return; }
    if (typeof input !== 'object') throw new CaptureFault('invalid-payload');
    if (ancestors.has(input)) throw new CaptureFault('invalid-payload');
    if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new CaptureFault('invalid-payload');
    const toJSON = Object.getOwnPropertyDescriptor(input, 'toJSON');
    if (toJSON && (!('value' in toJSON) || typeof toJSON.value === 'function')) throw new CaptureFault('invalid-payload');
    ancestors.add(input); spend(2);
    const fields = Object.getOwnPropertyDescriptors(input);
    if (Array.isArray(input)) {
      if (input.length > 100_000) throw new CaptureFault('resource-limit');
      for (let i = 0; i < input.length; i++) {
        const field = fields[String(i)];
        if (!field || !('value' in field)) throw new CaptureFault('invalid-payload');
        if (i) spend(1); visit(field.value, depth + 1);
      }
      if (Object.keys(input).length !== input.length) throw new CaptureFault('invalid-payload');
    } else {
      let count = 0;
      for (const [key, field] of Object.entries(fields)) {
        if (!field.enumerable) continue;
        if (!('value' in field)) throw new CaptureFault('invalid-payload');
        if (count++) spend(1); string(key); spend(1); visit(field.value, depth + 1);
      }
    }
    if (Object.getOwnPropertySymbols(input).length) throw new CaptureFault('invalid-payload');
    ancestors.delete(input);
  };
  visit(value, 0);
  const raw = Buffer.from(JSON.stringify(value) + '\n');
  if (raw.length > EVIDENCE_MAX_BYTES) throw new CaptureFault('resource-limit');
  return raw;
}

/**
 * Synchronous PRIVATE NDJSON capture. The directory is a trusted app-state subdirectory, never a
 * request parameter. Only an owner-authenticated JOB-scoped route may call page(); its text is RAW.
 * General MCP/UI/report output must instead use output-policy. Digests/lengths refer to raw NDJSON,
 * never to a redacted preview. append payloads must be losslessly JSON-representable data.
 *
 * begin is exclusive, including after restart: existing raw logs are NEVER truncated/reused.
 * Disconnects/gaps call incomplete(). Restarted open logs are permanently incomplete; a terminal
 * snapshot cannot repair them. Only this instance's uninterrupted begin/append/finish can complete.
 * Per-job byte/record/tree limits seal an incomplete prefix; they never silently truncate a message.
 * Metadata is fsynced after raw. Any crash between those writes fails digest/length validation.
 */
export class ExecutionEvidenceStore {
  private readonly directory: string;
  private readonly owner = randomUUID();
  private readonly active = new Set<string>();
  constructor(directory: string, private readonly secrets: () => string[] = () => []) {
    if (typeof directory !== 'string' || !directory.trim()) fail('invalid_directory');
    this.directory = resolve(directory);
    if (this.directory === parse(this.directory).root) fail('invalid_directory');
    try {
      let current = parse(this.directory).root;
      for (const part of this.directory.slice(current.length).split('/').filter(Boolean)) {
        current = join(current, part);
        try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if (!existsError(error, 'EEXIST')) throw error; }
        const stat = lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CaptureFault('unsafe-directory');
      }
      const fd = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW);
      try {
        if (process.getuid && fstatSync(fd).uid !== process.getuid()) throw new CaptureFault('unsafe-directory');
        fchmodSync(fd, 0o700); fsyncSync(fd);
      } finally { closeSync(fd); }
      privateDirectory(this.directory);
    } catch { fail('private_directory_required'); }
  }
  private paths(jobId: string): { artifactId: string; directory: string; raw: string; metadata: string; failure: string } {
    const artifactId = jobKey(jobId), directory = join(this.directory, artifactId);
    return { artifactId, directory, raw: join(directory, 'raw.ndjson'), metadata: join(directory, 'metadata.json'), failure: join(directory, 'failure.json') };
  }
  private check(directory: string): void {
    // Also recheck ancestors: a caller may not swap in a symlink after construction.
    let current = parse(this.directory).root;
    for (const part of this.directory.slice(current.length).split('/').filter(Boolean)) {
      current = join(current, part); const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CaptureFault('unsafe-directory');
    }
    privateDirectory(this.directory); privateDirectory(directory);
  }
  private reason(reason: string): string {
    let safe: string;
    try { safe = redactOutput(reason, this.secrets()); } catch { return 'capture-incomplete'; }
    safe = safe.replaceAll(this.directory, '[path]').replace(/(?:[a-z]:[\\/]|\/(?!\/))[^\s"'<>]*/gi, '[path]');
    return safe.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 256).trim() || 'capture-incomplete';
  }
  private descriptor(metadata: Metadata): ExecutionEvidenceDescriptor {
    const { version, artifactId, jobId, digest, byteLength, pageCount, complete, reason } = metadata;
    return { version, artifactId, jobId, digest, byteLength, pageCount, complete, reason: reason === null ? null : this.reason(reason) };
  }
  private save(jobId: string, metadata: Metadata): void {
    const paths = this.paths(jobId); this.check(paths.directory);
    const temporary = join(paths.directory, `metadata-${randomUUID()}.tmp`);
    createPrivate(temporary, Buffer.from(JSON.stringify(metadata)));
    renameSync(temporary, paths.metadata); syncDirectory(paths.directory);
  }
  private base(jobId: string): Metadata {
    return { version: 1, artifactId: jobKey(jobId), jobId, digest: hash(''), byteLength: 0, pageCount: 0, complete: false, reason: null, state: 'open', records: 0, owner: this.owner };
  }
  private valid(value: unknown, jobId: string): value is Metadata {
    if (!value || typeof value !== 'object') return false;
    const row = value as Metadata;
    return row.version === 1 && row.artifactId === jobKey(jobId) && row.jobId === jobId && typeof row.digest === 'string' && /^[a-f\d]{64}$/.test(row.digest)
      && Number.isSafeInteger(row.byteLength) && row.byteLength >= 0 && row.byteLength <= EVIDENCE_MAX_BYTES
      && Number.isSafeInteger(row.pageCount) && row.pageCount >= 0 && row.pageCount <= EVIDENCE_MAX_BYTES
      && Number.isSafeInteger(row.records) && row.records >= 0 && row.records <= EVIDENCE_MAX_RECORDS
      && typeof row.owner === 'string' && row.owner.length <= 128 && typeof row.complete === 'boolean'
      && ['open', 'complete', 'incomplete'].includes(row.state) && row.complete === (row.state === 'complete')
      && (row.reason === null || (typeof row.reason === 'string' && row.reason.length <= 256))
      && (row.state === 'incomplete' ? typeof row.reason === 'string' && row.reason.length > 0 : row.reason === null);
  }
  private broken(jobId: string, metadata: Metadata, reason: string): Snapshot {
    const paths = this.paths(jobId);
    const bad = { ...metadata, complete: false, state: 'incomplete' as const, reason };
    this.active.delete(jobId);
    // An exclusive tombstone makes observed corruption permanent, even if bytes are later restored.
    try { this.check(paths.directory); createPrivate(paths.failure, Buffer.from(JSON.stringify({ version: 1, reason }))); syncDirectory(paths.directory); } catch { /* Failure still returns incomplete; no raw bytes are ever replaced. */ }
    return { metadata: bad, descriptor: this.descriptor(bad), raw: null, ranges: [], stat: null };
  }
  private load(jobId: string): Snapshot {
    const paths = this.paths(jobId);
    try { this.check(paths.directory); } catch (error) {
      if (existsError(error, 'ENOENT')) fail('not_found');
      fail('unsafe_artifact');
    }
    let metadata = this.base(jobId);
    try {
      const value: unknown = JSON.parse(readPrivate(paths.metadata, MAX_METADATA_BYTES).raw.toString('utf8'));
      if (!this.valid(value, jobId)) return this.broken(jobId, metadata, 'metadata-invalid');
      metadata = value;
    } catch { return this.broken(jobId, metadata, 'metadata-invalid'); }
    try {
      const failure = readPrivate(paths.failure, MAX_METADATA_BYTES);
      let reason = 'capture-invalid';
      try { const value = JSON.parse(failure.raw.toString('utf8')); if (typeof value.reason === 'string') reason = this.reason(value.reason); } catch { /* Fail closed. */ }
      return this.broken(jobId, metadata, reason);
    } catch (error) { if (!existsError(error, 'ENOENT')) return this.broken(jobId, metadata, 'capture-invalid'); }
    let raw: Buffer, stat: Stats;
    try { ({ raw, stat } = readPrivate(paths.raw, EVIDENCE_MAX_BYTES)); }
    catch (error) { return this.broken(jobId, metadata, existsError(error, 'ENOENT') ? 'raw-missing' : error instanceof CaptureFault ? error.reason : 'raw-unreadable'); }
    if (raw.length !== metadata.byteLength || hash(raw) !== metadata.digest) return this.broken(jobId, metadata, 'digest-mismatch');
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
      if (raw.length && !text.endsWith('\n')) throw new CaptureFault('partial-record');
      const lines = text.length ? text.slice(0, -1).split('\n') : [];
      if (lines.length !== metadata.records || lines.length > EVIDENCE_MAX_RECORDS) throw new CaptureFault('record-gap');
      for (let i = 0; i < lines.length; i++) {
        const row: unknown = JSON.parse(lines[i]!);
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new CaptureFault('record-invalid');
        const entry = row as Record<string, unknown>;
        if (entry.version !== 1 || entry.jobId !== jobId || entry.sequence !== i || typeof entry.channel !== 'string' || !entry.channel.length || entry.channel.length > 256 || !Object.hasOwn(entry, 'payload') || Object.keys(entry).length !== 5) throw new CaptureFault('record-gap');
      }
    } catch (error) { return this.broken(jobId, metadata, error instanceof CaptureFault ? error.reason : 'record-invalid'); }
    const ranges = pageRanges(raw);
    if (ranges.length !== metadata.pageCount) return this.broken(jobId, metadata, 'page-count-mismatch');
    if (metadata.state === 'open' && (!this.active.has(jobId) || metadata.owner !== this.owner)) {
      metadata = { ...metadata, state: 'incomplete', complete: false, reason: 'capture-interrupted' };
      try { this.save(jobId, metadata); } catch { return this.broken(jobId, metadata, 'capture-write-failed'); }
    }
    const descriptor = this.descriptor(metadata);
    if (metadata.state === 'open') descriptor.reason = 'capture-in-progress';
    return { metadata, descriptor, raw, ranges, stat };
  }
  private seal(jobId: string, snapshot: Snapshot, reason: string): ExecutionEvidenceDescriptor {
    if (!snapshot.raw) return snapshot.descriptor;
    if (snapshot.metadata.state === 'incomplete') return snapshot.descriptor;
    const metadata: Metadata = { ...snapshot.metadata, complete: false, state: 'incomplete', reason: this.reason(reason) };
    this.active.delete(jobId);
    try { this.save(jobId, metadata); return this.descriptor(metadata); }
    catch { return this.broken(jobId, metadata, 'capture-write-failed').descriptor; }
  }
  begin(jobId: string): ExecutionEvidenceDescriptor {
    const paths = this.paths(jobId);
    try { this.check(this.directory); mkdirSync(paths.directory, { mode: 0o700 }); }
    catch (error) { if (existsError(error, 'EEXIST')) fail('already_exists'); fail('private_directory_required'); }
    const metadata = this.base(jobId);
    try {
      createPrivate(paths.raw, Buffer.alloc(0)); this.save(jobId, metadata); syncDirectory(this.directory);
      this.active.add(jobId);
      return { ...this.descriptor(metadata), reason: 'capture-in-progress' };
    } catch { fail('capture_create_failed'); }
  }
  append(jobId: string, channel: string, payload: unknown): ExecutionEvidenceDescriptor {
    const snapshot = this.load(jobId);
    if (!snapshot.raw || snapshot.metadata.state === 'incomplete') return snapshot.descriptor;
    if (snapshot.metadata.state === 'complete') return this.seal(jobId, snapshot, 'append-after-finish');
    if (typeof channel !== 'string' || !channel.length || channel.length > 256) return this.seal(jobId, snapshot, 'invalid-channel');
    if (snapshot.metadata.records >= EVIDENCE_MAX_RECORDS) return this.seal(jobId, snapshot, 'resource-limit');
    let line: Buffer;
    try { line = serialize({ version: 1, jobId, sequence: snapshot.metadata.records, channel, payload }); }
    catch (error) { return this.seal(jobId, snapshot, error instanceof CaptureFault ? error.reason : 'invalid-payload'); }
    if (snapshot.raw.length + line.length > EVIDENCE_MAX_BYTES) return this.seal(jobId, snapshot, 'resource-limit');
    const paths = this.paths(jobId);
    try {
      this.check(paths.directory);
      const fd = openSync(paths.raw, constants.O_WRONLY | constants.O_APPEND | NOFOLLOW);
      try {
        const stat = fstatSync(fd); privateFile(stat);
        if (stat.ino !== snapshot.stat!.ino || stat.dev !== snapshot.stat!.dev || stat.size !== snapshot.raw.length || stat.mtimeMs !== snapshot.stat!.mtimeMs || stat.ctimeMs !== snapshot.stat!.ctimeMs) throw new CaptureFault('capture-changed');
        writeAll(fd, line);
      } finally { closeSync(fd); }
      const raw = Buffer.concat([snapshot.raw, line]);
      const metadata: Metadata = { ...snapshot.metadata, digest: hash(raw), byteLength: raw.length, pageCount: pageRanges(raw).length, records: snapshot.metadata.records + 1 };
      this.save(jobId, metadata);
      return { ...this.descriptor(metadata), reason: 'capture-in-progress' };
    } catch { return this.broken(jobId, snapshot.metadata, 'capture-write-failed').descriptor; }
  }
  finish(jobId: string): ExecutionEvidenceDescriptor {
    const snapshot = this.load(jobId);
    if (!snapshot.raw || snapshot.metadata.state !== 'open') return snapshot.descriptor;
    if (!snapshot.metadata.records) return this.seal(jobId, snapshot, 'empty-capture');
    const metadata: Metadata = { ...snapshot.metadata, state: 'complete', complete: true, reason: null };
    try { this.save(jobId, metadata); this.active.delete(jobId); return this.descriptor(metadata); }
    catch { return this.broken(jobId, metadata, 'capture-write-failed').descriptor; }
  }
  incomplete(jobId: string, reason: string): ExecutionEvidenceDescriptor { return this.seal(jobId, this.load(jobId), typeof reason === 'string' ? reason : 'capture-incomplete'); }
  describe(jobId: string): ExecutionEvidenceDescriptor { return this.load(jobId).descriptor; }
  page(jobId: string, index: number): ExecutionEvidencePage {
    if (!Number.isSafeInteger(index) || index < 0) fail('invalid_page');
    const snapshot = this.load(jobId);
    if (!snapshot.raw) fail('integrity_rejected');
    const range = snapshot.ranges[index]; if (!range) fail('page_not_found');
    const result: ExecutionEvidencePage = { ...snapshot.descriptor, pageIndex: index, nextPage: index + 1 < snapshot.ranges.length ? index + 1 : null, text: snapshot.raw.subarray(range[0], range[1]).toString('utf8') };
    if (Buffer.byteLength(JSON.stringify(result)) > EVIDENCE_PAGE_BYTES) fail('page_size_exceeded');
    return result;
  }
}
