import type { DeepSeekService } from '../workspace/model.js';
import { AppError } from '../workspace/util.js';

// Provider prose can contain secrets or untrusted links. Retain only bounded,
// allowlisted diagnostics; never forward the raw body to state/logs/the browser.
export class ModelCatalogError extends AppError {
  constructor(code: string, readonly httpStatus: number, readonly providerCode?: string) { super(code, 502); }
}
export async function modelCatalogError(res: Response, service?: DeepSeekService | 'anthropic'): Promise<ModelCatalogError> {
  let providerCode: string | undefined; let verification = false; let workspace = false;
  const reader = res.body?.getReader();
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > 16_384) throw new Error('bounded model diagnostic'); chunks.push(value);
    }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (body && typeof body === 'object' && 'error' in body) {
      const error = body.error;
      if (error && typeof error === 'object') {
        if ('code' in error && typeof error.code === 'string' && ['permission_denied', 'invalid_api_key', 'insufficient_credits', 'rate_limit_exceeded'].includes(error.code)) providerCode = error.code;
        verification = service === 'coralbricks' && res.status === 403 && providerCode === 'permission_denied' && 'message' in error && typeof error.message === 'string' && /(?:provide a card|card on file)[\s\S]{0,100}verification/i.test(error.message);
        workspace = service === 'anthropic' && res.status === 400 && 'message' in error && typeof error.message === 'string' && /anthropic-workspace-id/.test(error.message);
      }
    }
  } catch { /* Keep the actual HTTP status if error JSON is absent/invalid/large. */ }
  finally { await reader?.cancel().catch(() => {}); }
  const code = workspace ? 'anthropic_workspace_required' : verification ? 'coralbricks_verification_required' : res.status === 401 ? 'auth_required' : res.status === 403 ? 'model_access_denied'
    : res.status === 429 ? providerCode === 'insufficient_credits' ? 'provider_credits_required' : 'model_rate_limited' : res.status === 404 ? 'model_catalog_not_found'
    : res.status >= 500 ? 'model_provider_unavailable' : 'model_discovery_failed';
  return new ModelCatalogError(code, res.status, providerCode);
}
