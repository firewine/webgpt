import { randomUUID } from 'node:crypto';
import type { ProviderAdapter } from './provider.js';
import { MAX_INPUT_LENGTH } from './types.js';
import type { Turn } from './types.js';

export class DiagnosticError extends Error {
  constructor(readonly code: 'invalid_input' | 'unknown_participant' | 'busy') {
    super(code);
  }
}

export class DiagnosticCore {
  private active = false;

  constructor(private readonly adapter: ProviderAdapter) {}

  get participants() { return this.adapter.participants; }

  async run(participantId: string, input: string, signal: AbortSignal): Promise<Turn> {
    const text = input.trim();
    if (!text || input.length > MAX_INPUT_LENGTH) throw new DiagnosticError('invalid_input');
    const participant = this.participants.find((p) => p.id === participantId);
    if (!participant) throw new DiagnosticError('unknown_participant');
    if (this.active) throw new DiagnosticError('busy');
    this.active = true;
    const base = { id: randomUUID(), participantId, input: text, startedAt: new Date().toISOString() };
    try {
      signal.throwIfAborted();
      const response = await this.adapter.complete(participant, text, signal);
      signal.throwIfAborted();
      if (response.completion !== 'completed' || typeof response.text !== 'string') {
        throw new Error('Provider did not complete.');
      }
      return { ...base, finishedAt: new Date().toISOString(), status: 'completed', output: response.text, error: null };
    } catch {
      return { ...base, finishedAt: new Date().toISOString(), status: 'failed', output: null, error: {
        code: signal.aborted ? 'interrupted' : 'provider_failed',
        message: signal.aborted ? '실행이 중단되어 응답을 완료하지 못했습니다.' : '참여자의 응답을 완료하지 못했습니다.',
      } };
    } finally {
      this.active = false;
    }
  }
}
