import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

// Owner API contract fixture: real DOM/browser, current frontend source, no
// executor, external account, model, server build, or other browser fixture.
const origin = 'http://127.0.0.1:45321';
const assets = new Map();
const digest = value => value.repeat(64);
function authority() { return { version: 1, epoch: 1, issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), revokedAt: null }; }
function binding(id = 'binding-a') { return { id, label: '보호 작업 공간 ' + id, host: 'fixture', user: 'owner', cwd: '/fixture/worktree', threadId: 'thread-' + id, allowWrite: true, status: 'ready', repoRoot: '/fixture/worktree', branch: 'work/protected', head: digest('a'), sessionTreeId: null, authority: authority() }; }
function job(b, id = 'job-a') { return { id, bindingId: b.id, discussionId: null, taskId: null, revision: null, requestId: 'fixture-' + id, prompt: '기존 텍스트 파일의 한 문장을 수정하세요.', promptDigest: digest('b'), status: 'completed', threadId: b.threadId, turnId: 'turn-' + id, createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(), maxDurationMs: 60_000, deadlineAt: null, text: '표시용 미리보기 [REDACTED]', error: null, activities: [], approvals: [], authority: { version: 1, binding: { id: b.id, epoch: b.authority.epoch, expiresAt: b.authority.expiresAt } }, capture: { version: 1, artifactId: 'artifact-' + id, jobId: id, digest: digest('c'), byteLength: 120, pageCount: 2, complete: true, reason: null }, draft: { version: 1, status: 'pending', manifestDigest: digest('d'), diffDigest: digest('e'), reason: null } }; }
function review(j) { return { status: 'ready', reason: null, manifestDigest: j.draft.manifestDigest, diffDigest: j.draft.diffDigest, files: [{ path: 'docs/example.txt', beforeDigest: digest('1'), afterDigest: digest('2'), diff: '--- docs/example.txt\n+++ docs/example.txt\n@@ -1 +1 @@\n-before\n+after <img src=x onerror="window.injected=true">' }] }; }
async function asset(path) {
  if (!assets.has(path)) assets.set(path, (async () => {
    const name = path === '/' ? 'control.html' : path.slice(1);
    assert.match(name, /^(?:control\.(?:html|css|js)|(?:dot-connections|room-view|topic-chat-view|wiki-view)\.js)$/);
    const source = await readFile(new URL('../../src/web/' + name.replace(/\.js$/, '.ts'), import.meta.url), 'utf8');
    return { contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: name.endsWith('.js') ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText : source };
  })());
  return assets.get(path);
}
async function open(t, { width = 1380, configure = () => {} } = {}) {
  const b = binding(), j = job(b), snapshot = { cursor: 1, connections: [], participants: [], discussions: [], bindings: [b], jobs: [j], browserPaused: false, grants: [], capabilities: { sourceFetch: false, browserConfigured: false, noVncConfigured: false, codexConfigured: true }, materialPackages: [], materialRoots: [], resident: { enabled: false, rooms: [] }, apiDaily: { configured: false } };
  configure(snapshot);
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [], unexpected = [], requests = [], handlers = new Map(); let eventId = 1;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('wj.room.view', 'execution');
    window.EventSource = class extends EventTarget { constructor() { super(); window.executionEvents = this; } close() {} };
  });
  await page.route(origin + '/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (!path.startsWith('/api/')) { await route.fulfill(await asset(path)); return; }
    const request = { path, search: url.search, method: req.method(), body: req.postData() ? req.postDataJSON() : undefined, commandId: req.headers()['idempotency-key'] }; requests.push(request);
    const handler = handlers.get(path); if (handler) { await handler(route, request); return; }
    if (path === '/api/auth') { await route.fulfill({ json: { passwordConfigured: true, canSetup: false } }); return; }
    if (path === '/api/state') { await route.fulfill({ json: structuredClone(snapshot) }); return; }
    const evidence = path.match(/^\/api\/jobs\/([^/]+)\/evidence$/);
    if (evidence) { const selected = snapshot.jobs.find(v => v.id === evidence[1]), index = Number(url.searchParams.get('page')); await route.fulfill({ json: { ...selected.capture, pageIndex: index, nextPage: index + 1 < selected.capture.pageCount ? index + 1 : null, text: index === 0 ? 'PRIVATE PAGE ONE <img src=x onerror="window.injected=true">' : 'PRIVATE PAGE TWO' } }); return; }
    const draft = path.match(/^\/api\/jobs\/([^/]+)\/draft$/);
    if (draft) { await route.fulfill({ json: review(snapshot.jobs.find(v => v.id === draft[1])) }); return; }
    unexpected.push(path); await route.fulfill({ status: 404, json: { error: { code: 'unexpected_fixture_request' } } });
  });
  await page.goto(origin); await page.locator('#view-execution:not([hidden])').waitFor(); await page.locator('[data-job-id=job-a]').waitFor();
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); });
  const refresh = async change => {
    change?.(snapshot); snapshot.cursor = ++eventId;
    snapshot.jobs[0].text = `표시용 미리보기 [REDACTED] · snapshot ${eventId}`;
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/state');
    await page.evaluate(id => window.executionEvents.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ id }) })), eventId); await response;
    await page.waitForFunction(id => document.querySelector('[data-job-id=job-a] .job-output')?.textContent.includes('snapshot ' + id), eventId);
  };
  return { page, snapshot, requests, handlers, refresh, card: id => page.locator(`[data-job-id="${id ?? 'job-a'}"]`), posts: path => requests.filter(r => r.path === path && r.method === 'POST') };
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
function commandScope(protection = 'draft', state = 'ready') {
  return { version: 1, state, digest: digest('7'), requestDigest: digest('8'), contextDigest: digest('9'), command: "/bin/bash -c 'cat exact.txt' # <img src=x onerror=window.injected=true>", cwd: '/fixture/protected copy', profileId: protection === 'draft' ? 'webjjoku_copy' : 'webjjoku_read', reason: null };
}
function protectApproval(j, protection, state = 'ready') {
  j.status = 'blocked_approval';
  if (protection === 'readCopy') { delete j.draft; j.readCopy = { version: 1, status: 'running', manifestDigest: digest('d'), reason: null }; }
  j.approvals = [{ id: 'approval-scoped', rpcId: 17, method: 'item/commandExecution/requestApproval', params: { command: 'a display hint is not the approved command', cwd: '/untrusted/hint' }, status: 'pending', scope: commandScope(protection, state) }];
}

for (const protection of ['draft', 'readCopy']) test(`execution owner UI: ${protection} scoped command needs fresh owner consent and sends one exact payload`, { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) { protectApproval(s.jobs[0], protection); } }), { page } = f;
  const form = f.card().locator('.scoped-command-confirmation'), checkbox = form.getByRole('checkbox'), approve = form.getByRole('button', { name: '이 명령 1회 승인', exact: true });
  const scope = f.snapshot.jobs[0].approvals[0].scope;
  assert.equal(await form.locator('.scoped-command').textContent(), scope.command); assert.equal(await form.locator('.scoped-cwd').textContent(), scope.cwd); assert.equal(await form.locator('.scoped-profile').textContent(), protection === 'readCopy' ? '읽기 전용' : '보호 사본 수정');
  assert.equal(await form.locator('img').count(), 0); assert.equal(await checkbox.isChecked(), false); assert.equal(await approve.isDisabled(), true);
  await form.dispatchEvent('submit'); await settle(page); assert.equal(f.posts('/api/jobs/job-a/approve').length, 0);
  await checkbox.check(); assert.equal(await approve.isEnabled(), true); await checkbox.uncheck(); assert.equal(await approve.isDisabled(), true);
  await checkbox.check(); await f.refresh(); assert.equal(await checkbox.isChecked(), false); assert.equal(await approve.isDisabled(), true);
  assert.equal(f.posts('/api/jobs/job-a/apply').length, 0); assert.equal(f.posts('/api/jobs/job-a/approve').length, 0);
  let release, received; const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { received = resolve; });
  f.handlers.set('/api/jobs/job-a/approve', async route => { received(); await held; f.snapshot.jobs[0].approvals[0].scope.state = 'sent'; await route.fulfill({ json: {} }); });
  await checkbox.check(); await approve.click(); await started; await form.dispatchEvent('submit'); await settle(page);
  assert.equal(f.posts('/api/jobs/job-a/approve').length, 1);
  assert.deepEqual(f.posts('/api/jobs/job-a/approve')[0].body, { approvalId: 'approval-scoped', decision: 'accept', expectedScopeDigest: scope.digest, ownerConfirmed: true }); assert.ok(f.posts('/api/jobs/job-a/approve')[0].commandId);
  release(); await f.card().getByText('이 명령의 1회 승인을 전달했습니다. 원래 실행 결과를 확인해 주세요.', { exact: true }).waitFor();
  assert.equal(await f.card().getByRole('button', { name: '이 명령 1회 승인', exact: true }).count(), 0); assert.equal(f.posts('/api/jobs/job-a/apply').length, 0);
});

test('execution owner UI: latest scope, request status and binding authority fence even a retained checked form', { timeout: 45000 }, async t => {
  const f = await open(t, { configure(s) { protectApproval(s.jobs[0], 'draft'); } }), { page } = f;
  const baseline = structuredClone(f.snapshot);
  const changes = [
    s => { s.jobs[0].approvals[0].scope.digest = digest('6'); },
    s => { s.jobs[0].approvals[0].scope.state = 'checking'; },
    s => { s.jobs[0].approvals[0].scope.state = 'selected'; },
    s => { s.jobs[0].approvals[0].scope.state = 'unconfirmed'; },
    s => { s.jobs[0].approvals[0].status = 'resolved'; },
    s => { s.jobs[0].status = 'running'; },
    s => { s.jobs[0].approvals = []; },
    s => { s.bindings[0].authority.revokedAt = new Date().toISOString(); },
    s => { s.bindings[0].authority.epoch++; },
    s => { s.bindings[0].status = 'blocked'; },
  ];
  for (const change of changes) {
    await f.refresh(s => Object.assign(s, structuredClone(baseline)));
    const form = f.card().locator('.scoped-command-confirmation'); await form.getByRole('checkbox').check(); const retained = await form.elementHandle();
    await f.refresh(change);
    // Simulate a late event retaining its old values, without relying only on DOM replacement.
    await retained.evaluate(form => { document.querySelector('[data-job-id=job-a]').append(form); form.querySelector('input').checked = true; form.requestSubmit(); });
    await page.locator('#notice:not([hidden])').waitFor(); await settle(page);
    assert.equal(f.posts('/api/jobs/job-a/approve').length, 0);
  }
});

test('execution owner UI: non-ready scoped states explain the wait and retain decline/cancel only', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) { protectApproval(s.jobs[0], 'readCopy', 'checking'); } });
  const messages = { checking: '보호 범위를 확인하고 있습니다', blocked: '보호 범위를 확인하지 못했습니다', selected: '승인 선택이 기록되었습니다', sent: '1회 승인을 전달했습니다', unconfirmed: '승인 전달 결과를 확인하지 못했습니다' };
  for (const [state, message] of Object.entries(messages)) {
    await f.refresh(s => { s.jobs[0].approvals[0].scope.state = state; });
    assert.match(await f.card().locator('.scoped-command-status').textContent(), new RegExp(message));
    assert.equal(await f.card().getByRole('button', { name: '이 명령 1회 승인', exact: true }).count(), 0);
    assert.doesNotMatch(await f.card().textContent(), /경로·범위를 검증하는 실행 승인은 아직 지원하지/);
    for (const name of ['거절', '취소']) assert.equal(await f.card().getByRole('button', { name, exact: true }).isEnabled(), true);
  }
  assert.equal(f.posts('/api/jobs/job-a/approve').length, 0);
});

test('execution owner UI: owner lock discards scoped consent and cannot revive a retained form', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) { protectApproval(s.jobs[0], 'readCopy'); } }), { page } = f;
  const form = f.card().locator('.scoped-command-confirmation'); await form.getByRole('checkbox').check(); const retained = await form.elementHandle();
  f.handlers.set('/api/logout', route => route.fulfill({ json: {} })); await page.locator('#logout').click(); await page.locator('#login:not([hidden])').waitFor();
  assert.equal(await page.locator('.scoped-command-confirmation').count(), 0);
  assert.equal(await retained.evaluate(form => form.querySelector('input').checked), false);
  await retained.evaluate(form => { document.body.append(form); form.requestSubmit(); }); await settle(page); assert.equal(f.posts('/api/jobs/job-a/approve').length, 0);
});

test('execution owner UI: explicit new-session choice omits an old ID and restores existing-session validation', { timeout: 30000 }, async t => {
  const f = await open(t), { page } = f, form = page.locator('#binding-form'), mode = form.locator('[name=sessionMode]'), thread = form.locator('[name=threadId]');
  f.handlers.set('/api/bindings', route => route.fulfill({ json: {} }));
  assert.equal(await mode.inputValue(), 'existing'); assert.equal(await thread.isVisible(), true); assert.equal(await thread.getAttribute('required'), '');
  await form.locator('[name=label]').fill('새 작업 세션'); await form.locator('[name=cwd]').fill('/fixture/selected');
  await form.locator('[name=allowWrite]').check(); await form.locator('[name=expiresInHours]').fill('48');
  await form.locator('button[type=submit]').click(); assert.equal(f.posts('/api/bindings').length, 0); assert.equal(await thread.evaluate(el => el.validity.valueMissing), true);
  await thread.fill('unused-old-thread'); await mode.selectOption('new');
  assert.equal(await thread.isVisible(), false); assert.equal(await thread.isDisabled(), true); assert.equal(await thread.getAttribute('required'), null);
  assert.match(await page.locator('#binding-new-session-note').textContent(), /같은 연결/);
  assert.equal(await page.locator('#binding-new-session-note').isVisible(), true); assert.equal(f.posts('/api/bindings').length, 0);
  let response = page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/bindings');
  await form.locator('button[type=submit]').click(); await response;
  assert.deepEqual(f.posts('/api/bindings')[0].body, { label: '새 작업 세션', cwd: '/fixture/selected', sessionMode: 'new', allowWrite: true, expiresInHours: 48 });
  assert.equal(Object.hasOwn(f.posts('/api/bindings')[0].body, 'threadId'), false); assert.ok(f.posts('/api/bindings')[0].commandId);
  await mode.selectOption('existing'); assert.equal(await thread.isVisible(), true); assert.equal(await thread.isEnabled(), true); assert.equal(await thread.getAttribute('required'), '');
  assert.equal(await page.locator('#binding-new-session-note').isVisible(), false); await thread.fill('');
  await form.locator('button[type=submit]').click(); assert.equal(f.posts('/api/bindings').length, 1); assert.equal(await thread.evaluate(el => el.validity.valueMissing), true);
  await thread.fill('thread-existing'); response = page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/bindings');
  await form.locator('button[type=submit]').click(); await response;
  assert.deepEqual(f.posts('/api/bindings')[1].body, { label: '새 작업 세션', cwd: '/fixture/selected', sessionMode: 'existing', threadId: 'thread-existing', allowWrite: true, expiresInHours: 48 });
  assert.equal(f.posts('/api/jobs').length, 0);
});

test('execution owner UI: initial and lost managed sessions need explicit registration and preserve revoke controls', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) {
    const initial = binding('initial'); initial.allowWrite = false; initial.readProtection = 1; initial.managedSession = { version: 1, state: 'initial', firstRequestId: null };
    const lost = binding('lost'); lost.managedSession = { version: 1, state: 'lost', firstRequestId: null }; s.bindings.push(initial, lost);
  } }), { page } = f;
  const initial = page.locator('[data-binding-id=initial]'), lost = page.locator('[data-binding-id=lost]');
  assert.match(await initial.textContent(), /새 세션 준비됨.*아직 첫 요청.*자동 실행하지/); assert.match(await initial.textContent(), /최소 읽기 범위 확인/);
  await page.locator('#job-binding').selectOption('initial'); assert.equal(await page.locator('#job-form button[type=submit]').isEnabled(), true);
  assert.match(await page.locator('#job-access-note').textContent(), /새 세션 준비됨/); assert.match(await page.locator('#job-access-note').textContent(), /최소 읽기 범위 확인/);
  assert.match(await lost.textContent(), /연결이 끊겼습니다.*권한을 회수.*다시 등록/);
  await page.locator('#job-binding').selectOption('lost'); assert.equal(await page.locator('#job-form button[type=submit]').isDisabled(), true);
  assert.match(await page.locator('#job-access-note').textContent(), /자동으로 새 세션을 만들지/); assert.equal(await page.locator('#discussion-binding option[value=lost]').evaluate(el => el.disabled), true);
  await page.locator('#binding-session-mode').selectOption('new');
  await lost.getByRole('button', { name: '이 설정으로 재등록' }).click();
  assert.equal(await page.locator('#binding-session-mode').inputValue(), 'existing'); assert.equal(await page.locator('#binding-form [name=threadId]').inputValue(), 'thread-lost');
  assert.equal(await page.locator('#binding-form [name=threadId]').isVisible(), true); assert.equal(await page.locator('#binding-form [name=allowWrite]').isChecked(), true);
  await f.refresh(s => { s.bindings.find(b => b.id === 'initial').managedSession.state = 'lost'; });
  await page.locator('#job-binding').selectOption('initial'); assert.equal(await page.locator('#job-form button[type=submit]').isDisabled(), true);
  assert.equal(f.posts('/api/bindings').length, 0); assert.equal(f.posts('/api/jobs').length, 0);
  f.handlers.set('/api/bindings/lost/revoke', route => route.fulfill({ json: {} })); await lost.getByRole('button', { name: '실행 권한 회수' }).click();
  assert.deepEqual(f.posts('/api/bindings/lost/revoke')[0].body, {}); assert.ok(f.posts('/api/bindings/lost/revoke')[0].commandId);
});

test('execution owner UI: authority expiry, legacy/revocation, explicit re-registration and numeric durations', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) {
    const legacy = binding('legacy'); delete legacy.authority;
    const expired = binding('expired'); expired.authority.issuedAt = new Date(Date.now() - 7200000).toISOString(); expired.authority.expiresAt = new Date(Date.now() - 3600000).toISOString();
    const revoked = binding('revoked'); revoked.authority.revokedAt = new Date().toISOString(); s.bindings.push(legacy, expired, revoked);
    s.grants.push({ id: 'legacy-grant', participantId: 'participant-a', discussionId: 'discussion-a', revoked: false, tools: ['task_get'] }, { id: 'revoked-grant', participantId: 'participant-b', discussionId: 'discussion-a', revoked: true, tools: ['task_get'], authority: authority() });
    s.discussions.push({ id: 'discussion-a', topic: '권한 fixture', status: 'completed', phase: 'synthesis', revision: 1 });
  } });
  for (const selector of ['#binding-form', '#grant-form']) {
    const input = f.page.locator(selector + ' [name=expiresInHours]'); assert.equal(await input.inputValue(), '24'); assert.equal(await input.getAttribute('min'), '1'); assert.equal(await input.getAttribute('max'), '168'); assert.equal(await input.getAttribute('required'), '');
  }
  for (const [id, text] of [['legacy', '이전 권한'], ['expired', '권한 만료'], ['revoked', '권한 회수됨']]) {
    await f.page.locator('#job-binding').selectOption(id); assert.equal(await f.page.locator('#job-form button[type=submit]').isDisabled(), true); assert.match(await f.page.locator('#job-access-note').textContent(), new RegExp(text));
  }
  await f.page.locator('[data-binding-id=expired]').getByRole('button', { name: '이 설정으로 재등록' }).click();
  assert.equal(await f.page.locator('#binding-form [name=threadId]').inputValue(), 'thread-expired'); assert.equal(await f.page.locator('#binding-form [name=allowWrite]').isChecked(), true);
  f.handlers.set('/api/bindings', route => route.fulfill({ json: {} })); await f.page.locator('#binding-form [name=expiresInHours]').fill('48'); await f.page.locator('#binding-form button[type=submit]').click();
  assert.equal(f.posts('/api/bindings')[0].body.expiresInHours, 48); assert.equal(f.posts('/api/bindings')[0].body.threadId, 'thread-expired');
  f.handlers.set('/api/bindings/binding-a/revoke', route => route.fulfill({ json: {} })); await f.page.locator('[data-binding-id=binding-a]').getByRole('button', { name: '실행 권한 회수' }).click();
  assert.deepEqual(f.posts('/api/bindings/binding-a/revoke')[0].body, {}); assert.ok(f.posts('/api/bindings/binding-a/revoke')[0].commandId);
  await f.page.locator('[data-view=connections]').click(); await f.page.getByText('참여자별 MCP 접근 권한', { exact: true }).click();
  assert.match(await f.page.locator('[data-grant-id=legacy-grant]').textContent(), /이전 권한/); assert.match(await f.page.locator('[data-grant-id=revoked-grant]').textContent(), /권한 회수됨/);
  f.handlers.set('/api/grants', route => route.fulfill({ json: { id: 'new-grant', token: 'fixture-token' } }));
  await f.page.locator('#grant-form [name=participantId]').fill('participant-a'); await f.page.locator('#grant-form [name=expiresInHours]').fill('72'); await f.page.locator('#grant-form button').click();
  assert.equal(f.posts('/api/grants')[0].body.expiresInHours, 72);
});

test('execution owner UI: private raw pages require clicks, replace one page, reject mismatched digests and clear on lock', { timeout: 30000 }, async t => {
  const f = await open(t); const { page } = f;
  assert.equal(f.requests.filter(r => r.path.endsWith('/evidence')).length, 0); await f.refresh(); await settle(page); assert.equal(f.requests.filter(r => r.path.endsWith('/evidence')).length, 0);
  await f.card().getByRole('button', { name: '원문 첫 페이지 보기' }).click(); await f.card().locator('.execution-raw').waitFor();
  assert.match(await f.card().locator('.execution-raw').textContent(), /PRIVATE PAGE ONE <img/); assert.equal(await f.card().locator('.execution-raw img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(f.requests.filter(r => r.path.endsWith('/evidence')).length, 1); assert.equal(await page.locator('#view-room').textContent().then(text => text.includes('PRIVATE PAGE')), false);
  await f.card().getByRole('button', { name: '다음 원문 페이지' }).click(); await page.waitForFunction(() => document.querySelector('.execution-raw')?.textContent === 'PRIVATE PAGE TWO');
  assert.deepEqual(f.requests.filter(r => r.path.endsWith('/evidence')).map(r => r.search), ['?page=0', '?page=1']); assert.equal(await f.card().getByRole('button', { name: '다음 원문 페이지' }).count(), 0);
  await f.refresh(); await settle(page); assert.equal(f.requests.filter(r => r.path.endsWith('/evidence')).length, 2); assert.equal(await f.card().locator('.execution-raw').textContent(), 'PRIVATE PAGE TWO');
  f.handlers.set('/api/jobs/job-a/evidence', route => route.fulfill({ json: { ...f.snapshot.jobs[0].capture, digest: digest('f'), pageIndex: 0, nextPage: 1, text: 'WRONG RAW' } }));
  await f.card().getByRole('button', { name: '이전 원문 페이지' }).click(); await f.card().getByText(/원문 페이지의 실행·수집본·digest가 일치하지/).waitFor(); assert.equal(await page.getByText('WRONG RAW', { exact: true }).count(), 0);
  f.handlers.delete('/api/jobs/job-a/evidence'); await f.card().getByRole('button', { name: '원문 첫 페이지 보기' }).click(); await f.card().locator('.execution-raw').waitFor();
  await f.refresh(s => { s.jobs[0].capture.digest = digest('f'); }); await f.card().locator('.execution-raw').waitFor({ state: 'detached' });
  await f.card().getByRole('button', { name: '원문 첫 페이지 보기' }).click(); await f.card().locator('.execution-raw').waitFor();
  f.handlers.set('/api/logout', route => route.fulfill({ json: {} })); await page.locator('#logout').click(); await page.locator('#login:not([hidden])').waitFor(); assert.equal(await page.locator('.execution-raw').count(), 0); assert.equal(await page.locator('#jobs-list').textContent(), '');
});

test('execution owner UI: review and confirmation stay bound to one job and digest across snapshot refresh and server conflict', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) { s.jobs.push(job(s.bindings[0], 'job-b')); s.jobs[1].draft.diffDigest = digest('9'); } }); const { page } = f;
  assert.equal(f.requests.filter(r => r.path.endsWith('/draft') || r.path.endsWith('/apply')).length, 0);
  await f.card().getByRole('button', { name: '보호 사본 diff 확인' }).click(); await f.card().locator('.execution-diff').waitFor(); assert.equal(f.posts('/api/jobs/job-a/apply').length, 0);
  await f.card().getByRole('button', { name: '원본 반영 확인…' }).click(); await page.locator('#draft-owner-confirmed').check();
  assert.match(await page.locator('#draft-apply-summary').textContent(), new RegExp(digest('e')));
  await f.refresh(s => { s.jobs[0].draft.diffDigest = digest('f'); }); await page.waitForFunction(() => document.querySelector('#draft-apply-form button[type=submit]').disabled);
  assert.match(await page.locator('#draft-apply-summary').textContent(), new RegExp(digest('e'))); assert.match(await page.locator('#draft-apply-state').textContent(), /새 diff를 직접/); assert.equal(f.posts('/api/jobs/job-a/apply').length, 0);
  await page.locator('#draft-apply-close').click(); await f.card().getByRole('button', { name: 'diff 다시 확인' }).click(); await page.waitForFunction(value => document.querySelector('[data-job-id=job-a] .execution-draft').textContent.includes(value), digest('f'));
  await f.card().getByRole('button', { name: '원본 반영 확인…' }).click(); await page.locator('#draft-owner-confirmed').check();
  f.handlers.set('/api/jobs/job-a/apply', route => route.fulfill({ status: 409, json: { error: { code: 'execution_draft_changed' } } }));
  await page.locator('#draft-apply-form button[type=submit]').click(); await page.waitForFunction(() => document.querySelector('#draft-apply-state').textContent.includes('새 diff를 직접'));
  assert.deepEqual(f.posts('/api/jobs/job-a/apply').map(r => r.body), [{ expectedDiffDigest: digest('f') }]); assert.ok(f.posts('/api/jobs/job-a/apply')[0].commandId); assert.equal(f.posts('/api/jobs/job-b/apply').length, 0);
  await f.refresh(); await settle(page); assert.equal(f.posts('/api/jobs/job-a/apply').length, 1); assert.equal(await page.locator('#draft-apply-form button[type=submit]').isDisabled(), true);
});

test('execution owner UI: explicit apply, separate remote/source status, safe diff and responsive 1380/390px layout', { timeout: 30000 }, async t => {
  const f = await open(t); const { page } = f;
  assert.match(await f.card().locator('.execution-status').textContent(), /원격 실행완료원본 반영/);
  assert.match(await f.card().locator('.execution-status').textContent(), /소유자 확인·반영 대기/);
  for (const width of [1380, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await f.card().getByRole('button', { name: width === 1380 ? '보호 사본 diff 확인' : 'diff 다시 확인' }).click(); await f.card().locator('.execution-diff').waitFor();
    assert.equal(await f.card().locator('.execution-diff img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
    await f.card().getByRole('button', { name: '원본 반영 확인…' }).click(); assert.equal(f.posts('/api/jobs/job-a/apply').length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mkdir('test-results/execution-protection', { recursive: true }); await page.screenshot({ path: `test-results/execution-protection/confirm-${width}.png` });
    await page.locator('#draft-apply-close').click();
  }
  f.handlers.set('/api/jobs/job-a/apply', route => {
    f.snapshot.jobs[0].draft.status = 'applied'; f.snapshot.jobs[0].draft.receipt = { path: 'docs/example.txt', beforeDigest: digest('1'), afterDigest: digest('2'), appliedAt: new Date().toISOString() }; return route.fulfill({ json: { status: 'applied' } });
  });
  await f.card().getByRole('button', { name: '원본 반영 확인…' }).click(); await page.locator('#draft-apply-form button[type=submit]').click(); assert.equal(f.posts('/api/jobs/job-a/apply').length, 0);
  await page.locator('#draft-owner-confirmed').check(); await page.locator('#draft-apply-form button[type=submit]').click(); await page.locator('#draft-apply-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(f.posts('/api/jobs/job-a/apply')[0].body, { expectedDiffDigest: digest('e') }); assert.match(await f.card().locator('.execution-status').textContent(), /원격 실행완료원본 반영원본 반영 완료/); assert.equal(await f.card().getByText('원본 반영 영수증', { exact: true }).count(), 1);
});

test('execution owner UI: truncated display is separate from complete capture; protected approvals only decline/cancel', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) {
    const protectedJob = s.jobs[0]; protectedJob.status = 'blocked_approval'; protectedJob.previewTruncated = true;
    protectedJob.activities.push({ id: 'command-a', type: 'commandExecution', status: 'completed', text: '가려진 명령 표시 [REDACTED]', truncated: true, command: { command: 'fixture-check', exitCode: 0, output: '가려진 출력 [REDACTED]' } });
    protectedJob.approvals.push({ id: 'approval-a', rpcId: 1, method: 'fixture/approval', params: { command: 'fixture-check' }, status: 'pending' });
    const readonly = job(s.bindings[0], 'readonly-job'); delete readonly.draft; readonly.status = 'blocked_approval'; readonly.approvals = [{ id: 'approval-readonly', rpcId: 2, method: 'fixture/approval', params: {}, status: 'pending' }]; s.jobs.push(readonly);
  } });
  assert.match(await f.card().textContent(), /미리보기 일부 생략/); assert.match(await f.card().locator('.execution-private').textContent(), /수집 완료/);
  const activity = f.card().locator('details').filter({ hasText: 'commandExecution · completed' }); await activity.locator('summary').click();
  assert.match(await activity.textContent(), /표시용 본문·출력 일부가 생략/); assert.match(await activity.textContent(), /종료 코드 · 0/);
  assert.equal(await f.card().getByRole('button', { name: '이번 요청 승인', exact: true }).count(), 0); assert.match(await f.card().textContent(), /경로·범위를 검증하는 실행 승인은 아직 지원하지/);
  assert.equal(await f.card('readonly-job').getByRole('button', { name: '이번 요청 승인', exact: true }).isEnabled(), true);
  f.handlers.set('/api/jobs/job-a/approve', route => route.fulfill({ json: {} })); await f.card().getByRole('button', { name: '거절', exact: true }).click();
  const cancelled = f.page.waitForResponse(res => new URL(res.url()).pathname === '/api/jobs/job-a/approve' && res.request().method() === 'POST' && res.request().postDataJSON()?.decision === 'cancel');
  await f.card().getByRole('button', { name: '취소', exact: true }).click(); await cancelled;
  assert.deepEqual(f.posts('/api/jobs/job-a/approve').map(r => r.body.decision), ['decline', 'cancel']);
});

test('execution owner UI: readCopy approvals warn and only decline/cancel, including after a stale ACCEPT click', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) {
    for (const id of ['readonly', 'legacy-readonly']) {
      const b = binding(id); b.allowWrite = false; if (id === 'readonly') b.readProtection = 1; s.bindings.push(b);
      const j = job(b, id + '-job'); delete j.draft; j.status = 'blocked_approval';
      if (id === 'readonly') j.readCopy = { version: 1, status: 'running', manifestDigest: digest('f'), reason: null };
      j.approvals.push({ id: 'approval-' + id, rpcId: 2, method: 'fixture/approval', params: {}, status: 'pending' }); s.jobs.push(j);
    }
  } }), { page } = f;
  const protectedCard = f.card('readonly-job'), legacyCard = f.card('legacy-readonly-job');
  assert.match(await protectedCard.locator('.execution-warning').textContent(), /경로·범위를 검증하는 실행 승인은 아직 지원하지/);
  assert.equal(await protectedCard.getByRole('button', { name: '이번 요청 승인', exact: true }).count(), 0);
  assert.equal(await legacyCard.getByRole('button', { name: '이번 요청 승인', exact: true }).isEnabled(), true);
  assert.equal(await legacyCard.locator('.execution-warning').count(), 0);
  f.handlers.set('/api/jobs/readonly-job/approve', route => route.fulfill({ json: {} }));
  for (const name of ['거절', '취소']) {
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/jobs/readonly-job/approve');
    await protectedCard.getByRole('button', { name, exact: true }).click(); await response;
  }
  assert.deepEqual(f.posts('/api/jobs/readonly-job/approve').map(r => r.body), [
    { approvalId: 'approval-readonly', decision: 'decline' }, { approvalId: 'approval-readonly', decision: 'cancel' },
  ]);
  f.handlers.set('/api/jobs/legacy-readonly-job/approve', route => route.fulfill({ json: {} }));
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/jobs/legacy-readonly-job/approve');
  await legacyCard.getByRole('button', { name: '이번 요청 승인', exact: true }).click(); await response; await f.refresh();
  assert.deepEqual(f.posts('/api/jobs/legacy-readonly-job/approve')[0].body, { approvalId: 'approval-legacy-readonly', decision: 'accept' });
  const staleAccept = await legacyCard.getByRole('button', { name: '이번 요청 승인', exact: true }).elementHandle();
  await f.refresh(s => { s.jobs.find(j => j.id === 'legacy-readonly-job').readCopy = { ...s.jobs.find(j => j.id === 'readonly-job').readCopy }; });
  assert.equal(await legacyCard.getByRole('button', { name: '이번 요청 승인', exact: true }).count(), 0);
  await staleAccept.evaluate(button => button.click());
  await page.locator('#notice').filter({ hasText: /경로·범위를 검증하는 실행 승인은 아직 지원하지/ }).waitFor();
  assert.equal(f.posts('/api/jobs/legacy-readonly-job/approve').length, 1);
});

test('execution owner UI: running draft/readCopy jobs hide steering while legacy readonly keeps it', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) {
    s.jobs[0].status = 'running'; s.jobs[0].finishedAt = null; s.jobs[0].draft.status = 'running';
    for (const id of ['readonly', 'legacy-readonly']) {
      const b = binding(id); b.allowWrite = false; if (id === 'readonly') b.readProtection = 1; s.bindings.push(b);
      const j = job(b, id + '-job'); delete j.draft; j.status = 'running'; j.finishedAt = null;
      if (id === 'readonly') j.readCopy = { version: 1, status: 'running', manifestDigest: digest('f'), reason: null }; s.jobs.push(j);
    }
  } }), { page } = f;
  for (const id of ['job-a', 'readonly-job']) assert.equal(await f.card(id).getByRole('button', { name: '진행 중 지시 보완', exact: true }).count(), 0);
  for (const id of ['job-a', 'readonly-job', 'legacy-readonly-job']) assert.equal(await f.card(id).getByRole('button', { name: '중단 요청', exact: true }).isEnabled(), true);
  f.handlers.set('/api/jobs/legacy-readonly-job/steer', route => route.fulfill({ json: {} }));
  await f.card('legacy-readonly-job').getByRole('button', { name: '진행 중 지시 보완', exact: true }).click();
  await page.locator('#action-form [name=text]').fill('기존 읽기 전용 지시 보완'); await page.locator('#action-form button[type=submit]').click();
  await page.locator('#action-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(f.posts('/api/jobs/legacy-readonly-job/steer')[0].body, { expectedTurnId: 'turn-legacy-readonly-job', text: '기존 읽기 전용 지시 보완' });
  assert.ok(f.posts('/api/jobs/legacy-readonly-job/steer')[0].commandId);
  assert.deepEqual(f.requests.filter(r => r.path.endsWith('/steer')).map(r => r.path), ['/api/jobs/legacy-readonly-job/steer']);
});

test('execution owner UI: incomplete capture, unsupported file changes and unavailable authority block apply while recovery stays available', { timeout: 30000 }, async t => {
  const f = await open(t, { configure(s) { s.jobs[0].capture.complete = false; s.jobs[0].capture.reason = 'fixture_capture_gap'; } });
  await f.card().getByRole('button', { name: '보호 사본 diff 확인' }).click(); await f.card().locator('.execution-diff').waitFor();
  assert.match(await f.card().locator('.execution-draft').textContent(), /원문 수집이 불완전/); assert.equal(await f.card().getByRole('button', { name: '원본 반영 확인…' }).count(), 0);
  f.handlers.set('/api/jobs/job-a/draft', route => { const value = review(f.snapshot.jobs[0]); value.files.push({ ...value.files[0], path: 'second.txt' }); return route.fulfill({ json: value }); });
  await f.refresh(s => { s.jobs[0].capture.complete = true; s.jobs[0].capture.reason = null; }); await f.card().getByRole('button', { name: 'diff 다시 확인' }).click();
  await f.card().getByText('second.txt', { exact: true }).waitFor(); assert.equal(await f.card().getByRole('button', { name: '원본 반영 확인…' }).count(), 0); assert.match(await f.card().locator('.execution-draft').textContent(), /텍스트 파일 1개의 내용 수정만 반영/);
  f.handlers.set('/api/jobs/job-a/draft', route => route.fulfill({ json: { status: 'blocked', reason: 'protected_workspace_copy_structure_changed', manifestDigest: digest('d'), diffDigest: digest('e'), files: [] } }));
  await f.card().getByRole('button', { name: 'diff 다시 확인' }).click(); await f.card().getByText('원본 반영이 차단되었습니다.', { exact: true }).waitFor(); assert.equal(await f.card().getByRole('button', { name: '원본 반영 확인…' }).count(), 0);
  f.handlers.set('/api/jobs/job-a/draft', route => route.fulfill({ json: { status: 'unchanged', reason: null, files: [] } }));
  await f.card().getByRole('button', { name: 'diff 다시 확인' }).click(); await f.card().getByText('보호 사본의 내용 변경이 없습니다.', { exact: true }).waitFor();
  await f.refresh(s => { delete s.bindings[0].authority; s.jobs[0].status = 'running'; }); assert.equal(await f.card().getByRole('button', { name: '중단 요청', exact: true }).isEnabled(), true);
  await f.refresh(s => { s.jobs[0].status = 'reconciling'; }); assert.equal(await f.card().getByRole('button', { name: '실제 turn 결과 대조', exact: true }).isEnabled(), true); assert.equal(f.posts('/api/jobs/job-a/apply').length, 0);
});

test('execution owner UI: a private page returning after owner lock is discarded', { timeout: 30000 }, async t => {
  const f = await open(t); let release, received;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { received = resolve; });
  f.handlers.set('/api/jobs/job-a/evidence', async route => { received(); await held; await route.fulfill({ json: { ...f.snapshot.jobs[0].capture, pageIndex: 0, nextPage: 1, text: 'LATE PRIVATE RAW' } }); });
  await f.card().getByRole('button', { name: '원문 첫 페이지 보기' }).click(); await started;
  f.handlers.set('/api/logout', route => route.fulfill({ json: {} })); await f.page.locator('#logout').click(); await f.page.locator('#login:not([hidden])').waitFor();
  const response = f.page.waitForResponse(res => new URL(res.url()).pathname.endsWith('/evidence')); release(); await response; await settle(f.page);
  assert.equal(await f.page.locator('.execution-raw').count(), 0); assert.equal(await f.page.getByText('LATE PRIVATE RAW', { exact: true }).count(), 0);
});
