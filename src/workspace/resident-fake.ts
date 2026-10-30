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
    if (input.prompt.startsWith('웹쫀쿠 상주 업무')) {
      const task = JSON.parse(input.prompt.split('\n\n').find(s => s.startsWith('{"taskId":'))!) as { taskId: string; taskVersion: number; attemptId: string; purpose: string; acceptance: { text: string; check: { value?: string } }[]; report: { digest: string } | null };
      const review = task.purpose === 'review';
      const text = JSON.stringify({ version: 1, action: 'say', text: '[모의 업무 · 실제 AI/코드 실행 아님] ' + (review ? '산출물과 지정된 문구 검사를 독립 검토했습니다.' : task.acceptance.map(a => a.check.value ?? a.text).join('\n')), replyTo: null, mentions: [], claims: [], reviews: [], verifications: [], uncertainty: ['모의 산출물입니다.'],
        proposals: [{ kind: review ? 'work_review' : 'work_report', payload: { version: 1, taskId: task.taskId, taskVersion: task.taskVersion, attemptId: task.attemptId, ...(review ? { reportDigest: task.report!.digest, decision: 'accept', reason: '모의 산출물의 서버 문구 검사와 공개 원문을 검토했습니다.' } : { summary: '모의 분석 산출물', blockers: [] }) } }] });
      input.hooks.delta(text); return { text, receipt, usage: null };
    }
    const text = JSON.stringify({ version: 1, action: 'say', text: '[모의 대화 · 실제 AI/사실 검증 아님] ' + input.participant.label + ': 공개 대화의 근거와 이견을 다시 검토합니다.', replyTo: null, mentions: [], claims: [], reviews: [], verifications: [], uncertainty: ['실제 계정/자료/업무를 실행하지 않은 fixture입니다.'], proposals: [] });
    input.hooks.delta(text); return { text, receipt, usage: null };
  }
}
