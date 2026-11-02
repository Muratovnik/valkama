import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installDiscussionBackend } from './discussionBackend.ts'
import { linesTall, openCard, selection } from './editorPage.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** What agents write: anchors the planning system resolves, a table and a fence. */
const AGENT_TEXT = [
  '## Goal <!-- kb:x -->',
  '',
  '| Column | Value |',
  '| --- | :---: |',
  '| a | `x` |',
  '',
  '```python',
  'def f(x):',
  '    return x * 2  # <b>not html</b>',
  '```',
  '',
  'Line with two spaces  ',
  'next line, *stars*, _underscores_, \\escapes and #12.',
].join('\n')

test('a comment with an anchor, a table and a fence is sent byte for byte as it was typed', async ({
  page,
}) => {
  const { backend, drawer, comment } = await openCard(page)
  await comment.click()
  await page.keyboard.insertText(AGENT_TEXT)
  await expect(comment).toHaveValue(AGENT_TEXT)
  await drawer
    .locator('.discussion-form')
    .getByRole('button', { name: 'Add note', exact: true })
    .click()
  await expect(comment).toHaveValue('')
  expect(backend.writes.at(-1)?.body).toBe(AGENT_TEXT)
})

/** A real card with this description, its editor open. */
async function editDescription(page: Page, description: string) {
  const backend = await installDiscussionBackend(page)
  backend.item.description = description
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await drawer.getByRole('button', { name: 'Edit description', exact: true }).click()
  const field = drawer.getByRole('textbox', { name: 'Description', exact: true })
  await expect(field).toBeFocused()
  return { backend, drawer, field }
}

/** Save with nothing changed and read what went out. */
async function savedUnedited(page: Page, description: string): Promise<unknown> {
  const { backend, drawer } = await editDescription(page, description)
  await drawer.getByRole('button', { name: 'Save description', exact: true }).click()
  await expect(drawer.locator('.description-form')).toHaveCount(0)
  return backend.writes.at(-1)?.description
}

for (const description of [AGENT_TEXT, AGENT_TEXT.replaceAll('\n', '\r\n')]) {
  test(`a description saved with no edit keeps every byte, ${description.includes('\r') ? 'CRLF' : 'LF'} line ends included`, async ({
    page,
  }) => {
    expect(await savedUnedited(page, description)).toBe(description)
  })
}

test('a description as long as the service stores still opens, and saves whole', async ({
  page,
}) => {
  // The service's own bound on a description, in `server/planning/model.py`.
  const description = 'Длинная строка плана.\n'.repeat(900).padEnd(20_000, 'x')
  expect(description).toHaveLength(20_000)
  expect(await savedUnedited(page, description)).toBe(description)
})

test('a description longer than its field opens at its beginning, a shorter one with the caret at its end', async ({
  page,
}) => {
  const { field, drawer } = await editDescription(page, 'Длинная строка плана.\n'.repeat(200))
  expect(await selection(field)).toEqual([0, 0])
  expect(await field.evaluate((control) => control.scrollTop)).toBe(0)
  await drawer.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('Escape')

  const short = await editDescription(page, AGENT_TEXT)
  expect(await selection(short.field)).toEqual([AGENT_TEXT.length, AGENT_TEXT.length])
})

test('the description and the new task’s dialog ask for their own height, and the dialog has no foot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const { drawer } = await openCard(page)
  await drawer.getByRole('button', { name: 'Edit description', exact: true }).click()
  const description = drawer.getByRole('textbox', { name: 'Description', exact: true })
  expect(await linesTall(description)).toBe(6)
  const form = drawer.locator('.description-form')
  // The heading over it names it, so there is no second label.
  await expect(form.locator('label.markdown-label')).toHaveCount(0)
  await expect(form.locator('.markdown-foot').getByRole('button')).toHaveText([
    'Cancel',
    'Save description',
  ])
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)

  await page.getByRole('button', { name: 'New work item', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  const field = dialog.getByRole('textbox', { name: 'Description', exact: true })
  expect(await linesTall(field)).toBe(4)
  // Nothing heads it in a dialog, so it keeps its label, and a press on it finds the field.
  await dialog.locator('label.markdown-label').click()
  await expect(field).toBeFocused()
  await expect(dialog.locator('.markdown-foot')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(field).toHaveValue('****')
  await expect(dialog).toBeVisible()
})
