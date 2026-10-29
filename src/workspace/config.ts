import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ConfigError } from '../config.js';
export interface WorkspaceConfig {
  stateDir: string; origin: string; accessToken: string | undefined; turnTimeoutMs: number;
  chromeCommand: string[] | null; codexCommand: string[]; workspaceRoots: string[];
  noVncPort: number | null; sourceFetch: boolean; oauthPort: number;
  chromeProfileDir: string;
}
export function loadWorkspaceConfig(env: NodeJS.ProcessEnv = process.env): WorkspaceConfig {
  const errors: string[] = [];
  const origin = env.WJ_PUBLIC_ORIGIN ?? `http://${env.WJ_HOST === '::1' ? '[::1]' : '127.0.0.1'}:${env.WJ_PORT ?? '3000'}`;
  try {
    const u = new URL(origin);
    if (u.origin !== origin || u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))) errors.push('WJ_PUBLIC_ORIGIN');
  } catch { errors.push('WJ_PUBLIC_ORIGIN'); }
  const array = (key: string, fallback: string[]): string[] => {
    if (!env[key]) return fallback;
    try {
      const v: unknown = JSON.parse(env[key]);
      if (!Array.isArray(v) || !v.every(x => typeof x === 'string' && x.length > 0 && !x.includes('\0'))) throw new Error();
      return v as string[];
    } catch { errors.push(key); return fallback; }
  };
  const num = (key: string, fallback: number, min: number, max: number) => {
    const v = Number(env[key] ?? fallback);
    if (!Number.isInteger(v) || v < min || v > max) errors.push(key);
    return v;
  };
  const stateDir = env.WJ_STATE_DIR ?? join(homedir(), '.local', 'state', 'webjjoku');
  if (!isAbsolute(stateDir)) errors.push('WJ_STATE_DIR');
  const chromeProfileDir = env.WJ_CHROME_PROFILE_DIR ?? join(homedir(), '.local', 'share', 'webjjoku', 'chrome');
  if (!isAbsolute(chromeProfileDir)) errors.push('WJ_CHROME_PROFILE_DIR');
  if (env.WJ_ACCESS_TOKEN !== undefined && env.WJ_ACCESS_TOKEN.length < 32) errors.push('WJ_ACCESS_TOKEN');
  const chrome = array('WJ_CHROME_COMMAND', []);
  const codexCommand = array('WJ_CODEX_COMMAND', ['codex', 'app-server']);
  if (!codexCommand.length) errors.push('WJ_CODEX_COMMAND');
  const workspaceRoots = array('WJ_WORKSPACE_ROOTS', []);
  if (workspaceRoots.some(x => !isAbsolute(x))) errors.push('WJ_WORKSPACE_ROOTS');
  const turnTimeoutMs = num('WJ_TURN_TIMEOUT_MS', 300_000, 1000, 1_800_000);
  const oauthPort = num('WJ_OAUTH_PORT', 1455, 1024, 65535);
  const noVncPort = env.WJ_NOVNC_PORT ? num('WJ_NOVNC_PORT', 6080, 1024, 65535) : null;
  if (env.WJ_SOURCE_FETCH && !['true', 'false'].includes(env.WJ_SOURCE_FETCH)) errors.push('WJ_SOURCE_FETCH');
  if (errors.length) throw new ConfigError(errors);
  return { stateDir, origin, accessToken: env.WJ_ACCESS_TOKEN, turnTimeoutMs, chromeCommand: chrome.length ? chrome : null,
    codexCommand, workspaceRoots, noVncPort, sourceFetch: env.WJ_SOURCE_FETCH === 'true', oauthPort, chromeProfileDir };
}
