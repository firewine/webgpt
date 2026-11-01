import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { workspace, ownerKey, until, response, topic } from '../workspace-helpers.mjs';
import { budget } from '../resident-fixture.mjs';

const output = 'test-results/resident/pinned-topic';
const goal = '서로 다른 AI가 같은 주제를 검토하고, 근거와 남은 이견을 보존하는 작업실을 만들자.';
async function prepare(t) {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false });
  const roomId = f.app.store.read().resident.rooms[0].id;
  const control = body => f.app.resident.control(roomId, { expectedVersion: f.app.store.read().resident.rooms[0].version, ...body }, crypto.randomUUID());
  control({ action: 'configure', budgets: budget(Date.now(), 60), pacing: { minIntervalMs: 600000, idleNudgeMs: 3600000, passBackoffMs: 600000, sleepAfterPasses: 3 } });
  for (const participantId of ['fake-a', 'fake-b']) control({ action: 'set_member', participantId, enabled: true }); control({ action: 'on' });
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; const posts = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  return { ...f, roomId, page, errors, posts };
}

test('pinned topic -> same-room discussion -> reviewed conclusion survives return/reload without publishing an unfinished round', { timeout: 90000 }, async t => {
  const f = await prepare(t); const { page } = f; const releases = new Map(); let calls = 0;
  f.app.providers.complete = async input => {
    calls++; input.hooks.dispatched(); const d = f.app.store.read().discussions[0];
    const hold = d.phase === 'independent' ? input.participant.id : d.phase === 'summary_review' ? 'review' : null;
    if (hold) { input.hooks.delta('UNPUBLISHED-' + hold); await new Promise((resolve, reject) => { releases.set(hold, resolve); input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }); }); }
    const answer = JSON.parse(response(input.prompt, input.participant)); answer.verifications = [];
    answer.text = d.phase === 'synthesis' ? '종합안: 주제를 위에 고정하고 서로 검토한 뒤, 근거와 이견을 같은 방에 남긴다.' : d.phase === 'summary_review' ? '동료 검토: 화면과 토론 절차는 확인했지만 실계정 연결은 추가 확인이 필요하다.' : `${input.participant.label}: ${d.phase}에서 같은 주제를 독립적으로 검토했습니다.`;
    answer.uncertainty = ['실계정 검증은 미실행입니다.'];
    if (d.phase === 'summary_review') answer.reviews = [{ claimId: d.claims.at(-1).id, stance: 'challenge', reason: '합의만으로 실제 검증 완료라고 할 수 없습니다.' }];
    return { text: JSON.stringify(answer), receipt: 'topic-fixture-' + calls, usage: { input: 3, output: 5 } };
  };
  await page.goto(f.url); await page.locator('#room-focus-new').click(); await page.locator('#topic').fill(goal); await page.getByText('참고 자료와 진행 범위', { exact: true }).click(); await page.locator('#discussion-form [name=maxRounds]').selectOption('1');
  await page.getByRole('button', { name: /토의 시작/ }).click(); await until(() => releases.has('fake-a')); await page.locator('#topic-chat').waitFor(); await page.locator('#chat-free').click();
  await page.waitForFunction(() => !document.querySelector('#view-room').hidden && document.querySelector('#room-topic-title').textContent.includes('같은 주제'));
  assert.equal(f.posts.filter(p => p.endsWith('/focus')).length, 1); assert.match(await page.locator('#room-topic-progress').textContent(), /독립 초기안/);
  releases.get('fake-a')(); await until(() => releases.has('fake-b')); await f.app.residentRunner.tick();
  assert.equal(await page.locator('.room-message').count(), 0); assert.equal(await page.locator('#room-topic-result').isDisabled(), true);
  releases.get('fake-b')(); await until(() => releases.has('review')); await f.app.residentRunner.tick();
  await page.waitForFunction(() => document.querySelectorAll('.room-message').length === 7 && document.querySelector('#room-topic-result').textContent.includes('검토 중'));
  await page.locator('#room-topic-result').click(); assert.match(await page.locator('#room-result-content').textContent(), /종합안: 주제를 위에 고정/); assert.doesNotMatch(await page.locator('#room-result-content').textContent(), /UNPUBLISHED|동료 검토: 화면/);
  await page.locator('#room-result-dialog').getByRole('button', { name: '닫기', exact: true }).click(); releases.get('review')();
  await until(() => f.app.store.read().discussions[0].status === 'completed'); await f.app.residentRunner.tick();
  await page.waitForFunction(() => document.querySelector('#room-topic-state').textContent === '마지막 주제 · 토론 절차 완료');
  assert.match(await page.locator('#room-topic-summary').textContent(), /종합안: 주제를 위에 고정/);
  assert.equal(f.app.store.read().resident.rooms[0].topicLink, null); assert.equal(await page.locator('#room-topic-title').textContent(), goal);
  const count = calls; await page.reload(); await page.waitForFunction(() => document.querySelector('#room-topic-state').textContent.includes('마지막 주제'));
  await mkdir(output, { recursive: true });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const before = await page.locator('#room-topic').boundingBox(); await page.locator('#room-timeline').evaluate(n => { n.scrollTop = n.scrollHeight; });
    const after = await page.locator('#room-topic').boundingBox(); assert.equal(after.y, before.y);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok((await page.locator('#room-message-form').boundingBox()).y > after.y + after.height); assert.equal(await page.locator('#room-text').isVisible(), true);
    await page.screenshot({ path: `${output}/room-completed-${width}.png` });
    await page.locator('#room-topic-result').click(); assert.match(await page.locator('#room-result-content').textContent(), /실계정 검증은 미실행/); assert.match(await page.locator('#room-result-content').textContent(), /이견/); assert.match(await page.locator('#room-result-content').textContent(), /합의만으로/);
    const review = page.locator('#room-result-content > .topic-report').last(); if (!await review.evaluate(n => n.open)) await review.locator(':scope > summary').click();
    await page.locator('#room-result-content').getByText('동료 검토: 화면과 토론 절차는 확인했지만 실계정 연결은 추가 확인이 필요하다.', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/results-${width}.png` }); await page.keyboard.press('Escape');
  }
  assert.equal(calls, count); assert.equal(count, 8); assert.deepEqual(f.errors, []);
});

test('room pin rejects unrelated legacy topics and shows partial results as incomplete without dispatching on read', { timeout: 45000 }, async t => {
  const f = await prepare(t); const { page } = f; let calls = 0; f.app.providers.complete = async () => { calls++; throw new Error('Read must not dispatch'); }; f.app.engine.kick = () => {};
  const unrelated = f.app.engine.create({ ...topic, topic: '다른 방의 비공개 목표' }, 'unrelated');
  f.app.store.transact(s => { s.discussions[0].status = 'cancelled'; s.resident.rooms[0].legacyDiscussionIds.push(unrelated); });
  await page.goto(f.url); await page.locator('#room-topic').waitFor(); assert.doesNotMatch(await page.locator('#room-topic').textContent(), /다른 방의 비공개 목표/);
  const id = f.app.residentRunner.focus(f.roomId, { ...topic, topic: goal }, 'partial-goal');
  f.app.store.transact(s => { const d = s.discussions.find(d => d.id === id); d.status = 'partial'; d.phase = 'synthesis'; d.reason = 'budget_exhausted'; }); await f.app.residentRunner.tick();
  await page.waitForFunction(() => document.querySelector('#room-topic-state').textContent.includes('부분 완료'));
  await page.locator('#room-topic-result').click(); assert.match(await page.locator('#room-result-content').textContent(), /공개가 확정된 종합안은 없습니다/); assert.doesNotMatch(await page.locator('#room-result-content').textContent(), /토론 절차 완료/); await page.keyboard.press('Escape');
  await page.route('**/api/discussions/' + id, route => route.fulfill({ status: 503, json: { error: { code: 'fixture_unavailable' } } }));
  await page.reload(); await page.waitForFunction(() => document.querySelector('#room-topic-title').textContent.includes('주제 연결을 확인'));
  assert.equal(await page.locator('#room-topic-result').isVisible(), false); assert.equal(calls, 0); assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []);
});
