/** Public output is deliberately separate from the PRIVATE, lossless evidence log. */
export const OUTPUT_REDACTED = '[REDACTED]';
type Secrets = readonly string[] | (() => readonly string[]);
type Span = { start: number; end: number };
const MAX_SECRET_CHARS = 65_536;
const MAX_PREVIEW_CHARS = 1_000_000;

function literals(secrets: readonly string[]): string[] {
  return [...new Set(secrets.filter(value => typeof value === 'string' && value.length > 0))];
}

function escapePattern(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hexPattern(value: string): string { return value.replace(/[a-f]/gi, char => `[${char.toLowerCase()}${char.toUpperCase()}]`); }
function percentPattern(value: string): string {
  return value.split(/(%[\da-f]{2})/gi).map(part => /^%[\da-f]{2}$/i.test(part) ? `%${hexPattern(part.slice(1))}` : escapePattern(part)).join('');
}
function jsonEscape(value: string): string { return JSON.stringify(value).slice(1, -1); }

/** Include mixed JSON unicode escapes, rather than only the all-escaped spelling. */
function jsonPattern(secret: string): string {
  return secret.split('').map(char => {
    const choices = new Set([escapePattern(char), escapePattern(jsonEscape(char)), `\\\\u${hexPattern(char.charCodeAt(0).toString(16).padStart(4, '0'))}`]);
    if (char === '/') choices.add('\\\\/');
    return `(?:${[...choices].join('|')})`;
  }).join('');
}

function knownPatterns(secret: string): string[] {
  // encodeURIComponent rejects lone surrogates. JSON can still represent them losslessly.
  const variants = new Set([secret, jsonEscape(secret), jsonEscape(jsonEscape(secret)), secret.replaceAll('/', '\\/')]);
  try {
    const encoded = encodeURIComponent(secret);
    variants.add(encoded); variants.add(encodeURI(secret)); variants.add(encodeURIComponent(encoded));
    variants.add(new URLSearchParams({ v: secret }).toString().slice(2));
  } catch { /* JSON/literal variants remain valid. */ }
  variants.add([...Buffer.from(secret)].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''));
  const base64 = Buffer.from(secret).toString('base64');
  for (const value of [base64, base64.replace(/=+$/, ''), Buffer.from(secret).toString('base64url')]) {
    variants.add(value); variants.add(value.replaceAll('/', '\\/')); variants.add(encodeURIComponent(value));
  }
  return [...variants].filter(Boolean).map(percentPattern).concat(jsonPattern(secret));
}

const TOKEN_PATTERNS = [
  /\b(?:sk|rk|pk|sess)[-_][a-z\d_-]{8,}/gi,
  /\b(?:gh[pousr]_[a-z\d]{12,}|github_pat_[a-z\d_]{12,}|xox[baprs]-[a-z\d-]{8,})/gi,
  /\b(?:AKIA|ASIA)[A-Z\d]{16}\b/g,
  /\beyJ[a-z\d_-]+\.[a-z\d_-]+\.[a-z\d_-]+/gi,
  /\b(?:bearer|basic)\s+[a-z\d._~+\/-]+=*/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token|authorization)["']?\s*[:=]\s*(?:"(?:\\[\s\S]|[^"\\])*(?:"|\\$|$)|'(?:\\[\s\S]|[^'\\])*(?:'|\\$|$)|[^\s,;}]+)/gi,
  // Opaque credentials without a recognizable vendor prefix.
  /\b(?=[a-z\d_+\/-]{32,}={0,2}(?![a-z\d_+\/-]))(?=[a-z\d_+\/-]*[a-z])(?=[a-z\d_+\/-]*\d)[a-z\d_+\/-]{32,}={0,2}/gi,
];

function spans(text: string, secrets: readonly string[]): Span[] {
  const found: Span[] = [];
  const patterns = secrets.flatMap(knownPatterns).map(pattern => ({ pattern: new RegExp(pattern, 'g'), overlap: true }))
    .concat(TOKEN_PATTERNS.map(pattern => ({ pattern, overlap: false })));
  for (const { pattern, overlap } of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.push({ start: match.index, end: match.index + match[0].length });
      // Overlapping literals must also be removed (e.g. secret "aba" in "ababa").
      if (overlap) pattern.lastIndex = match.index + 1;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of found) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

function render(text: string, redactions: Span[], end = text.length): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const span of redactions) {
    if (span.start >= end) break;
    parts.push(text.slice(cursor, span.start), OUTPUT_REDACTED);
    cursor = Math.min(span.end, end);
  }
  parts.push(text.slice(cursor, end));
  return parts.join('');
}

/** Redact literals, JSON/URL/Base64 spellings, and recognizable credentials. No credential discovery occurs. */
export function redactOutput(text: string, secrets: readonly string[] = []): string {
  const known = literals(secrets);
  if (known.reduce((size, value) => size + value.length, 0) > MAX_SECRET_CHARS) return OUTPUT_REDACTED;
  return render(text, spans(text, known));
}

/** Copy structured output without stringifying numeric/boolean/null command and exit metadata. */
export function safeOutput<T>(value: T, secrets: readonly string[] = []): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (input: unknown): unknown => {
    if (typeof input === 'string') return redactOutput(input, secrets);
    if (!input || typeof input !== 'object') return input;
    const cached = seen.get(input); if (cached) return cached;
    const copy: unknown[] | Record<string, unknown> = Array.isArray(input) ? [] : {};
    seen.set(input, copy);
    for (const [key, field] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if (!field.enumerable || !('value' in field)) continue;
      const sensitive = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token|authorization)$/i.test(key);
      Object.defineProperty(copy, redactOutput(key, secrets), { value: sensitive && typeof field.value === 'string' ? OUTPUT_REDACTED : visit(field.value), enumerable: true, configurable: true, writable: true });
    }
    return copy;
  };
  return visit(value) as T;
}

function clipped(text: string, length: number): string {
  let end = Math.min(length, text.length);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end);
}

/**
 * A display preview, NEVER evidence of raw capture completeness. Supply secrets before publishing.
 * append() retains a bounded prefix; value re-redacts that whole prefix on EVERY read. An unfinished
 * lexical token and a conservative JSON/URL/literal lookbehind are withheld until finish(). This can
 * delay short streams entirely. A capped stream keeps that suffix withheld even after finish(), so
 * neither a known key prefix nor a still-growing token is released at the retention boundary.
 * For snapshots of an already complete message, use redactOutput(wholeCurrentText, secrets).
 */
export class OutputPreview {
  private raw = '';
  private ended = false;
  private capped = false;
  private readonly maximum: number;
  constructor(private readonly secrets: Secrets = [], maxChars = 100_000) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 0 || maxChars > MAX_PREVIEW_CHARS) throw new Error('output_preview_invalid_limit');
    this.maximum = maxChars;
  }
  private known(): string[] { return literals(typeof this.secrets === 'function' ? this.secrets() : this.secrets); }
  private lookbehind(known: string[]): number { return Math.max(256, ...known.map(value => value.length * 12 + 32)); }
  append(text: string): void {
    if (this.ended) throw new Error('output_preview_finished');
    if (typeof text !== 'string') throw new Error('output_preview_invalid_text');
    if (this.capped) return;
    const known = this.known();
    const retain = this.maximum + Math.min(MAX_SECRET_CHARS * 12 + 32, this.lookbehind(known));
    const available = retain - this.raw.length;
    if (text.length > available) { this.raw += clipped(text, Math.max(0, available)); this.capped = true; }
    else this.raw += text;
  }
  finish(): string { this.ended = true; return this.value; }
  get truncated(): boolean { return this.capped || this.raw.length > this.maximum; }
  get value(): string {
    const known = this.known();
    if (known.reduce((size, value) => size + value.length, 0) > MAX_SECRET_CHARS) return clipped(OUTPUT_REDACTED, this.maximum);
    const redactions = spans(this.raw, known);
    let end = this.raw.length;
    if (!this.ended || this.capped) {
      end = Math.max(0, end - this.lookbehind(known));
      // Token recognition has no finite maximum length. Keep its entire open lexical unit.
      const token = /[\p{L}\p{N}_+\/%=\\.\-]+$/u.exec(this.raw);
      if (token) end = Math.min(end, token.index);
      // A quoted credential may contain spaces and grow beyond any fixed lookbehind.
      const assignments = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token|authorization)["']?\s*[:=]\s*(["'])/gi;
      for (const match of this.raw.matchAll(assignments)) {
        let closed = false;
        for (let i = match.index + match[0].length; i < this.raw.length; i++) {
          if (this.raw[i] === '\\') { i++; continue; }
          if (this.raw[i] === match[1]) { closed = true; break; }
        }
        if (!closed) end = Math.min(end, match.index);
      }
      // Do not cut through a fully recognized secret while withholding unrelated trailing text.
      for (const span of redactions) if (span.start < end && span.end > end) end = span.start;
    }
    return clipped(render(this.raw, redactions, end), this.maximum);
  }
}
