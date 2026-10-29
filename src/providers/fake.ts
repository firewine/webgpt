import { setTimeout } from 'node:timers/promises';
import type { ProviderAdapter } from '../core/provider.js';
import type { Participant } from '../core/types.js';

export class FakeAdapter implements ProviderAdapter {
  readonly participants: readonly Participant[] = Object.freeze([
    Object.freeze({ id: 'fake-a', label: '테스트 참여자 A', providerId: 'fake', modelId: 'fake-echo-v1', connectionId: null, isFake: true }),
    Object.freeze({ id: 'fake-b', label: '테스트 참여자 B', providerId: 'fake', modelId: 'fake-echo-v1', connectionId: null, isFake: true }),
  ]);

  constructor(private readonly delayMs: number) {}

  async complete(participant: Participant, input: string, signal: AbortSignal) {
    await setTimeout(this.delayMs, undefined, { signal });
    return {
      completion: 'completed' as const,
      text: `[모의 응답 · ${participant.label}]\n입력한 메시지를 정상적으로 받았습니다.\n\n${input}\n\n이 응답은 연결 확인용이며 실제 AI의 분석이나 검증 결과가 아닙니다.`,
    };
  }
}
