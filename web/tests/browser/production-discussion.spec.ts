import { expect, test } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installDiscussionBackend } from './discussionBackend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope } from './planningFixtures.ts'

test('description, comments and selected reports survive a fresh item read', async ({ page }) => {
  const backend = await installDiscussionBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await drawer.getByRole('button', { name: 'Edit description', exact: true }).click()
  await drawer.getByRole('textbox', { name: 'Description', exact: true }).fill('An editable goal')
  await drawer.getByRole('button', { name: 'Save description', exact: true }).click()
  await expect(drawer.locator('.description-copy')).toHaveText('An editable goal')
  await drawer
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Please check the result')
  await drawer.locator('.discussion-form button[type="submit"]').click()
  await expect(drawer.locator('.discussion-body')).toHaveText('Please check the result')
  await expect(drawer.locator('.discussion-body')).toHaveCSS('font-size', '15px')
  await drawer.getByRole('checkbox', { name: 'Work report', exact: true }).check()
  for (const title of ['First result', 'Second result']) {
    await drawer.getByRole('textbox', { name: 'What was done', exact: true }).fill(title)
    await drawer.getByRole('textbox', { name: 'What comes next', exact: true }).fill('Review')
    await drawer.getByRole('checkbox', { name: 'Make task outcome', exact: true }).check()
    await drawer.getByRole('button', { name: 'Publish report', exact: true }).click()
    await expect(drawer.locator('.discussion-entry')).toHaveCount(title === 'First result' ? 2 : 3)
  }
  const first = drawer.locator('.discussion-entry').filter({ hasText: 'First result' })
  await first.getByRole('button', { name: 'Make task outcome', exact: true }).click()
  await expect(first.locator('.discussion-label')).toHaveText('Work report · task outcome')
  expect(backend.writes.at(-1)).toEqual({
    author: 'user',
    id: backend.item.work_item_id,
    comment_id: 2,
    expected_revision: 7,
  })
  await page.reload()
  await expect(drawer.locator('.description-copy')).toHaveText('An editable goal')
  await expect(drawer.locator('.discussion-entry')).toHaveCount(3)
  const outcome = drawer.locator('.outcome')
  await expect(outcome.locator('.outcome-body')).toBeHidden()
  await expect(outcome.locator('.outcome-preview')).toBeVisible()
  await expect(outcome.locator('.outcome-preview')).toContainText('First result')
  await expect(outcome.locator('.outcome-preview-text')).toHaveCSS('font-size', '15px')
  await outcome.locator('summary').press('Enter')
  await expect(outcome.locator('.outcome-body')).toBeVisible()
  await expect(outcome.locator('.outcome-preview')).toBeHidden()
  await outcome.locator('summary').press('Space')
  await expect(outcome.locator('.outcome-body')).toBeHidden()
  const beforeReport = page.url()
  await outcome.getByRole('button', { name: 'View report in discussion' }).click()
  await expect(page).toHaveURL(beforeReport)
  const selected = drawer.locator('#work-report-2')
  await expect(selected).toBeInViewport({ ratio: 0.5 })
  await expect(selected).toBeFocused()
  const reportBounds = await selected.boundingBox()
  const headerBounds = await drawer.locator('.drawer-frame-head').boundingBox()
  expect(
    reportBounds && headerBounds && reportBounds.y >= headerBounds.y + headerBounds.height,
  ).toBe(true)
})

for (const width of [900, 390]) {
  test(`conflict recovery preserves drafts and autosizing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const backend = await installDiscussionBackend(page)
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
    const drawer = page.locator('.drawer')
    await drawer.getByRole('button', { name: 'Edit description', exact: true }).click()
    const description = drawer.getByRole('textbox', { name: 'Description', exact: true })
    const draft = Array.from({ length: 8 }, (_, index) => `Detailed goal ${index + 1}`).join('\n')
    await description.fill(draft)
    await expect(description).toHaveCSS('font-size', '15px')
    const bounds = await description.boundingBox()
    expect(bounds?.height).toBeGreaterThan(160)
    backend.failNextWrite()
    await drawer.getByRole('button', { name: 'Save description', exact: true }).click()
    await expect(drawer.getByRole('alert')).toContainText('The task changed.')
    await expect(description).toHaveValue(draft)
    await drawer.getByRole('button', { name: 'Refresh task', exact: true }).click()
    await expect(description).toHaveValue(draft)
    await drawer.getByRole('button', { name: 'Save description', exact: true }).click()
    await expect(drawer.locator('.description-copy')).toHaveText(draft)
    expect(backend.writes.at(-1)?.expected_revision).toBe(4)
    const comment = drawer.getByRole('textbox', { name: 'Comment', exact: true })
    await comment.fill('A retained comment draft')
    await drawer.getByRole('button', { name: 'Relations', exact: true }).click()
    await drawer.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(comment).toHaveValue('A retained comment draft')
    backend.failNextWrite()
    await drawer.locator('.discussion-form button[type="submit"]').click()
    await expect(drawer.getByRole('alert')).toContainText('The task changed.')
    await expect(comment).toHaveValue('A retained comment draft')
    await expectNoSilentClipping(page, `Discussion recovery at ${width}px`)
  })
}
