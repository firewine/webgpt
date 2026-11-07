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
  await f.card().getByRole('button', { name: '취소', exact: true }).click(); assert.deepEqual(f.posts('/api/jobs/job-a/approve').map(r => r.body.decision), ['decline', 'cancel']);
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
