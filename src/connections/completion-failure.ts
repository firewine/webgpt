import type { Completion } from './providers.js';
import type { ProviderFinishReason } from '../workspace/model.js';
import { AppError } from '../workspace/util.js';

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
