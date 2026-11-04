import type { Completion } from './providers.js';
import type { ProviderFinishReason } from '../workspace/model.js';
import { AppError, digest } from '../workspace/util.js';

// Diagnostic output is separate from the existing failure/state contract. Never
// retain provider prose, input, reasoning, credentials or remote response IDs.
export function responsesFailureDiagnostic(provider: 'openai-oauth' | 'codex-oauth', requestId: string, event: Record<string, unknown>) {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const response = record(event.response), error = record(response.error), envelopeError = record(event.error);
  const select = (value: unknown, allowed: readonly string[]) => value === null || value === undefined ? null : typeof value === 'string' && allowed.includes(value) ? value : 'other';
  return { event: 'provider.response_not_completed', provider, requestDigest: digest(requestId),
    streamEvent: select(event.type, ['response.completed', 'response.failed', 'response.incomplete', 'error']),
    responseStatus: select(response.status, ['failed', 'incomplete', 'cancelled', 'in_progress', 'queued', 'completed']),
    providerErrorCode: select(error.code ?? envelopeError.code ?? event.code, ['server_error', 'rate_limit_exceeded', 'context_length_exceeded', 'invalid_prompt', 'invalid_request_error', 'insufficient_quota', 'model_not_found', 'unsupported_value', 'content_policy_violation']),
    incompleteReason: select(record(response.incomplete_details).reason, ['max_output_tokens', 'max_messages', 'content_filter', 'steered']) };
}

// Keep only protocol enums and reported counts, never provider prose, tool
// arguments or reasoning content. This is evidence of failure, not a reply.
export class CompletionFailure extends AppError {
  readonly finishReason: ProviderFinishReason | null;
  constructor(code: 'response_not_completed' | 'stream_unconfirmed', reason: unknown, readonly usage: Completion['usage'], uncertain = false) {
    super(code, 502, uncertain);
    this.finishReason = reason === null || reason === undefined ? null : typeof reason === 'string' && ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(reason) ? reason as ProviderFinishReason : 'other';
  }
}
export function failureObservation(error: unknown): { providerFinishReason?: ProviderFinishReason; usage?: Completion['usage'] } {
  return error instanceof CompletionFailure ? { ...(error.finishReason ? { providerFinishReason: error.finishReason } : {}), usage: error.usage } : {};
}
