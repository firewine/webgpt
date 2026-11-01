export async function closeTopicDetails(page) { if (await page.locator('#topic-details-dialog').evaluate(d => d.open)) await page.locator('#topic-details-close').click(); }
export async function openNewTopic(page) {
  await closeTopicDetails(page); await page.locator('[data-view=room]').click();
  if (await page.locator('#room-member-toggle').isVisible()) await page.locator('#room-member-toggle').click();
  await page.locator('#chat-new-topic').click(); await page.locator('#topic').waitFor();
}
export async function openTopicDetails(page) { await page.locator('#topic-details-open').click(); await page.locator('#discussion-detail').waitFor(); }
export async function openExistingTopic(page, name) {
  await closeTopicDetails(page); await page.locator('[data-view=room]').click();
  if (await page.locator('#room-member-toggle').isVisible()) await page.locator('#room-member-toggle').click();
  const button = name ? page.locator('#history').getByRole('button', { name, exact: true }) : page.locator('#history button').first();
  const id = await button.getAttribute('data-discussion-id'); await button.click();
  await page.waitForFunction(value => document.querySelector('#topic-chat').dataset.discussionId === value, id); await openTopicDetails(page);
}
