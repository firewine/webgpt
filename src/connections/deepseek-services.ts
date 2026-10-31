import { AppError } from '../workspace/util.js';
import type { DeepSeekService, ModelChoice, ReasoningEffort } from '../workspace/model.js';

const origins: Record<DeepSeekService, string> = {
  deepseek: 'https://api.deepseek.com',
  coralbricks: 'https://inference.coralbricks.ai/v1',
  river: 'https://api.river.ai/v1',
};
export function deepSeekService(value: unknown): DeepSeekService {
  const service = value ?? 'deepseek';
  if (typeof service !== 'string' || !Object.hasOwn(origins, service)) throw new AppError('invalid_api_service');
  return service as DeepSeekService;
}
export function deepSeekEndpoint(service: unknown, path: 'models' | 'chat/completions'): string {
  return origins[deepSeekService(service)] + '/' + path;
}
export function deepSeekReasoning(service: unknown, row: Record<string, unknown>): Pick<ModelChoice, 'reasoningEfforts' | 'reasoningSource'> {
  const selected = deepSeekService(service); let levels: unknown; let disable = false;
  if (selected === 'deepseek' && row.effort && typeof row.effort === 'object') { levels = (row.effort as Record<string, unknown>).supported_levels; disable = Array.isArray(levels) && levels.length > 0; }
  if (selected === 'coralbricks' && row.supports_reasoning === true && row.reasoning && typeof row.reasoning === 'object') {
    const r = row.reasoning as Record<string, unknown>; levels = r.supported_efforts;
    disable = r.mandatory === false && !!r.disable && typeof r.disable === 'object' && (r.disable as Record<string, unknown>).reasoning_effort === 'none';
  }
  // River's authenticated catalog currently omits reasoning metadata. Apply its
  // documented preset only to exact IDs in that catalog, never other families.
  // Source/observation: docs/reviews/deepseek-anthropic-impact-20261031.md.
  if (selected === 'river' && ['deepseek-ai/DeepSeek-V4.1-Flash', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'].includes(String(row.id))) return { reasoningEfforts: ['none', 'low', 'high', 'max'], reasoningSource: 'provider_docs' };
  if (!Array.isArray(levels)) return {};
  const allowed = [...new Set(levels.filter((v): v is ReasoningEffort => typeof v === 'string' && ['low', 'high', 'max'].includes(v)))];
  return allowed.length ? { reasoningEfforts: [...(disable ? ['none' as const] : []), ...allowed], reasoningSource: 'catalog' } : {};
}
export function deepSeekThinking(service: unknown, effort: ReasoningEffort | undefined): Record<string, unknown> {
  if (effort === undefined) return {};
  if (deepSeekService(service) !== 'deepseek') return { reasoning_effort: effort };
  return effort === 'none' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: effort };
}
