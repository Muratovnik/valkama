import { expect } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { asRoot } from '../support/threads.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { now, planningSpace, projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

test('description, comments and selected reports survive a fresh item read', async ({ page }) => {
  const backend = await installDiscussionBackend(page)
  // What agents wrote through their tools: the thread shows it, the form does not write it.
  for (const [index, done] of ['First result', 'Second result'].entries()) {
    backend.item.comments.push({
      id: index + 1,
      kind: 'report',
      ...asRoot,
      author: 'codex',
      at: now,
      body: '',
      report: { done, next: 'Review' },
      checklist_item_id: null,
      checklist_item_text: null,
    })
  }
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
  const written = drawer.locator('.thread-entry').filter({ hasText: 'Please check the result' })
  await expect(written.locator('.thread-text')).toHaveText('Please check the result')
  await expect(written.locator('.thread-text')).toHaveCSS('font-size', '15px')
  const first = drawer.locator('.thread-entry').filter({ hasText: 'First result' })
  await expect(first.locator('.thread-label')).toHaveText('Work report')
  await first.getByRole('button', { name: 'Make task outcome', exact: true }).click()
  await expect(first.locator('.thread-label')).toHaveText('Work report · task outcome')
  expect(backend.writes.at(-1)).toEqual({
    author: 'user',
    id: backend.item.work_item_id,
    comment_id: 1,
    expected_revision: 5,
  })
  await page.reload()
  await expect(drawer.locator('.description-copy')).toHaveText('An editable goal')
  await expect(drawer.locator('.thread-entry')).toHaveCount(3)
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
  const selected = drawer.locator('#work-report-1')
  await expect(selected).toBeInViewport({ ratio: 0.5 })
  await expect(selected).toBeFocused()
  const reportBounds = await selected.boundingBox()
  const headerBounds = await drawer.locator('.drawer-frame-tabs').boundingBox()
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
    await expect(drawer.locator('.description-copy')).toHaveText(draft, { useInnerText: true })
    expect(backend.writes.at(-1)?.expected_revision).toBe(4)
    const comment = drawer.getByRole('textbox', { name: 'Comment', exact: true })
    await comment.fill('A retained comment draft')
    await drawer.getByRole('tab', { name: 'Relations', exact: true }).click()
    await drawer.getByRole('tab', { name: 'Overview', exact: true }).click()
    await expect(comment).toHaveValue('A retained comment draft')
    backend.failNextWrite()
    await drawer.locator('.discussion-form button[type="submit"]').click()
    await expect(drawer.getByRole('alert')).toContainText('The task changed.')
    await expect(comment).toHaveValue('A retained comment draft')
    await expectNoSilentClipping(page, `Discussion recovery at ${width}px`)
  })
}

/**
 * The `#` list opens beside the field it belongs to and stays inside the window:
 * under the field where the window has room, over it where it does not. It used
 * to stand in the flow under the field at its full height, so a comment field at
 * the foot of the screen showed none of its eight rows. The short window leaves
 * less room than eight rows take, so the list scrolls to the row the keys reach.
 */
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 1024, height: 420 },
]) {
  test(`the # suggestions stay inside a ${viewport.width}×${viewport.height} window`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await installDiscussionBackend(page)
    const found = Array.from({ length: 8 }, (_, index) => ({
      work_item_id: `00000000-0000-4000-8000-00000000010${index}`,
      planning_space_id: planningSpace.planning_space_id,
      reference: `MAIN-${100 + index}`,
      title: `Parser step ${index + 1}`,
      state: { name: 'Doing' },
      claim_ref: '',
    }))
    await page.route('**/api/planning/search?*', (route) =>
      route.fulfill({ json: { interface_version: 'valkama-planning-api', work_items: found } }),
    )
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
    const drawer = page.locator('.drawer')
    const comment = drawer.getByRole('textbox', { name: 'Comment', exact: true })
    // The field at the foot of the window, where a list under it has no room.
    await comment.evaluate((element) => element.scrollIntoView({ block: 'end' }))
    await comment.click()
    await page.keyboard.type('See #Parser')
    const list = page.getByRole('listbox', { name: 'Tasks' })
    await expect(list.getByRole('option')).toHaveCount(8)

    const inside = async () => {
      const box = (await list.boundingBox()) ?? { x: -1, y: -1, width: 0, height: 0 }
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    }
    await inside()
    // The list does not cover the line being written.
    const field = await comment.boundingBox()
    const box = await list.boundingBox()
    expect(field && box && (box.y + box.height <= field.y || box.y >= field.y + field.height)).toBe(
      true,
    )

    // The keys walk the list, and the active row is always one the reader can see.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press(step < 3 ? 'ArrowDown' : 'ArrowUp')
      const active = list.locator('[aria-selected="true"]')
      await expect(active).toBeInViewport()
      const row = await active.boundingBox()
      const shown = await list.boundingBox()
      expect(
        row &&
          shown &&
          row.y >= shown.y - 0.5 &&
          row.y + row.height <= shown.y + shown.height + 0.5,
      ).toBe(true)
    }
    await inside()
    // Three down and five up wraps past the first row to the seventh; Enter writes it.
    await page.keyboard.press('Enter')
    await expect(comment).toHaveValue('See MAIN-106 ')
    await expect(list).toHaveCount(0)
    await expect(drawer).toBeVisible()
  })
}
