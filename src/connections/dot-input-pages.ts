import type { DotRequest } from '../workspace/dot-mcp-model.js';
import { AppError } from '../workspace/util.js';

export interface DotInputPage {
  encoding: 'json'; pageIndex: number; pageCount: number; nextPage: number | null; text: string;
}
export const DOT_INPUT_PAGE_BYTES = 12_000;
// Preserve the existing MCP envelope; size both representations, not just text.
export function dotToolResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

export function dotInputPage(input: Pick<DotRequest, 'prompt' | 'history'>, index: number,
  project: (page: DotInputPage) => unknown): DotInputPage {
  if (!Number.isSafeInteger(index) || index < 0) throw new AppError('invalid_dot_input_page');
  const source = JSON.stringify({ prompt: input.prompt, history: input.history });
  const pages: string[] = [];
  // Worst-case pagination metadata makes boundaries independent of pageIndex.
  // Leave space for the JSON-RPC wrapper and ordinary client request IDs.
  const overhead = Buffer.byteLength(JSON.stringify(dotToolResult(project({ encoding: 'json',
    pageIndex: Number.MAX_SAFE_INTEGER, pageCount: Number.MAX_SAFE_INTEGER, nextPage: Number.MAX_SAFE_INTEGER, text: '' }))));
  const available = DOT_INPUT_PAGE_BYTES - 256 - overhead, costs = new Map<string, number>();
  let text = '', bytes = 0;
  // Each code point appears once in structuredContent and twice-escaped in content.
  // Iteration by code point keeps valid surrogate pairs on the same page.
  for (const character of source) {
    let cost = costs.get(character);
    if (cost === undefined) {
      const once = JSON.stringify(character).slice(1, -1);
      cost = Buffer.byteLength(once) + Buffer.byteLength(JSON.stringify(once)) - 2;
      costs.set(character, cost);
    }
    if (cost > available) throw new AppError('dot_input_page_too_large');
    if (bytes + cost > available) { pages.push(text); text = ''; bytes = 0; }
    text += character; bytes += cost;
  }
  if (text) pages.push(text);
  if (index >= pages.length) throw new AppError('invalid_dot_input_page');
  return { encoding: 'json', pageIndex: index, pageCount: pages.length, nextPage: index + 1 < pages.length ? index + 1 : null, text: pages[index]! };
}
