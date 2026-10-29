import type { Participant } from './types.js';

// Minimal PoC contract. Credential storage, streaming and durable receipts are
// deliberately left to the observed real-provider contracts in WJ-003~007.
export interface ProviderAdapter {
  readonly participants: readonly Participant[];
  complete(participant: Participant, input: string, signal: AbortSignal): Promise<{
    readonly completion: 'completed'; readonly text: string;
  }>;
}
