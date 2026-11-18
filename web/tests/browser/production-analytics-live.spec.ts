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
 * other period reads itself again. The bar says how old the newest record is, in seconds under a
 * minute, and counts it up without a read; the minutes after that record are hatched and say they
 * have no data yet, in the chart and in its table, and a note says a minute's figures are an
 * estimate.
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
  await expect(days.locator('h3')).toHaveText('Agent time per minute, by task')
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
  new Set(asked.filter((query) => query.get('group_by') === 'seat').map((query) => query.get('to')))
    .size

test('«Now» reads itself again every 30 s while the page is seen, and never while hidden', async ({
  page,
}, info) => {
  await page.clock.install({ time: NOW })
  const { show, reads, count } = await watchPage(page)
  const double = await serveLive(page, HOUR_OF_WORK)
  // The page's time stops before it opens, so a slow open cannot move the pause into the past.
  await page.clock.pauseAt(new Date(NOW.getTime() + 10_000))
  const analytics = await openReport(page, 1440, nowAddress)
  // The freshness's mark says it is live, and its hint how often it reads itself again.
  const fresh = analytics.locator('.analytics-bar-fresh')
  await expect(fresh.locator('.analytics-bar-fresh-mark')).toBeVisible()
  await expect(fresh).toHaveAttribute('data-tooltip', /\nLive, every 30\u{A0}s$/u)
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
  await expect(fresh.locator('.analytics-bar-fresh-mark')).toHaveCount(0)
  await expect(fresh).not.toHaveAttribute('data-tooltip', /Live/u)
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

test('the minutes after the newest record say they have no data yet, and the minutes are an estimate', async ({
  page,
}, info) => {
  // The newest record read is three minutes before the moment of the view, and no work after it.
  const newest = new Date(NOW.getTime() - 3 * 60_000)
  const double = await serveLive(
    page,
    HOUR_OF_WORK.filter((stretch) => stretch.at < newest),
  )
  double.lastEventAt = newest
  const analytics = await openReport(page, 1440, nowAddress)
  const days = analytics.locator('.spending-days')
  await expect(days.locator('.period-column')).toHaveCount(60)

  // What a minute's figures are is the section's to say, in its «ⓘ», and no line of the chart's.
  const estimate =
    'Figures per minute are an estimate: each stretch of work is shared out among the minutes it spans by its time in each.'
  const about = analytics.locator('.analytics-panel .level-about-press')
  await about.click()
  await expect(page.locator('.info-tip-panel')).toContainText(estimate)
  await about.click()
  await expect(page.locator('.info-tip-panel')).toBeHidden()
  await expect(days).not.toContainText(estimate)

  // The three minutes after 14:27:05 are hatched as the plot is tall, a minute of nothing before
  // them is not: no data yet is told from zero by more than a hue.
  const pending = days.locator('.period-slot:has(.period-pending)')
  await expect(pending).toHaveCount(3)
  const slots = await days.locator('.period-slot').evaluateAll((all) =>
    all.map((slot) => ({
      pending: slot.querySelector('.period-pending') !== null,
      ground: Math.round(
        slot.querySelector('.period-pending')?.getBoundingClientRect().height ?? 0,
      ),
      stack: Math.round(slot.querySelector('.period-stack')?.getBoundingClientRect().height ?? 0),
    })),
  )
  expect(slots.map((slot) => slot.pending).lastIndexOf(false)).toBe(56)
  const field = await days.locator('.period-field').boundingBox()
  for (const slot of slots.slice(57)) {
    expect(slot.ground).toBe(Math.round(field?.height ?? Number.NaN))
    expect(slot.stack).toBe(0)
  }
  // 14:26, a minute of no work and with data, stands as a zero: no ground, no stack.
  expect(slots[55]).toEqual({ pending: false, ground: 0, stack: 0 })

  // In words: the hint of such a minute, and its row of the table.
  await days.locator('.period-slot:has(.period-pending) .period-column').first().hover()
  // Its sum is not said: the minute holds no data yet, which is not a total of zero.
  await expect(page.getByRole('tooltip')).toHaveText(/ 14:28, period before 0\smin\s+No data yet$/u)
  await days.getByRole('radio', { name: 'Table' }).click()
  const headingTexts = await days.locator('thead th').allTextContents()
  const headings = headingTexts.map((text) => text.trim())
  const cells = (minute: number) => days.locator('tbody tr').nth(minute).locator(':is(th, td)')
  await expect(cells(57).first()).toContainText('14:28')
  await expect(cells(57).nth(headings.indexOf('total'))).toHaveText('—No data yet')
  await expect(cells(57).last()).toHaveText('No data yet')
  await expect(cells(56).nth(headings.indexOf('total'))).toHaveText(/^0\smin$/u)
  await expect(cells(56).last()).toHaveText('')
  await expect(days).not.toContainText(estimate)

  await record(info, 'live-not-yet', { slots: slots.slice(54) })
})

test('the bar counts the age of the newest record in seconds, without a read', async ({ page }) => {
  await page.clock.install({ time: NOW })
  const { count } = await watchPage(page)
  const double = await serveLive(page, HOUR_OF_WORK)
  double.lastEventAt = new Date(NOW.getTime() - 20_000)
  // The page's time stops before it opens, so a slow open cannot move the pause into the past.
  await page.clock.pauseAt(new Date(NOW.getTime() + 10_000))
  const analytics = await openReport(page, 1440, nowAddress)
  await settled(count, double)
  const fresh = analytics.locator('.analytics-bar-fresh')
  await expect(fresh).toHaveText('Newest record 14:29 · 30\u{A0}s ago')
  const asked = await count()
  // Five seconds on, inside the interval: the age moved on its own, and nothing was read.
  await page.clock.runFor(5000)
  await expect(fresh).toHaveText('Newest record 14:29 · 35\u{A0}s ago')
  expect(await count()).toBe(asked)
})
