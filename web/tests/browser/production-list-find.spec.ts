/**
 * The list's own find, in the built application. A list of a thousand rows
 * draws only its window, so the browser's find reached the rows drawn; Ctrl+F
 * on the list opens the list's find instead, which counts a term in the words
 * of every row and walks its matches in the list's order, each brought to the
 * middle of the room under the sticky head and marked, the current one apart.
 *
 * The count holds through the walk and follows the stream; the current match
 * stays on its row, and the list where it stands, while the stream changes the
 * list; Escape closes the bar and gives focus back. Over a card, a menu or the
 * filter's list, and on the board, Ctrl+F stays the browser's.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, openList, serve } from './boardPage.ts'
import {
  barOf,
  countOf,
  expectCurrentIn,
  fieldOf,
  findTaken,
  hearFind,
  listOf,
  reference,
  row,
} from './listFindPage.ts'
import { serveSpace, stillFrames } from './longSpace.ts'
import { installStreamDouble } from './streamDouble.ts'
import { test } from './test.ts'

/** A thousand rows, «quartz» in four far down the list and twice in one of them. */
const QUARTZ: Record<number, string> = {
  120: 'Quartz sample to look for',
  400: 'Quartz sample, and quartz again',
  650: 'Quartz sample in the middle',
  980: 'Quartz sample near the end',
}
const thousand = () =>
  Array.from({ length: 1000 }, (_, index) =>
    row(index, QUARTZ[index] ? { title: QUARTZ[index] } : {}),
  )
/** The matches of «quartz» in the list's order: row by row, and in a row as it reads. */
const WALK = [120, 400, 400, 650, 980]

async function openThousand(page: Page, items: object[] = thousand()) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const stream = await installStreamDouble(page)
  await serveSpace(page, items)
  const read = page.waitForResponse((response) => response.url().includes('/api/planning?'))
  await openList(page)
  const answered = await read
  const model = JSON.parse(await answered.text()) as { work_items: { title: string }[] }
  await stillFrames(page)
  await hearFind(page)
  return { model, stream }
}

test('Ctrl+F counts a term outside the window and walks it in the list’s order', async ({
  page,
}) => {
  await openThousand(page)
  const list = listOf(page)
  // The window holds none of the rows the term is in.
  await expect(list.locator('tbody tr.list-row').first()).toBeVisible()
  expect(await list.locator('tbody').textContent()).not.toMatch(/quartz/iu)
  const first = list.locator(`tbody .list-open[data-reference="${reference(0)}"]`)
  await first.focus()

  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(true)
  await expect(barOf(page)).toBeVisible()
  await expect(fieldOf(page)).toBeFocused()

  // Every value the count takes, through the typing, the walk and every scroll.
  await countOf(page).evaluate((count) => {
    const seen: string[] = []
    Object.assign(globalThis, { countsSeen: seen })
    new MutationObserver(() => seen.push(count.textContent?.trim() ?? '')).observe(count, {
      characterData: true,
      childList: true,
      subtree: true,
    })
  })
  await fieldOf(page).fill('QUARTZ')
  await expect(countOf(page)).toHaveText(`1 of ${WALK.length}`)
  await stillFrames(page)
  await expectCurrentIn(page, WALK[0], true)
  const barBox = await barOf(page).boundingBox()

  for (const [step, index] of [...WALK.entries()].slice(1)) {
    await page.keyboard.press('Enter')
    await expect(countOf(page)).toHaveText(`${step + 1} of ${WALK.length}`)
    await stillFrames(page)
    // A second match in a row already in sight leaves the list where it is.
    await expectCurrentIn(page, index, index !== WALK[step - 1])
    await expect(fieldOf(page)).toBeFocused()
    expect(await barOf(page).boundingBox(), 'the bar holds still').toEqual(barBox)
  }
  // Round past the end to the first, and back past the start to the last.
  await page.keyboard.press('Enter')
  await expect(countOf(page)).toHaveText(`1 of ${WALK.length}`)
  await stillFrames(page)
  await expectCurrentIn(page, WALK[0], true)
  await page.keyboard.press('Shift+Enter')
  await expect(countOf(page)).toHaveText(`${WALK.length} of ${WALK.length}`)
  await stillFrames(page)
  await expectCurrentIn(page, WALK.at(-1) ?? 0, true)

  const seen = await page.evaluate(
    () => (globalThis as unknown as { countsSeen: string[] }).countsSeen,
  )
  expect(seen.filter((text) => text && !text.endsWith(` of ${WALK.length}`))).toEqual([])

  await page.keyboard.press('Escape')
  await expect(barOf(page)).toHaveCount(0)
  await expect(first).toBeFocused()
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0)
})

test('the current match stays on its row as the stream changes the list', async ({ page }) => {
  const { model, stream } = await openThousand(page)
  await page.keyboard.press('Control+f')
  await fieldOf(page).fill('quartz')
  await expect(countOf(page)).toHaveText('1 of 5')
  for (let step = 1; step < 4; step += 1) await page.keyboard.press('Enter')
  await expect(countOf(page)).toHaveText('4 of 5')
  await stillFrames(page)
  await expectCurrentIn(page, 650, true)
  const before = {
    bar: await barOf(page).boundingBox(),
    scroll: await listOf(page).evaluate((list) => list.scrollTop),
  }

  // The first row the term was in no longer holds it.
  const changed = structuredClone(model)
  changed.work_items[120] = { ...changed.work_items[120], title: 'Sample to look for' }
  await stream.deliver(JSON.stringify(changed))
  await expect(countOf(page)).toHaveText('3 of 4')
  await stillFrames(page)
  await expectCurrentIn(page, 650, true)
  await expect(fieldOf(page)).toBeFocused()
  expect(await barOf(page).boundingBox()).toEqual(before.bar)
  expect(await listOf(page).evaluate((list) => list.scrollTop)).toBe(before.scroll)
})

test('Ctrl+F stays the browser’s over an open card and on the board', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  await hearFind(page)
  await page.locator('.work-item-list tbody .list-open').first().click()
  await expect(page.locator('.drawer')).toHaveCount(1)
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(false)
  await expect(barOf(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  // With the card gone the list's again.
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(true)
  await expect(barOf(page)).toBeVisible()

  await openBoard(page)
  await hearFind(page)
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(false)
})

test('Ctrl+F stays the browser’s while a menu or the filter’s list is open over the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  await hearFind(page)

  // The view's menu.
  const viewMenu = page.locator('.view-menu-words').getByRole('button', { name: 'View' })
  await viewMenu.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(false)
  await expect(barOf(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // The filter field's list of facets, which is no menu of the library's.
  const filter = page.getByRole('combobox', { name: 'Filter work' })
  await filter.click()
  await expect(page.getByRole('listbox', { name: 'Facets to filter by' })).toBeVisible()
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(false)
  await expect(barOf(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', { name: 'Facets to filter by' })).toBeHidden()

  // With nothing open over it, the list's again.
  await page.locator('.work-item-list tbody .list-open').first().focus()
  await page.keyboard.press('Control+f')
  expect(await findTaken(page)).toBe(true)
  await expect(barOf(page)).toBeVisible()
})
