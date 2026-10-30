import { setTimeout as delay } from 'node:timers/promises';
import type { CompletionInput, Providers } from '../connections/providers.js';
import { id } from './util.js';

// Only registered fake participants use this fixture envelope. Real transports
// and their auth/receipt rules are delegated without substitution.
export class FakeResidentCompletion {
  constructor(private readonly providers: Pick<Providers, 'complete'>, private readonly delayMs = 80) {}
  async complete(input: CompletionInput) {
    if (input.participant.kind !== 'fake') return this.providers.complete(input);
    input.hooks.dispatched(); const receipt = id('fake_resident'); input.hooks.receipt(receipt);
    await delay(this.delayMs, undefined, { signal: input.signal });
    const text = JSON.stringify({ version: 1, action: 'say', text: '[모의 대화 · 실제 AI/사실 검증 아님] ' + input.participant.label + ': 공개 대화의 근거와 이견을 다시 검토합니다.', replyTo: null, mentions: [], claims: [], reviews: [], verifications: [], uncertainty: ['실제 계정/자료/업무를 실행하지 않은 fixture입니다.'], proposals: [] });
    input.hooks.delta(text); return { text, receipt, usage: null };
  }
}
