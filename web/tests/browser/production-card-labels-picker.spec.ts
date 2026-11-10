/**
 * The card's labels are changed in one picker, the new-task dialog's, and a chip only filters.
 *
 * Each chip used to end in a × whose room was kept at rest, 8px before the words and 22px
 * after them, so no chip stood its words in its middle. Now the «+», or a press on the row
 * beside the chips, opens the picker with the item's labels checked: choosing an unchecked
 * one attaches it, choosing a checked one takes it off, and typed words add a new one. In the
 * built application: what each change sends, and where a chip's words stand in it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { boxOf } from './filterPage.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/**
 * The card with a label write answered as the server would, after `slow` ms: the list asked
 * for, one revision on, and the card's next read carrying it.
 */
async function openCard(page: Page, width: number, slow = 0) {
  await page.setViewportSize({ width, height: 900 })
  const sent: string[][] = []
  let written: { labels: string[]; revision: number } | null = null
  await installBackend(page, { card: (read) => ({ ...read, ...written }) })
  await page.route('**/api/planning/work-item/update', async (route) => {
    const { labels } = route.request().postDataJSON() as { labels: string[] }
    sent.push(labels)
    if (slow) await new Promise((done) => setTimeout(done, slow))
    written = { labels, revision: (written?.revision ?? workItem.revision) + 1 }
    return route.fulfill({ json: { ...workItem, ...written } })
  })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-labels .label-chip').first()).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return { drawer, sent }
}

/** How far a chip's words stand from each end of its face. */
const insets = (face: Locator) =>
  face.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const words = range.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return { start: words.left - box.left, end: box.right - words.right }
  })

for (const width of [1280, 390]) {
  test(`a chip stands its words in its middle and only filters, at ${width}px`, async ({
    page,
  }) => {
    const { drawer } = await openCard(page, width)
    const chips = drawer.locator('.card-labels li:has(.label-chip)')
    await expect(chips).toHaveCount(2)
    for (const chip of await chips.all()) {
      const { start, end } = await insets(chip.locator('.chip-face'))
      expect(
        Math.abs(start - end),
        `${await chip.textContent()}: ${start} and ${end}`,
      ).toBeLessThanOrEqual(0.5)
      // The chip is its filter button and nothing else.
      await expect(chip.getByRole('button')).toHaveCount(1)
    }
    await drawer.locator('.card-labels .label-chip').first().hover()
    const { start, end } = await insets(drawer.locator('.card-labels .chip-face').first())
    expect(Math.abs(start - end)).toBeLessThanOrEqual(0.5)
  })
}

test('the «+» opens the picker with the item’s labels checked; it attaches and takes off', async ({
  page,
}) => {
  const { drawer, sent } = await openCard(page, 1280)
  await drawer.getByRole('button', { name: 'Add a label' }).click()
  const picker = drawer.getByRole('combobox', { name: 'Add a label' })
  await expect(picker).toBeFocused()
  const list = page.getByRole('listbox', { name: 'Add a label' })
  await expect(list.getByRole('option', { name: 'platform' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(list.getByRole('option', { name: 'phase-1' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // A checked one taken off.
  await list.getByRole('option', { name: 'phase-1' }).click()
  await expect.poll(() => sent).toEqual([['platform']])
  await expect(list.getByRole('option', { name: 'phase-1' })).toHaveAttribute(
    'aria-selected',
    'false',
  )
  // A new one typed and added.
  await page.keyboard.type('release-2')
  await page.keyboard.press('Enter')
  await expect.poll(() => sent).toEqual([['platform'], ['platform', 'release-2']])

  // Escape shuts the list, then gives the chips back with what was written.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(drawer.locator('.card-labels .label-chip')).toHaveText(['platform', 'release-2'])
  await expect(drawer.getByRole('button', { name: 'Add a label' })).toBeFocused()
})

test('a label write that lands while a new one is typed leaves every letter typed', async ({
  page,
}) => {
  const { drawer, sent } = await openCard(page, 1280, 400)
  await drawer.getByRole('button', { name: 'Add a label' }).click()
  const picker = drawer.getByRole('combobox', { name: 'Add a label' })
  await expect(picker).toBeFocused()
  const list = page.getByRole('listbox', { name: 'Add a label' })
  await list.getByRole('option', { name: 'phase-1' }).click()
  await expect.poll(() => sent).toEqual([['platform']])
  // Nine letters 100ms apart: the write answers, and the card reads it, halfway through.
  await page.keyboard.type('release-2', { delay: 100 })
  await expect(picker).toHaveValue('release-2')
  await page.keyboard.press('Enter')
  await expect.poll(() => sent).toEqual([['platform'], ['platform', 'release-2']])
})

test('a press on the row beside the chips opens the picker', async ({ page }) => {
  const { drawer } = await openCard(page, 1280)
  const row = drawer.locator('.card-labels')
  const box = await boxOf(row)
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2)
  await expect(drawer.getByRole('combobox', { name: 'Add a label' })).toBeFocused()
})
