import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticCore } from '../dist/server/core/diagnostic.js';
import { createApp } from '../dist/server/http/app.js';
import { FakeAdapter } from '../dist/server/providers/fake.js';

export async function fixture(t, { adapter = new FakeAdapter(0), log = () => {} } = {}) {
  const server = await createApp(new DiagnosticCore(adapter), log);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, server,
    post: (body, options = {}) => fetch(`${url}/api/turns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), ...options,
    }),
  };
}

export async function unusedPort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function startProcess(t, extraEnv = {}) {
  const port = await unusedPort();
  const stateDir = await mkdtemp(join(tmpdir(), 'wj-process-'));
  const child = spawn(process.execPath, ['dist/server/main.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, WJ_HOST: '127.0.0.1', WJ_PORT: String(port), WJ_LOG_LEVEL: 'info', WJ_FAKE_DELAY_MS: '30', WJ_STATE_DIR: stateDir,
      WJ_CHROME_PROFILE_DIR: join(stateDir, 'chrome'), WJ_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, WJ_SOURCE_FETCH: 'false',
      WJ_ACCESS_TOKEN: 'test-owner-key-never-used-outside-fixtures', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const exit = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exit;
    }
    await rm(stateDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${stdout} ${stderr}`)), 10_000);
    child.stdout.on('data', () => {
      if (stdout.includes('server.started')) { clearTimeout(timeout); resolve(); }
    });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Server exited: ${stdout} ${stderr}`)); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
  });
  return { child, exit, url: `http://127.0.0.1:${port}`, stdout: () => stdout, stderr: () => stderr };
}
