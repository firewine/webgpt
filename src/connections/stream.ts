import { AppError } from '../workspace/util.js';
export async function* sse(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new AppError('empty_stream', 502, true);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); break; }
      size += chunk.value.byteLength;
      if (size > 4 * 1024 * 1024) throw new AppError('response_too_large', 502, true);
      buffer += decoder.decode(chunk.value, { stream: true });
      // Preserve split CRLF boundaries across network chunks.
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
      if (buffer.length > 1_000_000) throw new AppError('invalid_stream_frame', 502, true);
    }
    if (buffer.trim()) throw new AppError('truncated_stream', 502, true);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
