/**
 * What a table keeps in place while the rest of it passes under — the names at the frame's start
 * of every chart's table, and the heading row and the total of a section's table — is painted in
 * the ground the table stands on, so it covers what passes under it without a block of another
 * colour: on the surface of a quota account, and on the panel itself in a section. In the real
 * app, in the light and the dark theme, at 1440 and 390 pixels: the week's and the five hours'
 * quota as tables, the task section with its ranked bars, small charts and days as tables beside
 * its own table, and the token kinds. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openPanel, pageAt, record, serve, TASK_REPORT } from './analyticsPage.ts'
import { test } from './test.ts'

/** The panels measured, by their address and a part that says their tables are drawn. */
const PANELS = [
  { name: 'quota week', address: pageAt({ by: 'quota_week' }), ready: '.quota-account' },
  {
    name: 'quota five hours',
    address: pageAt({ by: 'quota_five_hour' }),
    ready: '.quota-account',
  },
  { name: 'task section', address: TASK_REPORT, ready: '.spending-table tbody tr' },
  { name: 'token kinds', address: pageAt({ by: 'token_kind' }), ready: '.kinds-table tbody tr' },
] as const

/**
 * Every cell of a chart's table that stays in place, with its fill and the ground under its
 * table: the fill of the nearest box around the table's frame that paints one.
 */
const grounds = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.analytics-panel .chart-table-frame')]
      .filter((frame) => frame.checkVisibility())
      .flatMap((frame) => {
        const painted = (element: Element) => {
          const fill = getComputedStyle(element).backgroundColor
          return fill !== 'transparent' && !/rgba\(.*,\s*0\)$/u.test(fill)
        }
        let under: Element | null = frame.parentElement
        while (under && !painted(under)) under = under.parentElement
        const ground = under ? getComputedStyle(under).backgroundColor : 'none'
        // A table is named by its caption, which only a screen reader reads.
        const table = frame.querySelector('caption')?.textContent.trim() ?? ''
        return [...frame.querySelectorAll('th, td')]
          .filter((cell) => getComputedStyle(cell).position === 'sticky')
          .map((cell) => ({
            table: `${table} / ${(under as HTMLElement | null)?.className ?? ''}`,
            cell: cell.textContent.trim().slice(0, 24),
            fill: getComputedStyle(cell).backgroundColor,
            ground,
          }))
      }),
  )

/**
 * Opens a panel by its address, from the list of sections where a phone shows the list first,
 * and shows each of its charts as its table, as a phone opens it.
 */
async function openWithTables(page: Page, address: string, ready: string) {
  await openPanel(page, address)
  await expect(page.locator(ready).first()).toBeVisible()
  const radios = page.locator('.analytics-panel').getByRole('radio', { name: 'Table', exact: true })
  for (const radio of await radios.all())
    if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click()
}

for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [1440, 390])
    test(`at ${width}px in the ${colorScheme} theme what a table keeps in place is painted in its ground`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme })
      await serve(page)
      await page.setViewportSize({ width, height: 1000 })
      const seen: Record<string, unknown> = {}
      for (const panel of PANELS) {
        await openWithTables(page, panel.address, panel.ready)
        await expect(page.locator('.window-spend[data-state="loading"]')).toHaveCount(0)
        const cells = await grounds(page)
        seen[panel.name] = cells
        expect(cells.length, `${panel.name}: cells kept in place`).toBeGreaterThan(0)
        const strays = cells.filter((cell) => cell.fill !== cell.ground)
        expect.soft(strays, `${panel.name}: cells not in their table's ground`).toEqual([])
      }
      await record(info, `table ground ${width} ${colorScheme}`, seen)
    })
