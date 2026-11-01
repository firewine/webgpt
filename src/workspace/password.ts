import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { WorkspaceState } from './model.js';
import { AppError, id, now } from './util.js';

type Credential = NonNullable<WorkspaceState['ownerPassword']>;
const options = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export function validatePasswordState(state: WorkspaceState): void {
  const c = state.ownerPassword;
  if (c !== undefined && (!c || c.scheme !== 'scrypt-v1' || typeof c.id !== 'string' || !c.id || typeof c.salt !== 'string' || !/^[a-f0-9]{64}$/.test(c.salt) || typeof c.hash !== 'string' || !/^[a-f0-9]{128}$/.test(c.hash) || typeof c.changedAt !== 'string' || !Number.isFinite(Date.parse(c.changedAt)))) throw new AppError('password_state_invalid', 503);
  const g = state.passwordSetup;
  if (g !== undefined && g !== null && (!g || typeof g.hash !== 'string' || !/^[a-f0-9]{64}$/.test(g.hash) || !Number.isSafeInteger(g.expiresAt) || g.expiresAt < 0 || g.credentialId !== null && (typeof g.credentialId !== 'string' || !g.credentialId))) throw new AppError('password_state_invalid', 503);
}
export function passwordValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024) throw new AppError('invalid_password');
  const password = value.normalize('NFC'); if ([...password].length < 15 || [...password].length > 128) throw new AppError('invalid_password');
  return password;
}
export function confirmedPassword(value: unknown, confirmation: unknown): string {
  if (typeof value !== 'string' || value !== confirmation) throw new AppError('password_mismatch');
  return passwordValue(value);
}
async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, 'hex'), 64, options, (error, key) => { if (error) reject(error); else resolve(key); }));
}
export async function createPassword(password: string): Promise<Credential> {
  const salt = randomBytes(32).toString('hex'), hash = (await derive(password, salt)).toString('hex');
  return { scheme: 'scrypt-v1', id: id('password'), salt, hash, changedAt: now() };
}
export async function verifyPassword(password: string, credential: Credential): Promise<boolean> {
  const key = await derive(password, credential.salt); return timingSafeEqual(key, Buffer.from(credential.hash, 'hex'));
}
