import { AppError } from '../workspace/util.js';
import type { DeepSeekService } from '../workspace/model.js';

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
