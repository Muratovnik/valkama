/**
 * The table of the task section fits its frame on a desktop, in the real app over the browser
 * double: in Russian and in English, for «Today», whose period before is named with its hours
 * («Ранее, 10 нояб., 00:00–14:30»), and for the week, at 1440, 1670 and 1920 pixels, the name,
 * the three measures, the period before and the change stand in the frame and nothing in it
 * scrolls sideways. A heading over figures takes a second line only where one line would widen
 * the table past its frame: at 1920 every one is one line. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

const ACCOUNT = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')

/** Sixteen tasks of long titles, each with work today; how much each did yesterday varies. */
const TASKS: TimedStretch[] = Array.from({ length: 16 }, (_, index) => {
  const group = {
    work_item: task(index + 1, `Read the planning documents through the board reader ${index + 1}`),
    account: ACCOUNT,
  }
  // Today: from an hour and seventeen minutes down to under a minute; tokens and a price, but
  // for the last four, which a client recorded no tokens for («Нет токенов», «Нет цены»).
  const counted = index < 12
  const today: TimedStretch = {
    at: new Date(2026, 10, 11, 9, index),
    group,
    spend: {
      seconds: counted ? (16 - index) * 290 : 30,
      tokens: counted ? 375_700 - index * 9000 : null,
      cost: counted ? 7.56 + index : null,
    },
  }
  // Yesterday by the same hour: under a minute, one second (a change of thousands of percent),
  // a few minutes, or nothing at all («Nothing before»).
  const seconds = [30, 1, 300, 0][index % 4] ?? 0
  const before: TimedStretch[] = seconds
    ? [{ at: new Date(2026, 10, 10, 9, index), group, spend: { seconds, tokens: 0, cost: 0 } }]
    : []
  return [today, ...before]
}).flat()

const PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today' }),
  week: pageAt({ by: 'work_item' }),
}

/** How the table stands in its frame, and how many lines each heading over figures takes. */
const fit = (page: Page) =>
  page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.spending-table .chart-table-frame')
    const table = frame?.querySelector('table')
    if (!frame || !table) throw new Error('no table')
    const name = table.querySelector('thead th')?.getBoundingClientRect().width ?? 0
    const headings = [...table.querySelectorAll<HTMLElement>('thead th[data-numeric="true"]')].map(
      (cell) => {
        const words = cell.querySelector('button')
        const line = Number.parseFloat(getComputedStyle(cell).lineHeight)
        const height = words?.getBoundingClientRect().height ?? 0
        return { text: cell.textContent.trim(), lines: Math.round(height / line) }
      },
    )
    return {
      frame: frame.clientWidth,
      table: Math.round(table.getBoundingClientRect().width),
      scroll: frame.scrollWidth - frame.clientWidth,
      name: Math.round(name),
      headings,
    }
  })

for (const locale of ['ru', 'en'] as const)
  test.describe(`in ${locale}`, () => {
    test.use({ locale: locale === 'ru' ? 'ru-RU' : 'en-US' })

    for (const [period, address] of Object.entries(PERIODS))
      test(`the task table of ${period} fits its frame on a desktop`, async ({ page }, info) => {
        await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
        await serve(page, TASKS)
        const seen: Record<number, Awaited<ReturnType<typeof fit>>> = {}
        for (const width of [1440, 1670, 1920]) {
          const analytics = await openReport(page, width, address)
          await expect(analytics.locator('.spending-table thead th')).toHaveCount(6)
          await page.evaluate(() => document.fonts.ready)
          const at = await fit(page)
          seen[width] = at
          expect.soft(at.scroll, `${period} at ${width}px: the table past its frame`).toBe(0)
          expect
            .soft(at.table, `${period} at ${width}px: the table's width`)
            .toBeLessThanOrEqual(at.frame)
        }
        await record(info, `task table fit ${locale} ${period}`, seen)
        // Where one line fits, a heading keeps to it.
        for (const heading of seen[1920]?.headings ?? [])
          expect.soft(heading.lines, `${heading.text} at 1920px`).toBe(1)
      })
  })
