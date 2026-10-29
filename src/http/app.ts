import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DiagnosticError } from '../core/diagnostic.js';
import type { DiagnosticCore } from '../core/diagnostic.js';
import type { Logger } from '../logger.js';
import type { HealthResponse } from '../core/types.js';

const MAX_BODY_BYTES = 16 * 1024;
const WEB_ROOT = new URL('../../client/web/', import.meta.url);
const STATIC_FILES = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
] as const;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly publicMessage: string) { super(code); }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(new HttpError(413, 'body_too_large', '요청 크기가 제한을 초과했습니다.'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { reject(new HttpError(400, 'invalid_json', '올바른 JSON 요청이 필요합니다.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'request_interrupted', '요청 전송이 중단됐습니다.')));
  });
}

export async function createApp(core: DiagnosticCore, log: Logger) {
  // Fail at startup if the build is incomplete; never serve arbitrary disk paths.
  const assets = new Map(await Promise.all(STATIC_FILES.map(async ([path, file, type]) =>
    [path as string, { data: await readFile(new URL(file, WEB_ROOT)), type }] as const,
  )));
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    void route(req, res).catch((error: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      if (error instanceof HttpError) {
        res.setHeader('Connection', 'close');
        json(res, error.status, { error: { code: error.code, message: error.publicMessage } });
      } else if (error instanceof DiagnosticError) {
        const errors = {
          invalid_input: [400, '공백이 아닌 2,000자 이내 메시지를 입력하세요.'],
          unknown_participant: [404, '참여자를 찾을 수 없습니다.'],
          busy: [409, '다른 요청이 실행 중입니다. 완료 후 다시 시도하세요.'],
        } as const;
        const [status, message] = errors[error.code];
        json(res, status, { error: { code: error.code, message } });
      } else {
        log({ event: 'request.failed' });
        json(res, 500, { error: { code: 'internal_error', message: '요청을 처리하지 못했습니다.' } });
      }
    });
  });
  server.setTimeout(15_000, (socket) => socket.destroy());

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    if (isGet && assets.has(path)) {
      const asset = assets.get(path)!;
      res.writeHead(200, { 'Content-Type': asset.type });
      res.end(req.method === 'HEAD' ? undefined : asset.data);
      return;
    }
    if (isGet && path === '/health') {
      const health: HealthResponse = { status: 'ok', service: 'webjjoku', mode: 'fake', persistence: 'none' };
      json(res, 200, health);
      return;
    }
    if (isGet && path === '/api/participants') {
      json(res, 200, { participants: core.participants });
      return;
    }
    if (path !== '/api/turns') {
      throw new HttpError(404, 'not_found', '요청한 경로가 없습니다.');
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new HttpError(405, 'method_not_allowed', 'POST 요청이 필요합니다.');
    }
    // JSON only: a third-party HTML form cannot invoke the diagnostic runner.
    // WJ-002 must configure the trusted HTTPS proxy before remote use.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      throw new HttpError(403, 'origin_not_allowed', '같은 진단 화면에서 요청하세요.');
    }
    if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new HttpError(415, 'unsupported_media_type', 'application/json 요청이 필요합니다.');
    }
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || !('participantId' in body) || typeof body.participantId !== 'string'
      || !('input' in body) || typeof body.input !== 'string') {
      throw new HttpError(400, 'invalid_request', '참여자와 메시지를 확인하세요.');
    }
    const start = performance.now();
    const turn = await core.run(body.participantId, body.input, AbortSignal.timeout(10_000));
    log({ event: 'turn.finished', turnId: turn.id, participantId: turn.participantId, status: turn.status, durationMs: Math.round(performance.now() - start) });
    json(res, turn.status === 'completed' ? 200 : 502, { turn });
  }
  return server;
}
