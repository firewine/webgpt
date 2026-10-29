import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initialState } from './model.js';
import type { DurableEvent, WorkspaceState } from './model.js';
import { AppError, digest, now } from './util.js';

type EventInput = Omit<DurableEvent, 'id' | 'at'>;
export class Store {
  private readonly db: DatabaseSync;
  private readonly lockPath: string;
  private closed = false;
  readonly listeners = new Set<(event: DurableEvent) => void>();
  readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    this.lockPath = join(this.directory, 'runtime.lock');
    try { writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const lock = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { pid: number; host: string };
      if (lock.host !== hostname() || !Number.isInteger(lock.pid) || lock.pid <= 0) throw new AppError('state_locked', 409);
      try { process.kill(lock.pid, 0); throw new AppError('state_locked', 409); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe; }
      unlinkSync(this.lockPath);
      writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 });
    }
    try {
      const path = join(this.directory, 'workspace.sqlite');
      this.db = new DatabaseSync(path);
      chmodSync(path, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
      if (version > 1) throw new AppError('unsupported_schema', 500);
      this.db.exec(`CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, discussion_id TEXT, at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
        PRAGMA user_version=1;`);
      this.db.prepare('INSERT OR IGNORE INTO state VALUES (1, ?)').run(JSON.stringify(initialState(`urn:uuid:${randomUUID()}`)));
    } catch (error) { unlinkSync(this.lockPath); throw error; }
  }
  read(): WorkspaceState {
    const row = this.db.prepare('SELECT data FROM state WHERE id=1').get();
    return JSON.parse(String(row?.data)) as WorkspaceState;
  }
  cursor(): number { return Number(this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get()?.id); }
  subscribe(listener: (event: DurableEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  events(after: number, limit = 500): DurableEvent[] {
    return this.db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT ?').all(after, limit).map(row => ({
      id: Number(row.id), type: String(row.type), discussionId: row.discussion_id === null ? null : String(row.discussion_id),
      at: String(row.at), data: JSON.parse(String(row.data)) as unknown,
    }));
  }
  transact<T>(fn: (state: WorkspaceState, emit: (event: EventInput) => void) => T, command?: { id: string; input: unknown }): T {
    const events: DurableEvent[] = [];
    const hash = command ? digest(JSON.stringify(command.input)) : '';
    this.db.exec('BEGIN IMMEDIATE');
    let result: T;
    try {
      if (command) {
        const previous = this.db.prepare('SELECT digest, result FROM commands WHERE id=?').get(command.id);
        if (previous) {
          if (previous.digest !== hash) throw new AppError('idempotency_conflict', 409);
          this.db.exec('COMMIT');
          return JSON.parse(String(previous.result)) as T;
        }
      }
      const state = this.read();
      result = fn(state, event => {
        const at = now();
        const row = this.db.prepare('INSERT INTO events(type, discussion_id, at, data) VALUES (?, ?, ?, ?)')
          .run(event.type, event.discussionId, at, JSON.stringify(event.data));
        events.push({ ...event, at, id: Number(row.lastInsertRowid) });
      });
      this.db.prepare('UPDATE state SET data=? WHERE id=1').run(JSON.stringify(state));
      if (command) this.db.prepare('INSERT INTO commands VALUES (?, ?, ?)').run(command.id, hash, JSON.stringify(result ?? null));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    for (const event of events) for (const listener of this.listeners) { try { listener(event); } catch { /* committed journal is authoritative */ } }
    return result;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.listeners.clear(); this.db.close(); unlinkSync(this.lockPath);
  }
}
