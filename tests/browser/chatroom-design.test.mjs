import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { workspace, ownerKey } from '../workspace-helpers.mjs';

const output = 'test-results/resident/gui-refinement';
async function launch(t) { const b = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => b.close()); return b; }
async function fixture(t) {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); let calls = 0;
  f.app.providers.complete = async () => { calls++; throw new Error('Design preview must not dispatch'); };
  f.app.store.transact(s => {
    s.participants = ['설계 파트너', '검증 파트너', 'dot', 'Muse'].map((label, i) => ({ id: 'design-' + i, label, kind: 'fake', connectionId: null, modelId: 'design-fixture', role: '디자인 검토용 모의 참여자' }));
    const r = s.resident.rooms[0]; r.title = '웹쫀쿠 단톡방'; r.desiredOn = false; r.members = s.participants.map(p => ({ participantId: p.id, enabled: true }));
    r.pacing = { minIntervalMs: 15000, idleNudgeMs: 120000, passBackoffMs: 15000, sleepAfterPasses: 3 };
    r.budgets = { maxRequests: 30, maxTokens: 100000, maxToolJobs: 2, deadlineAt: new Date(Date.now() + 3600000).toISOString() };
    const texts = [
      ['owner', '오늘은 우리가 함께 쓸 작업실 화면을 살펴보자. 각자 어떤 점이 필요한지 이야기해 줘.'],
      ['design-0', '대화가 가운데에 모여 있으면 좋겠어요. 왼쪽에서는 누가 참여하는지 한눈에 보고요.'],
      ['design-1', '좋아요. 긴 의견도 원문은 남겨야 해요. 서로 다른 생각은 비교해서 보고, 확인하지 않은 건 따로 표시합시다.'],
      ['design-2', '자료를 볼 때마다 대화를 벗어날 필요는 없겠네. 오른쪽 작업실에 자료와 실행 기록을 모아 두면 되겠다.'],
      ['design-3', '인용 답장으로 누구의 어떤 의견을 검토하는지도 보여 주세요. 대화 흐름을 따라가기 쉬울 거예요.'],
      ['design-0', '그럼 대화는 말풍선으로, 자료와 사용량은 옆 탭으로 나누죠. 설정은 왼쪽에 두고요.'],
      ['owner', '좋아. 화면은 가볍게 만들고, 기존 연결과 기록은 그대로 유지하자.'],
      ['design-1', '확인했어요. 모델의 동의와 실제 검증은 계속 구분하고, 실행 승인도 원래 절차대로 유지할게요.'],
    ];
    texts.forEach(([authorId, text], i) => s.resident.messages.push({ id: 'design-message-' + i, roomId: r.id, sequence: i + 1, sourceKind: authorId === 'owner' ? 'user' : 'room', sourceId: null, authorId, text, replyTo: i === 5 ? 'design-message-1' : null, mentions: i === 5 ? ['design-1'] : [], visibility: 'room_public', createdAt: new Date(Date.UTC(2026, 9, 30, 10, 40 + i)).toISOString() }));
    r.lastMessageSequence = texts.length;
  });
  return { ...f, calls: () => calls };
}
async function open(browser, f, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; const posts = []; const external = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); if (!r.url().startsWith(f.url)) external.push(r.url()); });
  await page.goto(f.url); await page.waitForFunction(() => document.querySelectorAll('#room-members .room-member').length === 4 && document.querySelectorAll('.room-message').length === 8);
  return { context, page, errors, posts, external };
}

test('reference layout: compact members/power, avatar bubbles, tabbed board and visible composer at four widths', { timeout: 60000 }, async t => {
  const f = await fixture(t); const browser = await launch(t); await mkdir(output, { recursive: true }); const evidence = [];
  for (const width of [390, 768, 1024, 1440]) {
    const { page, context, errors, posts, external } = await open(browser, f, width);
    await page.locator('#room-timeline').evaluate(n => { n.scrollTop = 0; });
    const bounds = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      return { overflow: document.documentElement.scrollWidth > innerWidth, chat: box('.chat-column'), sidebar: box('.sidebar'), composer: box('#room-message-form'), timeline: box('#room-timeline'), bubble: box('.room-message:not(.mine) .message-text'), avatar: box('.room-message:not(.mine) .avatar'), color: getComputedStyle(document.querySelector('#view-room')).backgroundColor };
    });
    assert.equal(bounds.overflow, false); assert.ok(bounds.composer.bottom <= (width === 390 ? 844 : 1000)); assert.ok(bounds.timeline.height > 250); assert.equal(bounds.color, 'rgb(245, 245, 245)');
    assert.ok(bounds.avatar.x < bounds.bubble.x); assert.ok(bounds.avatar.width >= 30);
    if (width === 1440) {
      const leftPower = await page.locator('#room-power').boundingBox(); const board = await page.locator('#room-panel').boundingBox();
      assert.ok(leftPower.x < bounds.chat.x); assert.ok(board.x >= bounds.chat.x + bounds.chat.width - 2); assert.ok(bounds.sidebar.width >= 240 && bounds.sidebar.width <= 280);
      assert.equal(await page.locator('#room-panel [role=tab]').count(), 3); assert.equal(await page.locator('#board-workspace').isVisible(), true);
    }
    if (width <= 768) {
      await page.locator('#room-member-toggle').click(); await page.getByRole('checkbox', { name: 'Muse 발언 참여' }).waitFor(); assert.equal(await page.locator('#room-settings').isVisible(), true);
      await page.locator('#room-members-dialog').getByRole('button', { name: '닫기', exact: true }).click();
    } else assert.equal(await page.locator('#room-power').isVisible(), true);
    if (width < 1280) {
      await page.locator('#room-panel-toggle').click(); await page.getByRole('tab', { name: '사용량', exact: true }).click(); assert.equal(await page.locator('#room-usage').isVisible(), true);
      await page.locator('#room-panel-dialog').getByRole('button', { name: '닫기', exact: true }).click();
    }
    await page.screenshot({ path: `${output}/chatroom-${width}.png` });
    evidence.push({ width, ...bounds }); assert.deepEqual(errors, []); assert.deepEqual(posts, []); assert.deepEqual(external, []); await context.close();
  }
  assert.equal(f.calls(), 0); assert.equal(f.app.store.read().resident.turns.length, 0); await writeFile(`${output}/layout.json`, JSON.stringify(evidence, null, 2));
});

test('board keyboard navigation, collapse, theme and reply draft survive UI navigation without backend mutation', { timeout: 45000 }, async t => {
  const f = await fixture(t); const browser = await launch(t); const { page, errors, posts } = await open(browser, f); const before = f.app.store.cursor();
  await page.locator('#board-tab-workspace').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#board-tab-usage').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End'); assert.equal(await page.locator('#board-tab-activity').getAttribute('aria-selected'), 'true');
  await page.locator('#room-panel-close').click(); assert.equal(await page.locator('#room-panel').isVisible(), false); assert.equal(await page.locator('#room-panel-toggle').getAttribute('aria-expanded'), 'false');
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.room-message').length === 8); assert.equal(await page.locator('#room-panel').isVisible(), false);
  await page.locator('#room-panel-toggle').click(); assert.equal(await page.locator('#board-tab-activity').getAttribute('aria-selected'), 'true');
  await page.locator('.room-message').nth(1).getByRole('button', { name: '답장', exact: true }).click(); await page.locator('#room-text').fill('아직 보내지 않은 나의 의견');
  await page.locator('[data-view=connections]').click(); await page.locator('[data-view=room]').click(); assert.equal(await page.locator('#room-text').inputValue(), '아직 보내지 않은 나의 의견'); assert.match(await page.locator('#room-reply').textContent(), /설계 파트너/);
  await page.locator('#theme-toggle').click(); await page.getByRole('tab', { name: '작업실', exact: true }).click(); await page.screenshot({ path: `${output}/chatroom-dark-1440.png` });
  await page.locator('.room-message').nth(1).getByRole('button', { name: '원문·근거', exact: true }).click(); await page.locator('#room-raw').waitFor(); assert.equal(await page.locator('#board-tab-activity').getAttribute('aria-selected'), 'true');
  assert.equal(f.app.store.cursor(), before); assert.equal(f.calls(), 0); assert.deepEqual(posts, []); assert.deepEqual(errors, []);
});

test('feature off keeps the chat shell and legacy topic records readable without enabling anything', { timeout: 30000 }, async t => {
  const f = await workspace(t); const browser = await launch(t); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } }); const page = await context.newPage();
  await page.goto(f.url); await page.locator('#view-room').waitFor(); await page.locator('#room-disabled').waitFor();
  assert.equal(await page.locator('#room-send').isDisabled(), true); assert.equal(f.app.store.read().resident, undefined); assert.equal(await page.locator('#room-text').isVisible(), true);
  await page.locator('#room-member-toggle').click(); assert.equal(await page.locator('#room-power').isDisabled(), true); assert.equal(await page.locator('#room-settings').isDisabled(), true); await page.locator('#room-members-dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await page.locator('[data-view=connections]').click(); await page.locator('#oauth-form').waitFor(); const title = await page.locator('#view-connections h1').evaluate(n => parseFloat(getComputedStyle(n).fontSize)); assert.ok(title <= 25);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(f.app.store.read().resident, undefined);
});
