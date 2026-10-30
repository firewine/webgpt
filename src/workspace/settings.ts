import type { ReasoningEffort } from './model.js';
import { AppError } from './util.js';
export const reasoningEfforts: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
export function reasoningEffort(value: unknown, fallback: ReasoningEffort = 'xhigh'): ReasoningEffort {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !reasoningEfforts.includes(value as ReasoningEffort)) throw new AppError('invalid_reasoning_effort');
  return value as ReasoningEffort;
}
