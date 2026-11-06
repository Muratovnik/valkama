/**
 * The new-task dialog chooses its epic and its labels by searching what the space has.
 *
 * Through the real dialog over the board's own read: an epic found by a word of its
 * title, one label the space already uses and one typed new, and what the create call
 * then sent. The lists stand under their fields, as wide as they are, at a desktop's width and
 * at a phone's, where each field takes the dialog's whole width rather than half of it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { identity, projectScope, workItem } from './planningFixtures.ts'
import { test } from './test.ts'

const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })
/** As long as a real epic's: at a half-width field's 172px it took six lines. */
const EPIC_TITLE = 'Parser rework: one grammar for tables, front matter, footnotes and fenced code'

/** Where a box stands; a box with none is a failure of its own. */
async function measured(box: Locator) {
  const bounds = await box.boundingBox()
  expect(bounds).not.toBeNull()
  return bounds ?? { x: 0, y: 0, width: 0, height: 0 }
}

/** The space as the board reads it, with an epic and a label more. */
async function openComposer(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, {
    space: (model) => {
      const items = model.work_items as Record<string, unknown>[]
      const epic = {
        ...items[0],
        work_item_id: identity(12),
        reference: 'MAIN-12',
        number: 12,
        title: EPIC_TITLE,
        kind: 'epic',
        claim_ref: '',
        claim_state: null,
        labels: ['backend'],
      }
      return { ...model, work_items: [...items, epic] }
    },
  })
  const sent: Record<string, unknown>[] = []
  await page.route('**/api/planning/work-items', (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ json: workItem })
  })
  await page.goto(BOARD)
  await page.getByRole('button', { name: 'New work item' }).click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  await expect(dialog).toHaveCSS('transform', 'none')
  return { dialog, sent }
}

test('an item is created with an epic found by search, a label the space has and a new one', async ({
  page,
}) => {
  const { dialog, sent } = await openComposer(page, 1280)
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Ship the parser')

  const epic = dialog.getByRole('combobox', { name: 'Epic', exact: true })
  await expect(epic).toHaveValue('No epic')
  await epic.click()
  await page.keyboard.type('rework')
  const list = page.getByRole('listbox', { name: 'Epic' })
  await expect(list.getByRole('option')).toHaveText([`MAIN-12 · ${EPIC_TITLE}Dev`])
  await page.keyboard.press('Enter')
  await expect(list).toHaveCount(0)
  await expect(epic).toHaveValue(`MAIN-12 · ${EPIC_TITLE}`)

  const labels = dialog.getByRole('combobox', { name: 'Labels', exact: true })
  await labels.click()
  const offered = page.getByRole('listbox', { name: 'Labels' }).getByRole('option')
  await expect(offered).toHaveText(['backend', 'phase-1', 'platform'])
  await page.keyboard.type('plat')
  await expect(offered).toHaveText(['platform', 'Add “plat”'])
  await page.keyboard.press('Enter')
  await page.keyboard.type('release-2')
  await expect(offered).toHaveText(['Add “release-2”'])
  await page.keyboard.press('Enter')
  await expect(labels).toHaveValue('')
  for (const label of ['platform', 'release-2'])
    await expect(dialog.getByRole('button', { name: `Remove label ${label}` })).toBeVisible()

  // Escape closes the list and leaves the dialog and what it holds.
  await page.keyboard.press('Escape')
  await expect(offered).toHaveCount(0)
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'New work item', exact: true }).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]).toMatchObject({
    title: 'Ship the parser',
    labels: ['platform', 'release-2'],
    parent: 'MAIN-12',
  })
})

// Side by side on a desktop; one above the other on a phone, where half the dialog left an
// epic's title 172px in its field and in its list, six lines of it there.
for (const { width, alone } of [
  { width: 1280, alone: false },
  { width: 390, alone: true },
]) {
  test(`at ${width}px an open list stands under its field and inside the dialog`, async ({
    page,
  }) => {
    const { dialog } = await openComposer(page, width)
    for (const name of ['Labels', 'Epic']) {
      const field = dialog.getByRole('combobox', { name, exact: true })
      await field.click()
      const list = page.getByRole('listbox', { name })
      await expect(list.getByRole('option').first()).toBeVisible()
      const box = await measured(field.locator('xpath=..'))
      const shown = await measured(list)
      const frame = await measured(dialog)
      expect(Math.round(shown.x)).toBe(Math.round(box.x))
      expect(Math.round(shown.width)).toBe(Math.round(box.width))
      // Alone on its row, a field keeps the same inset from both edges of the dialog.
      const before = box.x - frame.x
      const after = frame.x + frame.width - box.x - box.width
      expect(Math.abs(before - after) < 1).toBe(alone)
      expect(shown.y).toBeGreaterThan(box.y + box.height)
      expect(shown.x + shown.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(shown.y + shown.height).toBeLessThanOrEqual(900)
      // In front of the dialog, not behind it: its first row is what a press there reaches.
      const first = list.getByRole('option').first()
      const row = await measured(first)
      const reached = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="option"]')?.textContent,
        [row.x + row.width / 2, row.y + row.height / 2] as const,
      )
      expect(reached).toBe(await first.textContent())
      await page.keyboard.press('Escape')
      await expect(list).toHaveCount(0)
    }
  })
}

test('a pointer opens the epic list over an empty search, the chosen epic standing in it', async ({
  page,
}) => {
  const { dialog } = await openComposer(page, 1280)
  const epic = dialog.getByRole('combobox', { name: 'Epic', exact: true })
  await expect(epic).toHaveValue('No epic')
  await epic.click()
  const list = page.getByRole('listbox', { name: 'Epic' })
  await expect(list).toBeVisible()
  // Nothing painted as selected: the whole value stood highlighted on every press. The words
  // stay in sight as the field's placeholder, and whatever is typed searches from nothing.
  await expect(epic).toHaveValue('')
  await expect(epic).toHaveAttribute('placeholder', 'No epic')
  await page.keyboard.type('rew')
  await expect(epic).toHaveValue('rew')
  await expect(list.getByRole('option')).toHaveText([`MAIN-12 · ${EPIC_TITLE}Dev`])
  // Left without a choice, the field says what is still chosen.
  await dialog.getByRole('heading', { name: 'New work' }).click()
  await expect(list).toHaveCount(0)
  await expect(epic).toHaveValue('No epic')
  await expect(epic).not.toHaveAttribute('placeholder')
})

test('an epic chosen with the pointer leaves the caret in its field, as one chosen by keys does', async ({
  page,
}) => {
  const { dialog } = await openComposer(page, 1280)
  const epic = dialog.getByRole('combobox', { name: 'Epic', exact: true })
  await epic.click()
  const list = page.getByRole('listbox', { name: 'Epic' })
  await list.getByRole('option', { name: new RegExp(`^MAIN-12 · ${EPIC_TITLE}`, 'u') }).click()
  await expect(list).toHaveCount(0)
  await expect(epic).toHaveValue(`MAIN-12 · ${EPIC_TITLE}`)
  // The pressed option took the focus and went with the list: it fell to the page, and the
  // next Tab started from the top of the document.
  await expect(epic).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('combobox', { name: 'Labels', exact: true })).toBeFocused()

  // Labels, several values: the field keeps the caret after a press too.
  const labels = dialog.getByRole('combobox', { name: 'Labels', exact: true })
  await labels.click()
  await page
    .getByRole('listbox', { name: 'Labels' })
    .getByRole('option', { name: 'backend' })
    .click()
  await expect(labels).toBeFocused()
})
