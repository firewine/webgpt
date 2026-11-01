import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { Store } from '../dist/server/workspace/store.js';
import { Vault } from '../dist/server/workspace/vault.js';
import { Workspace } from '../dist/server/workspace/runtime.js';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
import { createWorkspaceServer } from '../dist/server/http/workspace.js';
import { unusedPort } from './helpers.mjs';
export const ownerKey = 'fixture-only-private-owner-access-key-123456';
export async function storage(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-state-')); const store = new Store(directory); const vault = new Vault(join(directory, 'credentials'));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); }); return { store, vault, directory };
}
export async function workspace(t, extra = {}, runtimeOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wj-app-')); const port = await unusedPort();
  const config = loadWorkspaceConfig({ WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'), WJ_ACCESS_TOKEN: ownerKey, WJ_PORT: String(port), WJ_PUBLIC_ORIGIN: `http://127.0.0.1:${port}` });
  const app = new Workspace({ ...config, ...extra }, 2, runtimeOptions);
  // Existing provider/UI fixtures start with an already configured owner. Real
  // scrypt setup/login is exercised separately with passwordUnset=true.
  if (!runtimeOptions.passwordUnset) app.store.transact(s => { s.ownerPassword = { scheme: 'scrypt-v1', id: 'fixture-owner-password', salt: '11'.repeat(32), hash: '00'.repeat(64), changedAt: new Date().toISOString() }; });
  const http = await createWorkspaceServer(app, () => {}); http.server.listen(port, '127.0.0.1'); await once(http.server, 'listening'); app.start();
  t.after(async () => { http.closeStreams(); await new Promise(resolve => { http.server.close(resolve); http.server.closeAllConnections(); }); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const api = async (path, data, options = {}) => fetch(`${config.origin}${path}`, { headers: { Authorization: `Bearer ${ownerKey}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }), ...(options.headers ?? {}) },
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }), ...Object.fromEntries(Object.entries(options).filter(([k]) => k !== 'headers')) });
  return { app, http, api, url: config.origin, directory };
}
export async function until(fn, timeout = 5000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(10); } throw new Error('Condition not reached before deadline'); }
export const topic = { topic: 'Ubuntu 서버의 개인 AI 작업실 구성', participantIds: ['fake-a', 'fake-b'], limits: { maxRequests: 24 } };
export function response(prompt, participant, { verify = 'review' } = {}) {
  const data = JSON.parse(prompt.split('\n\n').find(p => p.startsWith('{"topic":')));
  const assigned = data.assignedClaimIds; return JSON.stringify({ text: `${participant.label}: 근거를 검토한 의견`, claims: [{ text: `${participant.id}의 주장`, assumptions: ['별도 검증 필요'] }],
    reviews: assigned.map(claimId => ({ claimId, stance: 'challenge', reason: '대안과 실패 조건도 확인해야 합니다.' })),
    verifications: prompt.includes('· cross_review ·') ? assigned.map(claimId => ({ claimId, method: verify, url: verify === 'source' ? 'https://example.com/evidence' : '', question: '조건을 실제로 검증하세요.' })) : [], uncertainty: ['알려지지 않은 조건'] });
}
