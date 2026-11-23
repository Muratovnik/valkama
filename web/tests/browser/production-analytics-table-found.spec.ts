/**
 * The totals of a section's every-value table while a name is looked for, in the real app over the
 * browser double. The oracle is the requirement (`DESIGN.md`, Analytics): with a search that keeps
 * some rows, the total of those found and the period's total stand as two rows of the table's
 * footer, «Total of those found» over «Total for the period», held at the bottom edge of the
 * table's frame while its rows scroll under them; with nothing looked for the period's total
 * stands alone, «Total». At 1440 and 1024 pixels, in both languages, each total's cells stand
 * under the heading's cells of their columns, whole and inside the frame. Each run prints what
 * it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve, shortfalls } from './analyticsPage.ts'
import { test } from './test.ts'

const on = (day: number) => new Date(2026, 10, day, 10)

/** Forty tasks over three days, half of them «Read …» and half «Write …»: a search keeps half. */
const WORLD: TimedStretch[] = Array.from({ length: 40 }, (_, index) => ({
  at: on(9 + (index % 3)),
  group: {
    work_item: task(index + 1, `${index % 2 ? 'Write' : 'Read'} the import notes ${index + 1}`),
  },
  spend: { seconds: 3600 + index * 60, tokens: 1000, cost: 1 },
}))

const EVERY = pageAt({ by: 'work_item', detail: JSON.stringify({ by: 'work_item', all: true }) })

const NAMES = {
  en: { found: 'Total of those found', period: 'Total for the period', alone: 'Total' },
  ru: { found: 'Итого найденного', period: 'Итого за период', alone: 'Итого' },
}

/** The table's footer as it stands: its rows, how each lines up and whether its words are whole. */
async function measured(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const short = await shortfalls(page, '[data-detail="all"] .table-total .chart-cell')
  const placed = await page.evaluate(() => {
    const table = document.querySelector('[data-detail="all"]')
    const frame = table?.querySelector('.section-table-frame')?.getBoundingClientRect()
    const scroller = table?.querySelector<HTMLElement>('.section-table-frame')
    const heads = [...(table?.querySelectorAll('thead tr:last-child > *') ?? [])].map((cell) =>
      cell.getBoundingClientRect(),
    )
    const rows = [...(table?.querySelectorAll<HTMLElement>('.table-total') ?? [])].map((row) => {
      const box = row.getBoundingClientRect()
      const cells = [...row.children].map((cell) => cell.getBoundingClientRect())
      return {
        key: row.dataset.total,
        name: row.querySelector('th')?.textContent?.trim(),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        inside: Boolean(
          frame &&
          box.top >= frame.top - 0.5 &&
          box.bottom <= frame.bottom + 0.5 &&
          cells.every((cell) => cell.left >= frame.left - 0.5 && cell.right <= frame.right + 0.5),
        ),
        /** How far each cell's edges stand from its column's heading, the widest of them. */
        offset: Math.max(
          ...cells.map((cell, index) => {
            const head = heads[index]
            return head
              ? Math.max(Math.abs(cell.left - head.left), Math.abs(cell.right - head.right))
              : 99
          }),
        ),
        columns: cells.length,
      }
    })
    return {
      rows,
      heads: heads.length,
      frameBottom: Math.round(frame?.bottom ?? 0),
      scrolls: Boolean(scroller && scroller.scrollHeight > scroller.clientHeight + 1),
    }
  })
  return { ...placed, short: short.map((one) => one.short) }
}

/** Scrolls the table's frame part of the way down, so rows stand under the footer. */
async function scrollPart(page: Page) {
  await page.locator('[data-detail="all"] .section-table-frame').evaluate((frame) => {
    frame.scrollTop = Math.round((frame.scrollHeight - frame.clientHeight) / 2)
  })
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    test(`in ${locale} at ${width}px, a search's two totals stand in the held footer under their columns`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.setViewportSize({ width, height: 900 })
      await serve(page, WORLD)
      await page.goto(EVERY)
      const table = page.locator('[data-detail="all"]')
      const rows = table.locator('tbody tr')
      await expect(rows).toHaveCount(40)

      const alone = await measured(page)
      await page.locator('.value-table-find input').fill('Read')
      await expect(rows).toHaveCount(20)
      const found = await measured(page)
      await scrollPart(page)
      const scrolled = await measured(page)
      await record(info, `table found ${locale} ${width}`, { alone, found, scrolled })

      expect(alone.rows.map((row) => [row.key, row.name])).toEqual([
        ['period', NAMES[locale].alone],
      ])
      expect(found.rows.map((row) => [row.key, row.name])).toEqual([
        ['found', NAMES[locale].found],
        ['period', NAMES[locale].period],
      ])
      expect(found.scrolls, 'the rows found scroll in the frame').toBe(true)
      for (const one of [alone, found, scrolled]) {
        for (const row of one.rows) {
          expect(row.columns, 'a cell for every column').toBe(one.heads)
          expect(row.offset, 'under the heading of its column').toBeLessThanOrEqual(0.5)
          expect(row.inside, 'inside the frame').toBe(true)
        }
        expect(Math.max(...one.short), 'the words whole').toBeLessThanOrEqual(0.5)
      }
      for (const one of [found, scrolled]) {
        const [first, second] = one.rows
        expect(second?.bottom, 'the footer at the frame’s bottom edge').toBe(one.frameBottom)
        expect(first?.bottom, 'the found total over the period’s').toBe(second?.top)
      }
    })
