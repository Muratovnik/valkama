/**
 * A list long enough to draw only its window, in the built application. From
 * 300 rows the table holds the rows in and about its window, and gap rows hidden
 * from a reader hold the height of the rest, while the table still says how many
 * rows it has and each row where it stands. One row shorter, every row is drawn.
 *
 * The keys go by the whole list, so End reaches the list's last row rather than
 * the last one drawn; the Tab stop and the row focus is in stay drawn wherever
 * the list scrolls; the columns keep their widths while it scrolls, a far row's
 * included; and printing draws every row.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openList } from './boardPage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => brief(1000 + index, stateOf(index)))

async function openLong(page: Page, rows: object[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serveSpace(page, rows)
  await openList(page)
  await stillFrames(page)
}

const listOf = (page: Page) => page.locator('.work-item-list')
/** The rows of the list the table holds, those drawn only for their widths included. */
const drawnOf = (page: Page) => page.locator('.work-item-list tbody tr.list-row')

/** Whether a row stands whole between the sticky head and the list's bottom edge. */
const inSight = async (list: Locator, row: Locator) =>
  row.evaluate(
    (element, box) => {
      // The head's cells are what stays; the thead itself scrolls away with the rows.
      const head = box.querySelector('thead .list-head')?.getBoundingClientRect()
      const edge = box.getBoundingClientRect()
      const own = element.getBoundingClientRect()
      return Boolean(head && own.top >= head.bottom - 1 && own.bottom <= edge.bottom + 1)
    },
    await list.elementHandle(),
  )

test('a list of 299 rows draws every one, and a list of 300 only its window', async ({ page }) => {
  const rows = items(299)
  await openLong(page, rows)
  const drawn = drawnOf(page)
  const gaps = page.locator('.work-item-list tbody tr[aria-hidden="true"]')
  await expect(drawn).toHaveCount(299)
  await expect(gaps).toHaveCount(0)
  await expect(page.locator('.list-table')).not.toHaveAttribute('aria-rowcount')

  // The same space with one row more.
  rows.push(brief(1299, stateOf(299)))
  await page.reload()
  await expect(drawn.first()).toBeVisible()
  await stillFrames(page)
  // The window and what stays drawn wherever it is, far under the whole list.
  expect(await drawn.count()).toBeLessThan(100)
  await expect(gaps).not.toHaveCount(0)
  // A reader hears the whole list's length, the head's row included, and a
  // row's place in it.
  await expect(page.locator('.list-table')).toHaveAttribute('aria-rowcount', '301')
  await expect(drawn.first()).toHaveAttribute('aria-rowindex', '2')
  // The gaps keep the scroll as long as every row would make it.
  const list = listOf(page)
  expect(await list.evaluate((element) => element.scrollHeight)).toBeGreaterThan(300 * 40)
})

test("End and Home reach the list's last and first rows, not the last drawn", async ({ page }) => {
  await openLong(page, items(1000))
  const list = listOf(page)
  const focused = page.locator('.work-item-list tbody tr:has(.list-open:focus)')
  await list.locator('tbody .list-open').first().focus()
  await page.keyboard.press('End')
  await expect(focused).toHaveAttribute('aria-rowindex', '1001')
  await stillFrames(page)
  expect(await inSight(list, focused), 'the last row is in sight').toBe(true)
  // The list is scrolled to its end, which is where its last row stands.
  const end = await list.evaluate(
    (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
  )
  expect(end).toBeLessThanOrEqual(2)
  expect(await drawnOf(page).count()).toBeLessThan(100)
  await page.keyboard.press('ArrowUp')
  await expect(focused).toHaveAttribute('aria-rowindex', '1000')
  await page.keyboard.press('Home')
  await expect(focused).toHaveAttribute('aria-rowindex', '2')
  await stillFrames(page)
  expect(await inSight(list, focused), 'the first row is in sight').toBe(true)
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0)
})

test('the Tab stop and the focused row stay drawn wherever a long list scrolls', async ({
  page,
}) => {
  await openLong(page, items(1000))
  const list = listOf(page)
  const fifth = list.locator('tbody .list-open').nth(4)
  const reference = (await fifth.textContent()) ?? ''
  await fifth.focus()
  const scrollTo = (share: number) =>
    list.evaluate((element, at) => {
      element.scrollTop = element.scrollHeight * at
    }, share)
  // Scrolled far away, the row focus is in is still there, and still focused.
  await scrollTo(1)
  await stillFrames(page)
  await expect(list.locator('tbody .list-open:focus')).toHaveText(reference)
  // Focus leaves the rows; the row it left is the Tab stop and stays drawn.
  await list.locator('thead .list-sort').last().focus()
  await scrollTo(0.5)
  await stillFrames(page)
  const stop = list.locator('tbody .list-open[tabindex="0"]')
  await expect(stop).toHaveCount(1)
  await expect(stop).toHaveText(reference)
  await page.keyboard.press('Tab')
  await expect(stop).toBeFocused()
})

test('a long list keeps its columns while it scrolls, a far row that is widest included', async ({
  page,
}) => {
  // Everything that makes a column wider lies in one row far below the fold.
  const updated_at = new Date().toISOString()
  const rows = Array.from({ length: 600 }, (_, index) =>
    brief(1000 + index, stateOf(0), { updated_at }),
  )
  rows[580] = brief(9580, stateOf(2), {
    reference: 'MAIN-99580',
    claim_ref: 'a holder with a long name',
    priority: 'urgent',
    checklist: Array.from({ length: 12 }, (_, at) => ({
      id: identity(3000 + at),
      text: 'Step',
      done: false,
      claimed_by: '',
      done_by: '',
    })),
    updated_at: '2020-08-28T20:08:00Z',
  })
  await openLong(page, rows)
  const list = listOf(page)
  const columns = () =>
    list.evaluate((element) =>
      [...element.querySelectorAll('thead th')].map((cell) => cell.getBoundingClientRect().left),
    )
  const first = await columns()
  for (let step = 1; step <= 10; step += 1) {
    await list.evaluate((element, at) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * at
    }, step / 10)
    await stillFrames(page)
    expect(await columns(), `columns at ${step * 10}% of the list`).toEqual(first)
  }
  // The far row is drawn in its place and reads as itself.
  const far = list.locator('tbody tr[aria-rowindex] .list-open', { hasText: 'MAIN-99580' })
  await far.scrollIntoViewIfNeeded()
  await expect(far).toBeInViewport()
})

test('printing a long list draws every row, and the window comes back after', async ({ page }) => {
  // Read in the print's own last event, before the list hears it and draws its
  // window again.
  await page.addInitScript(() => {
    addEventListener('afterprint', () => {
      Object.assign(globalThis, {
        printed: {
          gaps: document.querySelectorAll('.work-item-list tbody tr[aria-hidden="true"]').length,
          rows: document.querySelectorAll('.work-item-list tbody tr.list-row').length,
        },
      })
    })
  })
  await openLong(page, items(400))
  const drawn = drawnOf(page)
  expect(await drawn.count()).toBeLessThan(100)
  await page.pdf()
  const printed = await page.evaluate(() => (globalThis as { printed?: object }).printed)
  expect(printed).toEqual({ gaps: 0, rows: 400 })
  await stillFrames(page)
  expect(await drawn.count()).toBeLessThan(100)
})
