export interface DiscoveryPage { pageId: number; url: string; title: string; profile: string }
export interface DiscoveryResult {
  id: string | null; page: DiscoveryPage; presetId: string; presetVersion: string; observedAt: string;
  status: 'ready' | 'blocked' | 'unsupported'; reason: string | null;
  identityText: string | null; agentLabel: string | null; threadValue: string | null;
  draftPresent: boolean; busy: boolean; expiresAt: string | null;
}
