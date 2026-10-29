export interface Config {
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly logLevel: 'info' | 'silent';
  readonly fakeDelayMs: number;
}

export class ConfigError extends Error {
  constructor(readonly fields: readonly string[]) {
    super('Invalid application configuration.');
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const errors: string[] = [];
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      errors.push(key);
    }
    return value;
  };
  const host = env.WJ_HOST ?? '127.0.0.1';
  const logLevel = env.WJ_LOG_LEVEL ?? 'info';
  if (host !== '127.0.0.1' && host !== '::1') errors.push('WJ_HOST');
  if (logLevel !== 'info' && logLevel !== 'silent') errors.push('WJ_LOG_LEVEL');
  const port = integer('WJ_PORT', 3000, 1, 65535);
  const fakeDelayMs = integer('WJ_FAKE_DELAY_MS', 350, 0, 5000);
  if (errors.length > 0) throw new ConfigError(errors);
  return { host: host as Config['host'], port, logLevel: logLevel as Config['logLevel'], fakeDelayMs };
}
