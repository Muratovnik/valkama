/**
 * The live period «Now» of the Analytics page, in the real app over the browser double.
 *
 * It is the last hour read by the minute, sixty minutes up to the moment of the view, the last
 * of them still running, and it is held in the address as every preset is. Every read of the
 * page asks that hour or the hour before it, which is what the figures are compared with. The
 * period chart names its minutes by their clock times, and its minutes add up to the total the
 * period's figures say.
 *
 * It reads itself again every thirty seconds while the page is seen and asks nothing while it is
 * hidden, which the test counts in reads against the page's own clock, moved by the test; no
 * other period reads itself again.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record } from './analyticsPage.ts'
import { at, NOW, serveLive, settled, watchPage } from './liveDouble.ts'
import { test } from './test.ts'

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
  const { asked } = await serveLive(page, HOUR_OF_WORK)
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

/**
 * How many times the page was read as of a new moment: one read by account is asked each time,
 * for the accounts that worked and the tile of the accounts together.
 */
const roundsOf = (asked: readonly URLSearchParams[]) =>
  new Set(
    asked.filter((query) => query.get('group_by') === 'account').map((query) => query.get('to')),
  ).size

test('«Now» reads itself again every 30 s while the page is seen, and never while hidden', async ({
  page,
}, info) => {
  await page.clock.install({ time: NOW })
  const { show, reads, count } = await watchPage(page)
  const double = await serveLive(page, HOUR_OF_WORK)
  const analytics = await openReport(page, 1440, nowAddress)
  await expect(analytics.locator('.analytics-bar-live')).toHaveText('Live, every 30 s')
  await page.clock.pauseAt(new Date(NOW.getTime() + 10_000))
  await settled(count, double)
  expect(roundsOf(await reads())).toBe(1)

  // Seen: each interval is one read, asked as the interval ends, and no more.
  const INTERVALS = 3
  for (let interval = 1; interval <= INTERVALS; interval += 1) {
    await page.clock.runFor(30_000)
    expect(roundsOf(await reads())).toBe(1 + interval)
    await settled(count, double)
  }
  await page.clock.runFor(1000)
  expect(roundsOf(await reads())).toBe(1 + INTERVALS)

  // Hidden for several intervals: not one read of any kind.
  const beforeHiding = await count()
  await show('hidden')
  await page.clock.runFor(4 * 30_000)
  const whileHidden = (await count()) - beforeHiding
  expect(whileHidden).toBe(0)

  // Seen again after missed intervals: one read at once, without the clock moving, and no more.
  await show('visible')
  await expect.poll(async () => roundsOf(await reads())).toBe(2 + INTERVALS)
  await settled(count, double)
  await page.clock.runFor(1000)
  expect(roundsOf(await reads())).toBe(2 + INTERVALS)

  // Another period never reads itself again, and says nothing of being live.
  await analytics.locator('.analytics-period').getByRole('radio', { name: 'This week' }).click()
  await expect(analytics.locator('.spending-days .period-column')).toHaveCount(3)
  await expect(analytics.locator('.analytics-bar-live')).toHaveCount(0)
  await settled(count, double)
  const weekReads = await count()
  await page.clock.runFor(4 * 30_000)
  const weekAfterIntervals = (await count()) - weekReads
  expect(weekAfterIntervals).toBe(0)

  await record(info, 'live-refresh', {
    rounds: roundsOf(await reads()),
    whileHidden,
    weekAfterIntervals,
  })
})
