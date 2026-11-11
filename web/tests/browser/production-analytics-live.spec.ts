/**
 * The live period «Now» of the Analytics page, in the real app over the browser double.
 *
 * It is the last hour read by the minute, sixty minutes up to the moment of the view, the last
 * of them still running, and it is held in the address as every preset is. Every read of the
 * page asks that hour or the hour before it, which is what the figures are compared with. The
 * period chart names its minutes by their clock times, and its minutes add up to the total the
 * period's figures say.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serveUsage, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { test } from './test.ts'

/** Wednesday afternoon, five seconds into a minute: the live hour runs from 13:31. */
const NOW = new Date(2026, 10, 11, 14, 30, 5)
const at = (hour: number, minute: number, second = 0) =>
  new Date(2026, 10, 11, hour, minute, second)

const FIX = task(1, 'Fix the import')
const READ = task(2, 'Read the planning documents')
const SHIP = task(3, 'Ship the release')

/**
 * Work in whole minutes inside the live hour, so the chart's figures add up as minutes; work in
 * the hour before it to compare with; and work earlier that day, which no read of «now» counts.
 */
const HOUR_OF_WORK: TimedStretch[] = [
  { at: at(13, 35, 10), group: { work_item: FIX }, spend: { seconds: 300 } },
  { at: at(13, 50, 30), group: { work_item: READ }, spend: { seconds: 600 } },
  { at: at(14, 5), group: { work_item: FIX }, spend: { seconds: 120 } },
  { at: at(14, 29, 5), group: { work_item: SHIP }, spend: { seconds: 60 } },
  { at: at(12, 45), group: { work_item: FIX }, spend: { seconds: 900 } },
  { at: at(9, 0), group: { work_item: READ }, spend: { seconds: 7200 } },
]

/** The minutes of the live hour's work above, which the page's figures must say. */
const LIVE_MINUTES = (300 + 600 + 120 + 60) / 60

/** Answers every usage read from `world`, and keeps each read's query for the test to inspect. */
async function serveLive(page: Page, world: readonly TimedStretch[]) {
  const asked: URLSearchParams[] = []
  await page.clock.setSystemTime(NOW)
  await installBackend(page)
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    asked.push(query)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(serveUsage(world, query)),
    })
  })
  return asked
}

/** «1 h 5 min», «18 min», «0» as minutes: how the page writes a whole number of minutes. */
function minutesIn(text: string) {
  const plain = text.replaceAll('\u{A0}', ' ').trim()
  if (plain === '0' || plain === '') return 0
  const hours = /(\d+) h/u.exec(plain)?.[1] ?? '0'
  const minutes = /(\d+) min/u.exec(plain)?.[1] ?? '0'
  if (!/\d+ (?:h|min)/u.test(plain)) throw new Error(`not a span of minutes: ${plain}`)
  return Number(hours) * 60 + Number(minutes)
}

/** Each minute's total as the period chart's table says it, in minutes, in time order. */
async function minuteTotals(page: Page) {
  const days = page.locator('.spending-days')
  await days.getByRole('radio', { name: 'Table' }).click()
  const headings = await days.locator('thead th').allTextContents()
  const column = headings.findIndex((heading) => heading.trim() === 'total')
  const rows = days.locator('tbody tr')
  const totals: number[] = []
  for (const row of await rows.all())
    totals.push(minutesIn((await row.locator(':is(th, td)').nth(column).textContent()) ?? ''))
  await days.getByRole('radio', { name: 'Chart' }).click()
  return totals
}

const nowAddress = pageAt({ period: 'now' })

test('«Now» is the last hour by the minute, held in the address and read whole by every part', async ({
  page,
}, info) => {
  const asked = await serveLive(page, HOUR_OF_WORK)
  const analytics = await openReport(page, 1440, nowAddress)
  const period = analytics.locator('.analytics-period')

  // The live preset comes first in the period control, and is the one chosen.
  await expect(period.getByRole('radio').first()).toHaveAccessibleName('Now')
  await expect(period.getByRole('radio', { name: 'Now' })).toHaveAttribute('aria-checked', 'true')

  // Sixty minutes, named on the time axis by their clock times, the running one last.
  const days = analytics.locator('.spending-days')
  await expect(days.locator('.period-column')).toHaveCount(60)
  await expect(days.locator('h2')).toHaveText('Agent time per minute, by task')
  const tickTexts = await days
    .locator('.period-axis .chart-tick > span:first-child')
    .allTextContents()
  const ticks = tickTexts.map((text) => text.trim())
  expect(ticks.length).toBeGreaterThan(1)
  for (const tick of ticks) expect(tick).toMatch(/^\d{2}:\d{2}$/u)
  expect(ticks.at(-1)).toBe('14:30')

  // The minutes add up to the total the period's figures say.
  const totals = await minuteTotals(page)
  const summary = (await analytics.locator('.tile-figure[data-measure="time"]').textContent()) ?? ''
  expect(totals).toHaveLength(60)
  expect(totals.reduce((sum, minutes) => sum + minutes, 0)).toBe(minutesIn(summary))
  expect(minutesIn(summary)).toBe(LIVE_MINUTES)

  // Every read of the page asks the live hour or the hour before it, which it is compared with.
  const hour = { from: at(13, 31).getTime(), to: NOW.getTime() }
  const periods = new Set(
    asked.map((query) => {
      const from = Date.parse(query.get('from') ?? '')
      const to = Date.parse(query.get('to') ?? '')
      if (from === hour.from && Math.abs(to - hour.to) < 60_000) return 'the hour'
      if (from === hour.from - 3_600_000 && Math.abs(to - hour.to + 3_600_000) < 60_000)
        return 'the hour before'
      return `${query.get('from')} to ${query.get('to')}`
    }),
  )
  expect([...periods].sort()).toEqual(['the hour', 'the hour before'])

  // The address holds it: a reload opens «Now» again, and choosing it writes it.
  await page.reload()
  await expect(period.getByRole('radio', { name: 'Now' })).toHaveAttribute('aria-checked', 'true')
  await expect(days.locator('.period-column')).toHaveCount(60)
  await period.getByRole('radio', { name: 'This week' }).click()
  await expect(days.locator('.period-column')).toHaveCount(3)
  await period.getByRole('radio', { name: 'Now' }).click()
  await expect(days.locator('.period-column')).toHaveCount(60)
  const url = new URL(page.url())
  expect(`${url.pathname}${url.search}`).toBe(nowAddress)

  await record(info, 'live-hour', { ticks, totals, summary, periods: [...periods] })
})
