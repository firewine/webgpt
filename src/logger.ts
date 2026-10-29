type LogEvent =
  | { event: 'server.started'; host: string; port: number }
  | { event: 'server.stopping'; signal: string }
  | { event: 'server.stopped' }
  | { event: 'startup.failed'; code: 'invalid_config' | 'unsupported_node' | 'listen_failed'; fields?: readonly string[] }
  | { event: 'request.failed' }
  | { event: 'turn.finished'; turnId: string; participantId: string; status: string; durationMs: number };

export type Logger = (entry: LogEvent) => void;

// An allowlist, not arbitrary error/context serialization. Never log bodies,
// headers, credentials, environment values, provider responses or raw exceptions.
export function createLogger(level: 'info' | 'silent', write = (line: string) => process.stdout.write(line)): Logger {
  return (entry) => {
    if (level === 'silent') return;
    let fields: Record<string, unknown> = {};
    switch (entry.event) {
      case 'server.started': fields = { host: entry.host, port: entry.port }; break;
      case 'server.stopping': fields = { signal: entry.signal }; break;
      case 'startup.failed': fields = { code: entry.code, fields: entry.fields }; break;
      case 'turn.finished': fields = {
        turnId: entry.turnId, participantId: entry.participantId,
        status: entry.status, durationMs: entry.durationMs,
      }; break;
    }
    write(`${JSON.stringify({ time: new Date().toISOString(), event: entry.event, ...fields })}\n`);
  };
}
