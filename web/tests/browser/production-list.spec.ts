/**
 * The list in the built application: the title takes the width the other
 * columns leave and nothing is pushed past the right edge at any width, the
 * columns that give way on a narrow list are folded under the title rather
 * than cut, and the rows are one Tab stop walked with the arrows.
 */
import { expect, test } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openList, serve, shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'

for (const [width, headings, folded] of [
  [1440, ['Ref', 'Title', 'State', 'Priority', 'Assignee', 'Steps', 'Updated'], 0],
  [1024, ['Ref', 'Title', 'Steps', 'Updated'], 3],
  [390, ['Ref', 'Title'], 5],
] as const) {
  test(`the list fits its columns at ${width}px and gives the title the rest`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 })
    await installBackend(page)
    await serve(page)
    await openList(page)
    const list = page.locator('.work-item-list')
    await expect(list.locator('tbody tr').first()).toBeVisible()
    // Each heading's own sort is its first button; a folded column's sort rides the title's.
    await expect(list.locator('thead th .list-sort:not(.folded)')).toHaveText([...headings])
    const geometry = await list.evaluate((element) => {
      const heads = [...element.querySelectorAll('thead th')].map((th) =>
        th.getBoundingClientRect(),
      )
      const box = element.getBoundingClientRect()
      return {
        overflow: element.scrollWidth - element.clientWidth,
        lastRight: heads.at(-1)?.right ?? 0,
        right: box.left + element.clientWidth,
        widths: heads.map((head) => Math.round(head.width)),
      }
    })
    expect(geometry.overflow, 'nothing is pushed past the right edge').toBeLessThanOrEqual(0)
    expect(geometry.lastRight).toBeLessThanOrEqual(geometry.right + 1)
    // The title is the widest column: the spare width is its.
    expect(Math.max(...geometry.widths)).toBe(geometry.widths[1])
    // What gives way is folded under the title, not dropped: its sort is in the
    // title's heading and its value on a line of facts under each title.
    await expect(list.locator('thead .list-sort.folded')).toHaveCount(folded)
    const facts = await list.locator('tbody .list-facts').count()
    expect(facts > 0).toBe(folded > 0)
    await expectNoSilentClipping(page, `list at ${width}px`)
    await page.screenshot(shot(info, `w-list-${width}.png`))
  })
}

test('the rows are one Tab stop, walked by the arrows, and a closed card gives focus back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  const rows = page.locator('.work-item-list tbody .list-open')
  await expect(rows.first()).toBeVisible()
  const count = await rows.count()
  await expect(page.locator('.work-item-list tbody .list-open[tabindex="0"]')).toHaveCount(1)
  // Tab from the last sort heading lands on the first row, and the next Tab leaves the list.
  await page.locator('.work-item-list thead .list-sort').last().focus()
  await page.keyboard.press('Tab')
  await expect(rows.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(rows.nth(count - 1)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(rows.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const text = await rows.nth(1).textContent()
  const reference = text?.trim() ?? ''
  await page.keyboard.press('Enter')
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.head-reference')).toHaveText(reference)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(rows.nth(1)).toBeFocused()
  await expect(rows.nth(1)).toHaveAttribute('tabindex', '0')
})
