import type { ReasoningEffort, ProviderKind, Connection } from './model.js';
import { AppError } from './util.js';
export const reasoningEfforts: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
export const oauthKind = (kind: ProviderKind) => kind === 'openai-oauth' || kind === 'codex-oauth';
export function participantReasoning(c: Connection, modelId: string, value: unknown, fallback?: ReasoningEffort): { reasoningEffort?: ReasoningEffort } {
  if (oauthKind(c.kind)) return { reasoningEffort: modelEffort(c, modelId, value, fallback) };
  if (c.kind !== 'deepseek') { if (value !== undefined) throw new AppError(c.kind === 'anthropic' ? 'reasoning_requires_supported_model' : 'reasoning_requires_oauth', 409); return {}; }
  const effort = value === 'default' ? undefined : value === undefined ? fallback : value;
  if (effort === undefined) return {};
  if (typeof effort !== 'string' || !['none', 'low', 'high', 'max'].includes(effort)) throw new AppError('invalid_reasoning_effort');
  if (!c.models.find(m => m.id === modelId)?.reasoningEfforts?.includes(effort as ReasoningEffort)) throw new AppError('reasoning_effort_not_supported', 409);
  return { reasoningEffort: effort as ReasoningEffort };
}
export function modelEffort(c: Connection, modelId: string, value: unknown, fallback?: ReasoningEffort): ReasoningEffort {
  const effort = reasoningEffort(value, fallback);
  if (c.kind === 'codex-oauth' && !c.models.find(m => m.id === modelId)?.reasoningEfforts?.includes(effort)) throw new AppError('reasoning_effort_not_supported', 409);
  return effort;
}
export function reasoningEffort(value: unknown, fallback: ReasoningEffort = 'xhigh'): ReasoningEffort {
  if (value === undefined) value = fallback;
  if (typeof value !== 'string' || !reasoningEfforts.includes(value as ReasoningEffort)) throw new AppError('invalid_reasoning_effort');
  return value as ReasoningEffort;
}
