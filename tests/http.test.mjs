import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagnosticCore } from '../dist/server/core/diagnostic.js';
import { FakeAdapter } from '../dist/server/providers/fake.js';
import { fixture, startProcess } from './helpers.mjs';

test('serves a usable diagnostic page, built assets, health and fake participants', async (t) => {
  const { url } = await fixture(t);
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'webjjoku', mode: 'fake', persistence: 'none' });
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css']]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.text()).length > 100);
  }
  const { participants } = await (await fetch(`${url}/api/participants`)).json();
  assert.equal(participants.length, 2);
  assert.equal(new Set(participants.map((p) => p.id)).size, 2);
  assert.ok(participants.every((p) => p.isFake && p.connectionId === null));
  for (const path of ['/.env', '/src/main.ts', '/package.json', '/missing']) {
    assert.equal((await fetch(url + path)).status, 404);
  }
});

test('both participants complete Korean requests without invoking a real model', async (t) => {
  const events = [];
  const { post } = await fixture(t, { log: (event) => events.push(event) });
  const ids = [];
  for (const participantId of ['fake-a', 'fake-b']) {
    const input = '  한글 연결 확인 <script>private-input</script>  ';
    const response = await post({ participantId, input });
    assert.equal(response.status, 200);
    const { turn } = await response.json();
    assert.equal(turn.status, 'completed');
    assert.equal(turn.participantId, participantId);
    assert.equal(turn.input, input.trim());
    assert.equal(turn.error, null);
    assert.match(turn.output, /모의 응답/);
    assert.ok(turn.output.includes(input.trim()));
    assert.ok(Date.parse(turn.finishedAt) >= Date.parse(turn.startedAt));
    ids.push(turn.id);
  }
  assert.equal(new Set(ids).size, 2);
  assert.equal(events.length, 2);
  assert.doesNotMatch(JSON.stringify(events), /private-input/);
});

test('rejects malformed, blank, oversized and unknown-participant requests', async (t) => {
  const { post } = await fixture(t);
  for (const [body, status] of [
    [{ participantId: 'fake-a', input: ' \n ' }, 400],
    [{ participantId: 'fake-a', input: 'x'.repeat(2001) }, 400],
    [{ participantId: 'fake-a', input: 123 }, 400],
    [null, 400], [[], 400], [{ input: 'hello' }, 400],
    [{ participantId: 'unknown', input: 'hello' }, 404],
  ]) assert.equal((await post(body)).status, status);
  const large = await post({ participantId: 'fake-a', input: 'x'.repeat(20_000) });
  assert.equal(large.status, 413);
  assert.equal((await large.json()).error.code, 'body_too_large');
  assert.equal((await post({}, { body: '{' })).status, 400);
  assert.equal((await post({}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await post({ participantId: 'fake-a', input: 'hello' }, {
    headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' },
  })).status, 403);
  assert.equal((await post({ participantId: 'fake-a', input: 'still works' })).status, 200);
});

test('one active turn across clients; rejects overlap and recovers after completion', async (t) => {
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  const adapter = {
    participants: new FakeAdapter(0).participants,
    async complete() { started(); await gate; return { completion: 'completed', text: 'observed' }; },
  };
  const { post } = await fixture(t, { adapter });
  const first = post({ participantId: 'fake-a', input: 'first' });
  await entered;
  const overlap = await post({ participantId: 'fake-b', input: 'overlap' });
  assert.equal(overlap.status, 409);
  assert.equal((await overlap.json()).error.code, 'busy');
  release();
  assert.equal((await first).status, 200);
  assert.equal((await post({ participantId: 'fake-b', input: 'next' })).status, 200);
});

test('provider failure is not success, exposes no exception, and releases the turn', async (t) => {
  let fail = true;
  const adapter = {
    participants: new FakeAdapter(0).participants,
    async complete() {
      if (fail) throw new Error('private-provider-token');
      return { completion: 'completed', text: 'recovered' };
    },
  };
  const { post } = await fixture(t, { adapter });
  const response = await post({ participantId: 'fake-a', input: 'test' });
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.turn.status, 'failed');
  assert.equal(data.turn.output, null);
  assert.equal(data.turn.error.code, 'provider_failed');
  assert.doesNotMatch(JSON.stringify(data), /private-provider-token/);
  fail = false;
  assert.equal((await post({ participantId: 'fake-a', input: 'retry manually' })).status, 200);
});

test('interruption does not become a completed response', async () => {
  const controller = new AbortController();
  const core = new DiagnosticCore(new FakeAdapter(20));
  const pending = core.run('fake-a', 'test', controller.signal);
  controller.abort();
  const turn = await pending;
  assert.equal(turn.status, 'failed');
  assert.equal(turn.error.code, 'interrupted');
  assert.equal((await core.run('fake-b', 'next', new AbortController().signal)).status, 'completed');
});

test('production entry point starts and handles graceful SIGTERM', { timeout: 15_000 }, async (t) => {
  const process = await startProcess(t);
  assert.equal((await fetch(`${process.url}/health`)).status, 200);
  process.child.kill('SIGTERM');
  const [code, signal] = await process.exit;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.match(process.stdout(), /server.stopping/);
  assert.match(process.stdout(), /server.stopped/);
  assert.equal(process.stderr(), '');
});
