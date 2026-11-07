import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compile ONLY the owned modules into a private disposable fixture. No shared dist/build, model,
// HTTP/runtime, service, account state or credential discovery is used by this test file.
const root = fileURLToPath(new URL('../', import.meta.url));
const compiled = mkdtempSync(join(tmpdir(), 'execution-evidence-compiled-'));
after(() => rmSync(compiled, { recursive: true, force: true }));
writeFileSync(join(compiled, 'package.json'), '{"type":"module"}', { mode: 0o600 });
const program = ts.createProgram([join(root, 'src/execution/evidence-store.ts'), join(root, 'src/execution/output-policy.ts')], {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: ['node'], typeRoots: [join(root, 'node_modules/@types')], strict: true, noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true, noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true,
  verbatimModuleSyntax: true, rootDir: join(root, 'src/execution'), outDir: compiled,
});
assert.equal(ts.getPreEmitDiagnostics(program).map(row => ts.flattenDiagnosticMessageText(row.messageText, '\n')).join('\n'), '');
assert.equal(program.emit().emitSkipped, false);
const { ExecutionEvidenceStore, EVIDENCE_MAX_BYTES, EVIDENCE_MAX_RECORDS, EVIDENCE_PAGE_BYTES } = await import(pathToFileURL(join(compiled, 'evidence-store.js')));
const { redactOutput, safeOutput, OutputPreview, OUTPUT_REDACTED } = await import(pathToFileURL(join(compiled, 'output-policy.js')));
const digest = value => createHash('sha256').update(value).digest('hex');
const jsonEscape = value => JSON.stringify(value).slice(1, -1);

function fixture(t, secrets = []) {
  const temporary = mkdtempSync(join(tmpdir(), 'execution-evidence-fixture-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const directory = join(temporary, 'private', 'evidence');
  return { temporary, directory, store: new ExecutionEvidenceStore(directory, () => secrets) };
}
function files(f, descriptor) {
  const directory = join(f.directory, descriptor.artifactId);
  return { directory, raw: join(directory, 'raw.ndjson'), metadata: join(directory, 'metadata.json'), failure: join(directory, 'failure.json') };
}
function allPages(store, jobId) {
  const descriptor = store.describe(jobId);
  const parts = [];
  for (let index = 0; index < descriptor.pageCount; index++) {
    const page = store.page(jobId, index);
    assert.equal(page.pageIndex, index);
    assert.equal(page.nextPage, index + 1 < descriptor.pageCount ? index + 1 : null);
    assert.deepEqual(Object.fromEntries(Object.entries(page).filter(([key]) => !['pageIndex', 'nextPage', 'text'].includes(key))), descriptor);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= EVIDENCE_PAGE_BYTES);
    assert.ok(!page.text.includes('\ufffd'), 'no split UTF-8 characters');
    parts.push(page.text);
  }
  return parts.join('');
}
function variants(secret) {
  const encoded = encodeURIComponent(secret), base64 = Buffer.from(secret).toString('base64');
  return [...new Set([
    secret, jsonEscape(secret), jsonEscape(jsonEscape(secret)), secret.replaceAll('/', '\\/'),
    secret.split('').map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
    secret.split('').map((char, index) => index % 2 ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}` : jsonEscape(char)).join(''),
    encoded, encoded.replace(/%[\dA-F]{2}/g, value => value.toLowerCase()), encodeURI(secret), encodeURIComponent(encoded),
    new URLSearchParams({ v: secret }).toString().slice(2),
    [...Buffer.from(secret)].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''),
    base64, base64.replace(/=+$/, ''), Buffer.from(secret).toString('base64url'), base64.replaceAll('/', '\\/'), encodeURIComponent(base64),
  ])];
}

test('redactOutput covers literal, mixed JSON, URL and Base64 spellings without credential reads', () => {
  const secret = 'Qz9λ/"\\\n +🐈=끝';
  for (const variant of variants(secret)) {
    assert.equal(redactOutput(`before <${variant}> after`, [secret]), `before <${OUTPUT_REDACTED}> after`, variant);
  }
  assert.equal(redactOutput('ababa', ['aba']), OUTPUT_REDACTED, 'overlapping secrets');
  assert.equal(redactOutput('fixture safe output', ['', '']), 'fixture safe output');
  assert.equal(redactOutput('a'.repeat(80), ['x'.repeat(65_537)]), OUTPUT_REDACTED, 'secret-policy resource limit fails closed');
  assert.equal(redactOutput('safe \ud800 end', ['\ud800']), `safe ${OUTPUT_REDACTED} end`);
});

test('safeOutput preserves structured command/exit metadata while deeply redacting values and keys', () => {
  const secret = 'Fixture-Key-With-Spaces!🐈';
  const input = { command: ['printf', secret], exitCode: 0, signal: null, durationMs: 12.5, success: false, nested: { [secret]: { text: Buffer.from(secret).toString('base64'), index: 17 } }, password: 'short unknown value' };
  const original = structuredClone(input), output = safeOutput(input, [secret]);
  assert.deepEqual(input, original, 'does not mutate caller state');
  assert.deepEqual(output, { command: ['printf', OUTPUT_REDACTED], exitCode: 0, signal: null, durationMs: 12.5, success: false, nested: { [OUTPUT_REDACTED]: { text: OUTPUT_REDACTED, index: 17 } }, password: OUTPUT_REDACTED });
  assert.equal(output.command.length, 2);
  const cyclic = { text: secret }; cyclic.self = cyclic;
  const copied = safeOutput(cyclic, [secret]); assert.equal(copied.self, copied); assert.equal(copied.text, OUTPUT_REDACTED);
  const hostile = JSON.parse('{"__proto__":{"text":"' + secret + '"},"exitCode":3}');
  const sanitized = safeOutput(hostile, [secret]);
  assert.equal(Object.getPrototypeOf(sanitized), Object.prototype); assert.equal(sanitized.__proto__.text, OUTPUT_REDACTED);
  let reads = 0;
  const accessor = Object.defineProperty({ exitCode: 0 }, 'credential', { enumerable: true, get() { reads++; return secret; } });
  assert.deepEqual(safeOutput(accessor, [secret]), { exitCode: 0 }); assert.equal(reads, 0);
});

test('OutputPreview withholds known keys at EVERY splitpoint of EVERY supported spelling', () => {
  const secret = 'Qz9λ/"\\\n +🐈=끝', prefix = 'safe . '.repeat(70), suffix = ' end . '.repeat(70);
  for (const variant of variants(secret)) {
    const expected = `${prefix}<${OUTPUT_REDACTED}>${suffix}`;
    for (let split = 0; split <= variant.length; split++) {
      const preview = new OutputPreview(() => [secret]);
      assert.equal(preview.append(`${prefix}<${variant.slice(0, split)}`), undefined);
      assert.equal(typeof preview.value, 'string');
      assert.ok(expected.startsWith(preview.value), `unsafe prefix: variant=${variant}, split=${split}`);
      preview.append(`${variant.slice(split)}>${suffix}`);
      assert.ok(expected.startsWith(preview.value), `unsafe completed prefix, split=${split}`);
      assert.equal(preview.finish(), expected);
      assert.equal(preview.value, expected); assert.equal(preview.finish(), expected);
      assert.throws(() => preview.append('late'), /output_preview_finished/);
    }
  }
});

test('OutputPreview withholds token candidates across chunks, including long opaque tokens and open quoted credentials', () => {
  const candidates = [
    'sk-proj-FixtureOnlyToken1234567890', 'ghp_FixtureOnly12345678901234567890', 'github_pat_FixtureOnly12345678901234567890',
    'xoxb-1234567890-fixture-only', 'AKIA1234567890ABCDEF', 'eyJmaXh0dXJlIjoxfQ.eyJzY29wZSI6InRlc3QifQ.signature123',
    'Bearer fixtureCredential123456789', 'Basic Zml4dHVyZTpwYXNzd29yZA==', 'Zk9A'.repeat(300),
    'password="' + 'some private words '.repeat(40) + '"', 'api_key="fixture unknown short"',
  ];
  for (const token of candidates) {
    const text = 'safe . '.repeat(60) + token + ' end . '.repeat(60), expected = redactOutput(text, []);
    assert.ok(!expected.includes(token), token);
    const preview = new OutputPreview([]);
    for (const char of text) { preview.append(char); assert.ok(expected.startsWith(preview.value), `token prefix leaked: ${token.slice(0, 30)}`); }
    assert.equal(preview.finish(), expected);
  }
  assert.equal(redactOutput('password="some unknown private words'), OUTPUT_REDACTED, 'malformed quoted JSON fails closed');
  assert.equal(redactOutput('password="some unknown private words\\'), OUTPUT_REDACTED, 'a cut escape cannot expose the rest of a credential');
  assert.equal(redactOutput("password='some unknown\\\nprivate words\\"), OUTPUT_REDACTED, 'malformed escapes and single quotes fail closed');
});

test('preview caps are independent of capture completeness and do not release a cut key/token', () => {
  const secret = 'Q-very private fixture value with spaces';
  for (const variant of variants(secret)) {
    const preview = new OutputPreview([secret], 40);
    const text = 'safe . '.repeat(3) + variant + ' end . '.repeat(150);
    for (const char of text) preview.append(char);
    const value = preview.finish();
    assert.ok(value.length <= 40); assert.ok(redactOutput(text, [secret]).startsWith(value)); assert.equal(preview.truncated, true);
  }
  const opaque = new OutputPreview([], 30); opaque.append('safe . ' + 'aB9_'.repeat(500));
  assert.equal(opaque.value, 'safe . '); assert.equal(opaque.finish(), 'safe . ', 'an open token at a retention cutoff stays withheld');
  const short = new OutputPreview([], 100); short.append('hi 🐈'); assert.equal(short.value, ''); assert.equal(short.finish(), 'hi 🐈'); assert.equal(short.truncated, false);
  const zero = new OutputPreview([], 0); zero.append(secret); assert.equal(zero.finish(), '');
  for (const invalid of [-1, 1.5, Infinity, NaN, 1_000_001]) assert.throws(() => new OutputPreview([], invalid), /invalid_limit/);
});

test('PRIVATE raw NDJSON is lossless, has its own digest/size, and exact JSON-budgeted UTF-8 pages', t => {
  const secret = 'Fixture private secret 🐈/ with spaces', f = fixture(t, [secret]), jobId = 'job_fixture-1';
  const begin = f.store.begin(jobId);
  assert.equal(begin.version, 1); assert.equal(begin.complete, false); assert.equal(begin.pageCount, 0); assert.equal(begin.digest, digest(''));
  const payloads = [
    { channel: 'notification', payload: { method: 'item/delta', params: { text: '한🐈글"\\\n'.repeat(13_000) + secret }, exitCode: 0, success: false, nested: [null, 17, { arg: 'x' }] } },
    { channel: 'stdout', payload: 'original raw string\n' + secret },
    { channel: 'terminal', payload: { exitCode: 0, command: ['printf', 'a'], text: secret, result: null } },
  ];
  const expected = payloads.map(({ channel, payload }, sequence) => JSON.stringify({ version: 1, jobId, sequence, channel, payload }) + '\n').join('');
  for (const row of payloads) assert.equal(f.store.append(jobId, row.channel, row.payload).complete, false);
  const descriptor = f.store.finish(jobId), path = files(f, descriptor);
  assert.equal(descriptor.complete, true); assert.equal(descriptor.reason, null); assert.ok(descriptor.pageCount > 3);
  assert.equal(readFileSync(path.raw, 'utf8'), expected); assert.equal(allPages(f.store, jobId), expected);
  assert.equal(descriptor.digest, digest(expected)); assert.equal(descriptor.byteLength, Buffer.byteLength(expected));
  const publicText = redactOutput(expected, [secret]);
  assert.notEqual(descriptor.digest, digest(publicText)); assert.notEqual(descriptor.byteLength, Buffer.byteLength(publicText));
  const preview = new OutputPreview([secret], 120); preview.append(payloads[0].payload.params.text); preview.finish();
  assert.ok(preview.truncated); assert.ok(preview.value.length <= 120); assert.equal(f.store.describe(jobId).complete, true);
  assert.ok(!JSON.stringify(descriptor).includes(f.directory)); assert.ok(!JSON.stringify(descriptor).includes('raw.ndjson'));
  assert.deepEqual(Object.keys(descriptor).sort(), ['version', 'artifactId', 'jobId', 'digest', 'byteLength', 'pageCount', 'complete', 'reason'].sort());
  assert.deepEqual(f.store.finish(jobId), descriptor);
  assert.deepEqual(new ExecutionEvidenceStore(f.directory).describe(jobId), descriptor);
  for (const directory of [f.directory, dirname(f.directory), path.directory]) assert.equal(lstatSync(directory).mode & 0o7777, 0o700);
  for (const name of readdirSync(path.directory)) assert.equal(lstatSync(join(path.directory, name)).mode & 0o7777, 0o600);
});

test('explicit gaps and disconnects remain incomplete through finish, late appends, restart and raw retrieval', t => {
  const f = fixture(t, ['Fixture super private secret']);
  const begin = f.store.begin('gap'); f.store.append('gap', 'stdout', 'prefix');
  const path = files(f, begin), original = readFileSync(path.raw);
  const incomplete = f.store.incomplete('gap', 'disconnect Fixture super private secret at ' + join(f.directory, 'fixture.txt'));
  assert.equal(incomplete.complete, false); assert.ok(!incomplete.reason.includes('Fixture super private secret')); assert.ok(!incomplete.reason.includes(f.directory)); assert.ok(!incomplete.reason.includes('/'));
  assert.deepEqual(f.store.finish('gap'), incomplete);
  assert.deepEqual(f.store.append('gap', 'terminal', { fullText: 'cannot repair missing chunks' }), incomplete);
  assert.deepEqual(f.store.incomplete('gap', 'replace reason'), incomplete);
  assert.deepEqual(new ExecutionEvidenceStore(f.directory).finish('gap'), incomplete);
  assert.deepEqual(readFileSync(path.raw), original); assert.equal(allPages(f.store, 'gap'), original.toString('utf8'));
  assert.throws(() => f.store.begin('gap'), /already_exists/); assert.deepEqual(readFileSync(path.raw), original);
});

test('a restarted open stream cannot complete from a terminal snapshot or reconnect; completed streams survive restart', t => {
  const f = fixture(t); f.store.begin('crashed'); f.store.append('crashed', 'delta', 'before crash');
  const restarted = new ExecutionEvidenceStore(f.directory), interrupted = restarted.describe('crashed');
  assert.equal(interrupted.complete, false); assert.equal(interrupted.reason, 'capture-interrupted');
  assert.deepEqual(restarted.append('crashed', 'terminal', { fullText: 'server terminal reconstruction' }), interrupted);
  assert.deepEqual(restarted.finish('crashed'), interrupted);
  assert.deepEqual(f.store.finish('crashed'), interrupted, 'observed interruption is permanent even to the old instance');
  restarted.begin('continuous'); restarted.append('continuous', 'terminal', { exitCode: 0 }); const complete = restarted.finish('continuous');
  assert.equal(complete.complete, true); assert.deepEqual(new ExecutionEvidenceStore(f.directory).describe('continuous'), complete);
});

test('late append after finish marks a permanent gap; empty captures cannot claim completeness', t => {
  const f = fixture(t); f.store.begin('late'); f.store.append('late', 'terminal', 'done'); const complete = f.store.finish('late');
  const original = readFileSync(files(f, complete).raw);
  const incomplete = f.store.append('late', 'delta', 'too late');
  assert.equal(incomplete.complete, false); assert.equal(incomplete.reason, 'append-after-finish');
  assert.deepEqual(f.store.finish('late'), incomplete); assert.deepEqual(readFileSync(files(f, complete).raw), original);
  f.store.begin('empty'); assert.equal(f.store.finish('empty').reason, 'empty-capture');
});

test('malformed/unrepresentable messages and channel errors seal rather than drop or stringify metadata', t => {
  const f = fixture(t), cyclic = {}; cyclic.self = cyclic;
  let getterReads = 0;
  const getter = Object.defineProperty({}, 'field', { enumerable: true, get() { getterReads++; return 'bad'; } });
  const coercion = Object.defineProperty({}, 'toJSON', { value() { getterReads++; return 'changed'; } });
  const coercionGetter = Object.defineProperty([], 'toJSON', { get() { getterReads++; return () => 'changed'; } });
  const sparse = []; sparse[2] = 'x';
  const values = [undefined, { missing: undefined }, BigInt(1), { invalid: NaN }, [Infinity], cyclic, () => 1, Symbol('x'), getter, coercion, coercionGetter, new Date(0), new Map([['x', 'y']]), sparse, { toJSON() { throw new Error('should not invoke'); } }];
  for (const [index, value] of values.entries()) {
    const jobId = `malformed_${index}`, begin = f.store.begin(jobId);
    const descriptor = f.store.append(jobId, 'fixture', value);
    assert.equal(descriptor.complete, false); assert.equal(descriptor.reason, 'invalid-payload');
    assert.equal(descriptor.byteLength, 0); assert.equal(readFileSync(files(f, begin).raw).length, 0);
    assert.deepEqual(f.store.finish(jobId), descriptor);
  }
  assert.equal(getterReads, 0);
  for (const [index, channel] of ['', null, 'x'.repeat(257)].entries()) {
    const jobId = `bad_channel_${index}`; f.store.begin(jobId); assert.equal(f.store.append(jobId, channel, 'payload').reason, 'invalid-channel');
  }
  let nested = 'leaf'; for (let i = 0; i < 70; i++) nested = { nested };
  f.store.begin('deep'); assert.equal(f.store.append('deep', 'fixture', nested).reason, 'resource-limit');
});

test('oversize messages and record/tree limits preserve the exact prefix and cannot be repaired by finish', t => {
  const f = fixture(t), begin = f.store.begin('oversize'); f.store.append('oversize', 'stdout', 'prefix');
  const original = readFileSync(files(f, begin).raw);
  const descriptor = f.store.append('oversize', 'stdout', 'x'.repeat(EVIDENCE_MAX_BYTES));
  assert.equal(descriptor.reason, 'resource-limit'); assert.equal(descriptor.complete, false); assert.deepEqual(f.store.finish('oversize'), descriptor);
  assert.deepEqual(readFileSync(files(f, begin).raw), original);
  f.store.begin('tree'); assert.equal(f.store.append('tree', 'fixture', new Array(100_001).fill(0)).reason, 'resource-limit');
  // A valid synthetic max-record fixture avoids thousands of fsyncs while exercising the actual limit.
  const max = f.store.begin('records'), path = files(f, max);
  const raw = Array.from({ length: EVIDENCE_MAX_RECORDS }, (_, sequence) => JSON.stringify({ version: 1, jobId: 'records', sequence, channel: 'fixture', payload: null }) + '\n').join('');
  writeFileSync(path.raw, raw);
  const metadata = JSON.parse(readFileSync(path.metadata, 'utf8'));
  // Count pages using exactly the same public JSON text budget, without importing internals.
  let size = 0, pageCount = 1;
  for (const char of raw) { const bytes = Buffer.byteLength(JSON.stringify(char)) - 2; if (size + bytes > 12 * 1024) { pageCount++; size = 0; } size += bytes; }
  Object.assign(metadata, { byteLength: Buffer.byteLength(raw), digest: digest(raw), records: EVIDENCE_MAX_RECORDS, pageCount });
  writeFileSync(path.metadata, JSON.stringify(metadata));
  const capped = f.store.append('records', 'fixture', null);
  assert.equal(capped.reason, 'resource-limit'); assert.equal(capped.complete, false); assert.equal(readFileSync(path.raw, 'utf8'), raw);
});

test('tamper, missing raw, oversized raw, malformed/missing metadata and unsafe files are permanently rejected', async t => {
  const cases = [
    ['changed-byte', path => { const raw = readFileSync(path.raw); raw[raw.indexOf('original')] = 88; writeFileSync(path.raw, raw); }],
    ['truncated', path => truncateSync(path.raw, readFileSync(path.raw).length - 3)],
    ['raw-missing', path => unlinkSync(path.raw)],
    ['raw-oversize', path => truncateSync(path.raw, EVIDENCE_MAX_BYTES + 1)],
    ['metadata-missing', path => unlinkSync(path.metadata)],
    ['metadata-truncated', path => writeFileSync(path.metadata, '{"version":')],
    ['metadata-future', path => { const row = JSON.parse(readFileSync(path.metadata)); row.version = 2; writeFileSync(path.metadata, JSON.stringify(row)); }],
    ['metadata-digest', path => { const row = JSON.parse(readFileSync(path.metadata)); row.digest = 'a'.repeat(64); writeFileSync(path.metadata, JSON.stringify(row)); }],
    ['raw-public', path => chmodSync(path.raw, 0o644)],
    ['metadata-public', path => chmodSync(path.metadata, 0o644)],
    ['raw-symlink', path => { const copy = join(dirname(path.directory), 'outside-raw'); writeFileSync(copy, 'outside secret fixture', { mode: 0o600 }); unlinkSync(path.raw); symlinkSync(copy, path.raw); }],
    ['raw-hardlink', path => linkSync(path.raw, join(dirname(path.directory), 'outside-link'))],
  ];
  for (const [name, mutate] of cases) await t.test(name, st => {
    const f = fixture(st), begin = f.store.begin('tamper'); f.store.append('tamper', 'stdout', 'original'); f.store.finish('tamper'); const path = files(f, begin);
    const savedRaw = readFileSync(path.raw), savedMetadata = readFileSync(path.metadata);
    mutate(path);
    const descriptor = f.store.describe('tamper'); assert.equal(descriptor.complete, false, name); assert.ok(descriptor.reason);
    assert.throws(() => f.store.page('tamper', 0), /integrity_rejected/); assert.equal(f.store.finish('tamper').complete, false);
    // Restoring bytes cannot erase the observed failure marker.
    if (!lstatSync(path.directory).isSymbolicLink()) {
      if (existsSync(path.raw)) unlinkSync(path.raw);
      writeFileSync(path.raw, savedRaw, { mode: 0o600 }); writeFileSync(path.metadata, savedMetadata); chmodSync(path.metadata, 0o600);
      assert.equal(new ExecutionEvidenceStore(f.directory).describe('tamper').complete, false);
      assert.throws(() => f.store.page('tamper', 0), /integrity_rejected/);
    }
  });
});

test('forged coherent digests cannot hide NDJSON gaps, partial records, malformed UTF-8 or foreign job records', async t => {
  const edits = [
    ['sequence-gap', raw => raw.replace('"sequence":0', '"sequence":1')],
    ['foreign-job', raw => raw.replace('"jobId":"structural"', '"jobId":"another-job"')],
    ['partial-record', raw => raw.slice(0, -1)],
    ['invalid-json', () => '{"version":1, bad}\n'],
    ['missing-payload', raw => raw.replace(',"payload":"original"', '')],
    ['blank-line', raw => '\n' + raw],
    ['invalid-utf8', raw => Buffer.concat([Buffer.from(raw.slice(0, -1)), Buffer.from([0xff, 10])])],
  ];
  for (const [name, edit] of edits) await t.test(name, st => {
    const f = fixture(st), begin = f.store.begin('structural'); f.store.append('structural', 'stdout', 'original'); f.store.finish('structural');
    const path = files(f, begin), raw = Buffer.from(edit(readFileSync(path.raw, 'utf8'))), metadata = JSON.parse(readFileSync(path.metadata));
    metadata.digest = digest(raw); metadata.byteLength = raw.length;
    writeFileSync(path.raw, raw); writeFileSync(path.metadata, JSON.stringify(metadata));
    assert.equal(f.store.describe('structural').complete, false);
    assert.throws(() => f.store.page('structural', 0), /integrity_rejected/);
  });
});

test('path, page, unknown and foreign job requests cannot expose another artifact or accept arbitrary paths', t => {
  const f = fixture(t); f.store.begin('owner_job'); f.store.append('owner_job', 'fixture', 'owner private bytes'); f.store.finish('owner_job');
  const methods = [id => f.store.begin(id), id => f.store.append(id, 'fixture', 'x'), id => f.store.finish(id), id => f.store.incomplete(id, 'gap'), id => f.store.describe(id), id => f.store.page(id, 0)];
  for (const id of ['../owner_job', '/tmp/owner_job', '..', '.', 'owner_job/raw.ndjson', 'owner_job\\raw.ndjson', 'owner_job%2fraw', 'owner_job\0', '', 'a'.repeat(129), undefined, null]) {
    for (const method of methods) assert.throws(() => method(id), error => /^evidence_invalid_job_id$/.test(error.message));
  }
  for (const method of methods.slice(1)) assert.throws(() => method('foreign_job'), /^Error: evidence_not_found$/);
  for (const index of [-1, 0.5, NaN, Infinity, '0', null]) assert.throws(() => f.store.page('owner_job', index), /invalid_page/);
  assert.throws(() => f.store.page('owner_job', 999999), /page_not_found/);
  const other = fixture(t); assert.throws(() => other.store.page('owner_job', 0), /not_found/);
  assert.throws(() => f.store.page(f.store.describe('owner_job').artifactId, 0), /not_found/);
  const begin = f.store.begin('foreign_metadata'); f.store.append('foreign_metadata', 'fixture', 'other bytes'); f.store.finish('foreign_metadata');
  const path = files(f, begin), foreign = files(f, f.store.describe('owner_job'));
  writeFileSync(path.metadata, readFileSync(foreign.metadata));
  assert.equal(f.store.describe('foreign_metadata').complete, false); assert.throws(() => f.store.page('foreign_metadata', 0), /integrity_rejected/);
});

test('symlinked roots/artifact directories and public directories fail with path-free errors', t => {
  const f = fixture(t); f.store.begin('directory'); f.store.append('directory', 'fixture', 'private'); f.store.finish('directory');
  const linked = join(f.temporary, 'linked'); symlinkSync(f.directory, linked);
  assert.throws(() => new ExecutionEvidenceStore(linked), error => error.message === 'evidence_private_directory_required');
  const indirect = join(f.temporary, 'indirect'); symlinkSync(dirname(f.directory), indirect);
  assert.throws(() => new ExecutionEvidenceStore(join(indirect, 'child')), /private_directory_required/);
  assert.equal(existsSync(join(dirname(f.directory), 'child')), false, 'does not create through a symlinked ancestor');
  const path = files(f, f.store.describe('directory')), saved = join(f.temporary, 'saved');
  mkdirSync(saved, { mode: 0o700 });
  rmSync(path.directory, { recursive: true }); symlinkSync(saved, path.directory);
  assert.throws(() => f.store.describe('directory'), error => error.message === 'evidence_unsafe_artifact');
  assert.deepEqual(readdirSync(saved), []);
  unlinkSync(path.directory); mkdirSync(path.directory, { mode: 0o755 });
  assert.throws(() => f.store.page('directory', 0), /unsafe_artifact/);
});
