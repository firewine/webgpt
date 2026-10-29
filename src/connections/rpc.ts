import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { AppError, object } from '../workspace/util.js';
export type RpcId = number | string;
export class RpcProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private buffer = '';
  private readonly pending = new Map<RpcId, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  onNotification: (method: string, params: Record<string, unknown>) => void = () => {};
  onRequest: (id: RpcId, method: string, params: Record<string, unknown>) => void = id => this.respond(id, null, { code: -32601, message: 'Unsupported request' });
  onClose: () => void = () => {};
  constructor(private readonly command: string[], private readonly cwd?: string, private readonly jsonrpc = true) {}
  start(): void {
    if (this.child) return;
    const executable = this.command[0]; if (!executable) throw new AppError('command_not_configured', 409);
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'DISPLAY', 'XAUTHORITY', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'CODEX_HOME']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const child = spawn(executable, this.command.slice(1), { ...(this.cwd ? { cwd: this.cwd } : {}), env, shell: false, stdio: 'pipe' });
    this.child = child; this.buffer = ''; const decoder = new StringDecoder('utf8');
    child.stderr.resume(); // do not forward provider/terminal secrets to the application's logs.
    child.stdin.on('error', () => { if (this.child === child) this.close(); });
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return;
      this.buffer += decoder.write(chunk);
      if (this.buffer.length > 4_000_000) { this.close(); return; }
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try { this.receive(object(JSON.parse(line) as unknown)); } catch { this.close(); return; }
      }
    });
    child.once('error', () => { if (this.child === child) this.disconnected(); });
    child.once('exit', () => { if (this.child === child) this.disconnected(); });
  }
  request(method: string, params: Record<string, unknown> = {}, timeout = 30_000): Promise<unknown> {
    this.start(); const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new AppError('rpc_unconfirmed', 502, true)); }, timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.send({ id: requestId, method, params }); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new AppError('rpc_unconfirmed', 502, true)); }
    });
  }
  notify(method: string, params: Record<string, unknown> = {}): void { this.send({ method, params }); }
  respond(id: RpcId, result: unknown, error?: { code: number; message: string }): void { this.send(error ? { id, error } : { id, result }); }
  private send(value: Record<string, unknown>): void {
    if (!this.child || this.child.killed || !this.child.stdin.writable) throw new AppError('rpc_disconnected', 502, true);
    this.child.stdin.write(`${JSON.stringify({ ...(this.jsonrpc ? { jsonrpc: '2.0' } : {}), ...value })}\n`);
  }
  private receive(message: Record<string, unknown>): void {
    const params = message.params ? object(message.params) : {};
    if (typeof message.method === 'string') {
      if (typeof message.id === 'number' || typeof message.id === 'string') this.onRequest(message.id, message.method, params);
      else this.onNotification(message.method, params);
      return;
    }
    if (typeof message.id !== 'number' && typeof message.id !== 'string') return;
    const pending = this.pending.get(message.id); if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new AppError('rpc_rejected', 502)); else pending.resolve(message.result);
  }
  private disconnected(): void {
    if (!this.child) return;
    this.child = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new AppError('rpc_disconnected', 502, true)); }
    this.pending.clear(); this.onClose();
  }
  close(): void { this.child?.kill('SIGTERM'); this.disconnected(); }
}
