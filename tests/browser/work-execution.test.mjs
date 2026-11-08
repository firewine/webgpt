import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';
import { executionFixture } from '../work-execution-fixture.mjs';
import { ownerKey, until } from '../workspace-helpers.mjs';
const output = 'test-results/resident/R6';
async function open(t, f) {
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(f.url + '/**', async route => { const path = new URL(route.request().url()).pathname; if (path.startsWith('/api/')) await route.continue(); else await route.fulfill(await scopedAsset(path)); });
  await page.goto(f.url); await page.locator('#work-new').waitFor(); return { page, errors };
}
async function board(page) { if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click(); await page.locator('#board-tab-workspace').click(); }
async function detail(page) { await board(page); await page.locator('#work-items .work-card').first().getByRole('button').click(); await page.locator('#work-detail-dialog').waitFor(); }

// Isolated owner HTTP contract for the new scope fields. Serve current frontend
// source and synthetic records: no executor or model, and no backend scope bypass.
const scopedOrigin = 'http://127.0.0.1:45322', scopedAssets = new Map();
function scope(protection = 'draft', state = 'ready') { return { version: 1, state, digest: '7'.repeat(64), requestDigest: '8'.repeat(64), contextDigest: '9'.repeat(64), command: "/bin/bash -c 'cat exact.txt' # <img src=x onerror=window.injected=true>", cwd: '/fixture/protected copy', profileId: protection === 'draft' ? 'webjjoku_copy' : 'webjjoku_read', reason: null }; }
async function scopedAsset(path) {
  if (!scopedAssets.has(path)) scopedAssets.set(path, (async () => {
    const name = path === '/' ? 'control.html' : path.slice(1); assert.match(name, /^(?:control\.(?:html|css|js)|(?:dot-connections|room-view|topic-chat-view|wiki-view)\.js)$/);
    const source = await readFile(new URL('../../src/web/' + name.replace(/\.js$/, '.ts'), import.meta.url), 'utf8');
    return { contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: name.endsWith('.js') ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText : source };
  })()); return scopedAssets.get(path);
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function reloadScopedRecord(page) {
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/rooms/room-a/work/task-a');
  await page.getByRole('button', { name: '기록 새로고침', exact: true }).click(); await response; await settle(page);
}
async function openScopedRoom(t, { protection = 'draft', state = 'ready', legacy = false } = {}) {
  const at = new Date().toISOString(), auth = { version: 1, epoch: 1, issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), revokedAt: null };
  const binding = { id: 'binding-a', label: '모의 보호 사본', host: 'fixture', user: 'owner', cwd: '/fixture/original', threadId: 'thread-a', allowWrite: protection === 'draft', status: 'ready', branch: 'fixture', authority: auth };
  const job = { id: 'room-job', bindingId: binding.id, discussionId: null, status: 'blocked_approval', threadId: 'thread-a', turnId: 'turn-a', prompt: '모의 실행', text: '', error: null, activities: [], authority: { version: 1, binding: { id: binding.id, epoch: auth.epoch, expiresAt: auth.expiresAt } }, approvals: [{ id: 'room-approval', rpcId: '017', method: 'item/commandExecution/requestApproval', status: 'pending', params: { command: 'untrusted display hint', cwd: '/wrong/hint' }, ...(!legacy ? { scope: scope(protection, state) } : {}) }], ...(!legacy ? { [protection]: { version: 1, status: 'running', manifestDigest: 'd'.repeat(64), reason: null } } : {}) };
  const room = { id: 'room-a', title: '승인 확인 fixture', version: 1, epoch: 1, desiredOn: true, observedStatus: 'on', members: [], legacyDiscussionIds: [], topicLink: null, lastMessageSequence: 0, createdAt: at, updatedAt: at };
  const task = { id: 'task-a', roomId: room.id, version: 1, title: '명령 1회 확인', description: '격리된 화면 계약', kind: 'codex', status: 'claimed', reason: null, acceptance: [], sourceMessageIds: [], dependencies: [], allowedParticipantIds: [], authorizedScopeRef: 'binding:' + binding.id, reports: [], reviews: [], priority: 0, currentReportId: null };
  const link = { taskId: task.id, codexJobId: job.id, binding, input: { requestId: 'fixture-request', prompt: '모의 실행' }, status: 'running', intentDigest: 'a'.repeat(64), result: null, error: null };
  const snapshot = { cursor: 1, connections: [], participants: [], discussions: [], bindings: [binding], jobs: [job], grants: [], browserPaused: false, capabilities: { sourceFetch: false, browserConfigured: false, noVncConfigured: false, codexConfigured: true }, materialPackages: [], materialRoots: [], resident: { enabled: true, rooms: [room] }, apiDaily: { configured: false } };
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(5000);
  const errors = [], unexpected = [], requests = [], accepted = []; let eventId = 1;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('wj.room.view', 'room'); window.EventSource = class extends EventTarget { constructor() { super(); window.roomEvents = this; } close() {} }; });
  await page.route(scopedOrigin + '/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!path.startsWith('/api/')) { await route.fulfill(await scopedAsset(path)); return; }
    const request = { path, method: req.method(), body: req.postData() ? req.postDataJSON() : undefined, commandId: req.headers()['idempotency-key'] }; requests.push(request);
    let json;
    if (path === '/api/auth') json = { passwordConfigured: true, canSetup: false };
    else if (path === '/api/state') json = snapshot;
    else if (path === '/api/logout' || path === '/api/login') json = {};
    else if (path === '/api/rooms/room-a') json = { room, enabled: true, dispatchAvailable: true, contexts: [], status: { members: [], notices: [] } };
    else if (path === '/api/rooms/room-a/messages') json = { messages: [], nextAfter: 0, hasMore: false };
    else if (path === '/api/rooms/room-a/turns') json = { turns: [], hasMore: false };
    else if (path === '/api/rooms/room-a/work') json = { items: [{ ...task, reportCount: 0, reviewCount: 0 }], seats: [], executions: [{ taskId: task.id, codexJobId: job.id }], nextAfter: 0, hasMore: false, cursor: snapshot.cursor, enabled: true };
    else if (path === '/api/rooms/room-a/wiki') json = { items: [], pins: [], selection: 'automatic', nextAfter: 0, hasMore: false, enabled: true };
    else if (path === '/api/rooms/room-a/work/task-a') json = { task, attempts: [{ status: 'running' }], executions: [{ link, job }] };
    else if (path === '/api/jobs/room-job/approve') {
      if (request.body.decision === 'accept') {
        const current = job.approvals[0].scope;
        if (!legacy && (job.status !== 'blocked_approval' || job.approvals[0].status !== 'pending' || current?.state !== 'ready' || request.body.expectedScopeDigest !== current.digest || request.body.ownerConfirmed !== true)) { await route.fulfill({ status: 409, json: { error: { code: 'scoped_approval_scope_changed' } } }); return; }
        accepted.push(request); job.approvals[0].status = 'resolved'; if (current) current.state = 'sent'; job.status = 'running';
      }
      json = {};
    } else { unexpected.push(path); await route.fulfill({ status: 404, json: { error: { code: 'unexpected_fixture_request' } } }); return; }
    await route.fulfill({ json: structuredClone(json) });
  });
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); });
  await page.goto(scopedOrigin); await page.locator('#work-items .work-card').waitFor(); await detail(page);
  const refresh = async change => {
    change?.(job); snapshot.cursor = ++eventId;
    const done = page.waitForResponse(res => new URL(res.url()).pathname === '/api/rooms/room-a/wiki');
    await page.evaluate(id => window.roomEvents.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ id }) })), eventId); await done; await settle(page);
  };
  return { page, job, requests, accepted, refresh, posts: () => requests.filter(r => r.path === '/api/jobs/room-job/approve' && r.method === 'POST') };
}

for (const protection of ['draft', 'readCopy']) test(`R6 scoped room UI: ${protection} requires unchecked owner consent and sends the displayed one-time scope`, { timeout: 30000 }, async t => {
  const f = await openScopedRoom(t, { protection }), { page } = f, card = page.locator('#work-detail [data-job-id=room-job]');
  const form = card.locator('.scoped-command-confirmation'), checkbox = form.getByRole('checkbox'), approve = form.getByRole('button', { name: '이 명령 1회 승인', exact: true }), shown = { ...f.job.approvals[0].scope };
  assert.equal(await form.locator('.scoped-command').textContent(), shown.command); assert.equal(await form.locator('.scoped-cwd').textContent(), shown.cwd); assert.equal(await form.locator('.scoped-profile').textContent(), protection === 'readCopy' ? '읽기 전용' : '보호 사본 수정');
  assert.equal(await form.locator('img').count(), 0); assert.equal(await checkbox.isChecked(), false); assert.equal(await approve.isDisabled(), true);
  await form.dispatchEvent('submit'); await settle(page); assert.equal(f.posts().length, 0);
  await checkbox.check(); await f.refresh(); assert.equal(await checkbox.isChecked(), false); assert.equal(await approve.isDisabled(), true); assert.equal(f.posts().length, 0);
  await checkbox.check(); await reloadScopedRecord(page); assert.equal(await checkbox.isChecked(), false); assert.equal(await approve.isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await checkbox.isChecked(), false); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await checkbox.check(); const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/jobs/room-job/approve'); await approve.click(); await response;
  await card.locator('.scoped-command-confirmation').waitFor({ state: 'detached' });
  assert.deepEqual(f.posts().map(r => r.body), [{ approvalId: 'room-approval', decision: 'accept', expectedScopeDigest: shown.digest, ownerConfirmed: true }]); assert.ok(f.posts()[0].commandId); assert.equal(f.accepted.length, 1);
  assert.equal(f.requests.some(r => r.path.endsWith('/apply') || r.path.endsWith('/steer')), false);
});

test('R6 scoped room UI: stale displayed digest is preserved for the backend guard and never silently upgraded', { timeout: 30000 }, async t => {
  const f = await openScopedRoom(t), { page } = f, form = page.locator('#work-detail .scoped-command-confirmation'), shownDigest = f.job.approvals[0].scope.digest;
  await form.getByRole('checkbox').check(); await f.refresh(j => { j.approvals[0].scope.digest = '6'.repeat(64); });
  assert.equal(await form.getByRole('checkbox').isChecked(), false); assert.match(await form.textContent(), new RegExp(shownDigest));
  await form.getByRole('checkbox').check(); await form.getByRole('button', { name: '이 명령 1회 승인' }).click();
  await page.locator('#notice').filter({ hasText: /확인한 명령이나 승인 상태가 바뀌었습니다/ }).waitFor();
  assert.equal(f.posts()[0].body.expectedScopeDigest, shownDigest); assert.equal(f.accepted.length, 0); assert.equal(await form.getByRole('button', { name: '이 명령 1회 승인' }).isDisabled(), true);
  await reloadScopedRecord(page); assert.match(await form.textContent(), /666666/); assert.equal(await form.getByRole('checkbox').isChecked(), false);
});

test('R6 scoped room UI: stale ready state cannot approve and non-ready states retain warnings and rejection controls', { timeout: 30000 }, async t => {
  const f = await openScopedRoom(t, { protection: 'readCopy' }), { page } = f;
  const form = page.locator('#work-detail .scoped-command-confirmation'); await form.getByRole('checkbox').check(); f.job.approvals[0].scope.state = 'selected';
  await form.getByRole('button', { name: '이 명령 1회 승인' }).click(); await page.locator('#notice').filter({ hasText: /확인한 명령이나 승인 상태/ }).waitFor(); assert.equal(f.accepted.length, 0);
  const messages = { checking: '보호 범위를 확인하고 있습니다', blocked: '보호 범위를 확인하지 못했습니다', selected: '승인 선택이 기록되었습니다', sent: '1회 승인을 전달했습니다', unconfirmed: '승인 전달 결과를 확인하지 못했습니다' };
  for (const [state, message] of Object.entries(messages)) {
    f.job.approvals[0].scope.state = state; await reloadScopedRecord(page);
    assert.match(await page.locator('#work-detail .scoped-command-status').textContent(), new RegExp(message));
    assert.equal(await page.locator('#work-detail').getByRole('button', { name: '이 명령 1회 승인', exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator('#work-detail').textContent(), /추가 권한 승인은 지원하지 않습니다/);
    for (const name of ['이번 실행 요청 거절', '이번 실행 요청 취소']) assert.equal(await page.getByRole('button', { name, exact: true }).isEnabled(), true);
  }
  delete f.job.approvals[0].scope; await reloadScopedRecord(page);
  for (const name of ['이번 실행 요청 거절', '이번 실행 요청 취소']) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
  assert.deepEqual(f.posts().slice(1).map(r => r.body), [{ approvalId: 'room-approval', decision: 'decline' }, { approvalId: 'room-approval', decision: 'cancel' }]); assert.equal(f.accepted.length, 0);
  f.job.approvals[0].scope = scope('readCopy', 'unconfirmed'); f.job.status = 'reconciling'; await reloadScopedRecord(page);
  assert.match(await page.locator('#work-detail .scoped-command-status').textContent(), /승인 전달 결과를 확인하지 못했습니다/);
  assert.equal(await page.getByRole('button', { name: '원래 Codex 실행 대조', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: '이 명령 1회 승인', exact: true }).count(), 0);
});

test('R6 scoped room UI: owner lock clears confirmation and legacy approval payload stays unchanged', { timeout: 30000 }, async t => {
  const f = await openScopedRoom(t), { page } = f, form = page.locator('#work-detail .scoped-command-confirmation'); await form.getByRole('checkbox').check(); const retained = await form.elementHandle();
  await page.keyboard.press('Escape'); await page.locator('#logout').click(); await page.locator('#login:not([hidden])').waitFor(); assert.equal(await form.count(), 0);
  assert.equal(await retained.evaluate(form => form.querySelector('input').checked), false);
  await retained.evaluate(form => { document.body.append(form); form.requestSubmit(); }); await settle(page); assert.equal(f.posts().length, 0);
  const legacy = await openScopedRoom(t, { legacy: true });
  assert.equal(await legacy.page.locator('#work-detail .scoped-command-confirmation').count(), 0);
  await legacy.page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).click(); await settle(legacy.page);
  assert.deepEqual(legacy.posts().map(r => r.body), [{ approvalId: 'room-approval', decision: 'accept' }]); assert.equal(legacy.accepted.length, 1);
});

test('R6 browser: scoped work form -> original Codex approval -> command evidence -> independent review at four widths', { timeout: 60000 }, async t => {
  const f = await executionFixture(t, { mode: 'approval' }); const { page, errors } = await open(t, f);
  await page.locator('.room-message').first().getByRole('button', { name: '일감 만들기', exact: true }).click(); const form = page.locator('#work-form');
  await form.locator('[name=title]').fill('등록 작업 공간의 읽기 전용 검증'); await form.locator('[name=kind]').selectOption('codex');
  await form.locator('[name=acceptance]').fill('실제 기록된 명령의 종료 상태를 확인'); await form.locator('[name=checkKind]').selectOption('execution');
  await form.locator('[name=allowedParticipantId][value=fake-a]').check(); await form.locator('[name=authorizedScopeRef]').selectOption('binding:' + f.bindingId);
  await form.getByRole('button', { name: '일감 저장', exact: true }).click(); await until(() => f.app.store.read().resident.workItems.length === 1); const id = f.app.store.read().resident.workItems[0].id;
  f.bridge.tick(); await until(() => f.app.store.read().jobs[0]?.status === 'blocked_approval'); await detail(page);
  await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).waitFor(); assert.match(await page.locator('#work-detail').textContent(), /실행 승인 요청/);
  await mkdir(output, { recursive: true }); await page.screenshot({ path: output + '/approval-1440.png' });
  await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).click(); await until(() => f.app.store.read().jobs[0].status === 'completed'); f.bridge.tick(); await f.step();
  await page.waitForFunction(() => document.querySelector('#work-items').textContent.includes('업무 완료'));
  if (await page.locator('#work-detail-dialog').evaluate(n => n.open)) await page.keyboard.press('Escape');
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await detail(page);
    await page.locator('#work-detail > details').getByText(/실제 executor journal/).waitFor(); assert.match(await page.locator('#work-detail').textContent(), /업무 완료/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: `${output}/report-${width}.png` }); await page.keyboard.press('Escape');
    await board(page); await page.locator('#work-board').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/queue-${width}.png` });
    const drawer = page.locator('#room-panel-dialog[open]'); if (await drawer.count()) await drawer.getByRole('button', { name: '닫기', exact: true }).click();
  }
  assert.equal(f.task(id).reports.length, 1); assert.equal(f.task(id).reviews[0].reviewerId, 'fake-b'); assert.equal((await f.trace()).filter(v => v.id === '017' && v.result?.decision === 'accept').length, 1);
  assert.deepEqual(errors, []);
});

test('R6 browser: room off refuses a late approval, preserves pending request and allows a separate execution interruption', { timeout: 45000 }, async t => {
  const f = await executionFixture(t, { mode: 'approval' }); const id = f.proposeCode(); f.bridge.tick(); await until(() => f.app.store.read().jobs[0]?.status === 'blocked_approval');
  const { page, errors } = await open(t, f); await detail(page); f.control({ action: 'off' });
  await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('방·역할·업무 버전'));
  assert.equal(f.app.store.read().jobs[0].status, 'blocked_approval'); assert.equal(f.app.store.read().jobs[0].approvals[0].status, 'pending');
  assert.equal((await f.trace()).filter(v => v.id === '017' && v.result?.decision === 'accept').length, 0);
  await page.getByRole('button', { name: '이 실행만 중단 요청', exact: true }).click(); await until(() => f.app.store.read().jobs[0].status === 'interrupted'); f.bridge.tick();
  assert.equal(f.task(id).currentReportId, null); assert.equal(f.app.store.read().resident.jobLinks[0].reported, true); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1); assert.deepEqual(errors, []);
});

test('R6 browser: original remote receipt reconciliation reuses one job and keeps unobserved execution as not_run', { timeout: 45000 }, async t => {
  const f = await executionFixture(t, { mode: 'disconnect' }); const id = f.proposeCode(); f.bridge.tick(); await until(() => f.app.store.read().jobs[0]?.status === 'reconciling'); f.bridge.tick();
  const { page, errors } = await open(t, f); await detail(page); assert.equal(await page.getByLabel('원래 Codex turn ID').inputValue(), f.app.store.read().jobs[0].turnId);
  await page.getByRole('button', { name: '원래 Codex 실행 대조', exact: true }).click(); await until(() => f.app.store.read().jobs[0].status === 'completed'); f.bridge.tick();
  await page.getByRole('button', { name: '기록 새로고침', exact: true }).click(); await page.locator('#work-detail').getByText('원문 수집이 불완전해 현재 업무 수락을 보류했습니다. 원래 실행과 근거는 보존됩니다.', { exact: true }).waitFor();
  assert.equal(f.task(id).reports.length, 0); assert.equal(f.app.store.read().resident.jobLinks[0].result.report.checks[0].outcome, 'not_run'); assert.equal(f.task(id).currentReportId, null); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1); assert.equal(f.app.store.read().jobs.length, 1); assert.deepEqual(errors, []);
});

for (const protection of ['draft', 'readCopy']) test(`R6 browser: ${protection} work never offers expanding approval from the room detail`, async t => {
  const f = await executionFixture(t, { mode: 'approval' }); f.proposeCode(); f.bridge.tick();
  await until(() => f.app.store.read().jobs[0]?.status === 'blocked_approval');
  // Explicit stored fixture only: the room must apply the same UI boundary as execution view.
  f.app.store.transact(s => { s.jobs[0][protection] = { version: 1, status: 'running' }; });
  const { page, errors } = await open(t, f); await detail(page);
  assert.equal(await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '이번 실행 요청 취소', exact: true }).count(), 1);
  await page.getByRole('button', { name: '이번 실행 요청 취소', exact: true }).click();
  await until(() => f.app.store.read().jobs[0].status === 'interrupted');
  assert.equal((await f.trace()).filter(v => v.result?.decision === 'accept').length, 0); assert.deepEqual(errors, []);
});
