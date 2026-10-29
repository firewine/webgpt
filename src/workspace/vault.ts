import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, digest } from './util.js';

// Credentials never enter the discussion database, snapshots or logs. The key
// and ciphertext remain on the owning server; disk/backup access is privileged.
export class Vault {
  private readonly key: Buffer;
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const path = join(directory, 'master.key');
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    chmodSync(path, 0o600); this.key = readFileSync(path);
    if (this.key.length !== 32) throw new AppError('invalid_vault_key', 500);
  }
  put(name: string, value: unknown): void {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(name));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const path = join(this.directory, `${digest(name)}.enc`); const tmp = `${path}.${randomBytes(8).toString('hex')}`;
    writeFileSync(tmp, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600, flag: 'wx', flush: true });
    renameSync(tmp, path);
  }
  get<T>(name: string): T | null {
    let data: Buffer;
    try { data = readFileSync(join(this.directory, `${digest(name)}.enc`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(name)); cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')) as T;
  }
  remove(name: string): void {
    try { unlinkSync(join(this.directory, `${digest(name)}.enc`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
