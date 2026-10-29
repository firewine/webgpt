export const MAX_INPUT_LENGTH = 2000;

export interface Participant {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly connectionId: string | null;
  readonly isFake: boolean;
}

interface TurnBase {
  readonly id: string;
  readonly participantId: string;
  readonly input: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export type Turn = TurnBase & (
  | { readonly status: 'completed'; readonly output: string; readonly error: null }
  | { readonly status: 'failed'; readonly output: null; readonly error: {
    readonly code: 'provider_failed' | 'interrupted'; readonly message: string;
  } }
);

export interface HealthResponse {
  readonly status: 'ok';
  readonly service: 'webjjoku';
  readonly mode: 'fake';
  readonly persistence: 'none';
}
