import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { loadConfig, ConfigError } from '../dist/server/config.js';
import { createLogger } from '../dist/server/logger.js';

test('runs without credentials and accepts bounded local configuration', () => {
  assert.deepEqual(loadConfig({}), { host: '127.0.0.1', port: 3000, logLevel: 'info', fakeDelayMs: 350 });
  assert.deepEqual(loadConfig({ WJ_HOST: '::1', WJ_PORT: '4321', WJ_LOG_LEVEL: 'silent', WJ_FAKE_DELAY_MS: '0' }),
    { host: '::1', port: 4321, logLevel: 'silent', fakeDelayMs: 0 });
});

test('rejects bad configuration without copying raw values into the error', () => {
  for (const [key, value] of [
    ['WJ_PORT', '0'], ['WJ_PORT', '65536'], ['WJ_PORT', '1.5'], ['WJ_PORT', '1e3'], ['WJ_PORT', ''],
    ['WJ_HOST', '0.0.0.0'], ['WJ_FAKE_DELAY_MS', '-1'], ['WJ_FAKE_DELAY_MS', '5001'], ['WJ_LOG_LEVEL', 'private-secret'],
  ]) {
    assert.throws(() => loadConfig({ [key]: value }), (error) => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.fields, [key]);
      assert.equal(error.message, 'Invalid application configuration.');
      return true;
    });
  }
});

test('logs only allowed metadata and respects silent logging', () => {
  const lines = [];
  const log = createLogger('info', (line) => lines.push(line));
  log({ event: 'turn.finished', turnId: 'id', participantId: 'fake-a', status: 'completed', durationMs: 1,
    input: 'private-prompt', authorization: 'private-token', error: new Error('private-error') });
  createLogger('silent', (line) => lines.push(line))({ event: 'server.stopped' });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /private-/);
  assert.equal(JSON.parse(lines[0]).participantId, 'fake-a');
});

test('invalid startup exits nonzero and names the bad field without leaking its value', () => {
  const result = spawnSync(process.execPath, ['dist/server/main.js'], {
    encoding: 'utf8', env: { ...process.env, WJ_PORT: 'private-config-value' }, timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /invalid_config/);
  assert.match(result.stdout, /WJ_PORT/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-config-value/);
});
