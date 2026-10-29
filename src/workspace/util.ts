import { createHash, randomUUID } from 'node:crypto';
export class AppError extends Error {
  constructor(readonly code: string, readonly status = 400, readonly uncertain = false) { super(code); }
}
export const id = (prefix: string): string => `${prefix}_${randomUUID()}`;
export const now = (): string => new Date().toISOString();
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_object');
  return value as Record<string, unknown>;
}
export function string(value: unknown, max = 2000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new AppError('invalid_text');
  return value.trim();
}
export function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new AppError('invalid_number');
  return value;
}
export function strings(value: unknown, max = 20): string[] {
  if (!Array.isArray(value) || value.length > max) throw new AppError('invalid_list');
  return value.map(v => string(v));
}
export function code(error: unknown): string { return error instanceof AppError ? error.code : 'operation_failed'; }
