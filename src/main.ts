import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { loadWorkspaceConfig } from './workspace/config.js';
import { Workspace } from './workspace/runtime.js';
import { createWorkspaceServer } from './http/workspace.js';

async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    createLogger('info')({ event: 'startup.failed', code: 'unsupported_node' });
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const app = new Workspace(loadWorkspaceConfig(), config.fakeDelayMs);
  const { server, closeStreams } = await createWorkspaceServer(app, log);
  try { await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  }); } catch (error) { await app.close(); throw error; }
  app.start();
  log({ event: 'server.started', host: config.host, port: config.port });
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log({ event: 'server.stopping', signal });
    const deadline = setTimeout(() => server.closeAllConnections(), 6000);
    deadline.unref();
    closeStreams();
    server.close(() => { void app.close().then(() => { clearTimeout(deadline); log({ event: 'server.stopped' }); }); });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

void main().catch((error: unknown) => {
  createLogger('info')(error instanceof ConfigError
    ? { event: 'startup.failed', code: 'invalid_config', fields: error.fields }
    : { event: 'startup.failed', code: 'listen_failed' });
  process.exitCode = 1;
});
