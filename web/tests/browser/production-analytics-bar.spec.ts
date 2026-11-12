/**
 * The bar stays put: the age of the newest record counting up moves and resizes nothing beside
 * it, and a live period keeps the bar one row at 1440px. On a phone the bar is two rows, its
 * periods one row that scrolls sideways, with the rail right under it. «Today», chosen in the
 * bar, is the day's hours 0 to 23 with the one running hatched, compared with the same hours of
 * yesterday, and its address gives the view back.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { at, NOW, serveLive, settled, watchPage } from './liveDouble.ts'
import { test } from './test.ts'

const nowAddress = pageAt({ period: 'now' })

/** Two stretches of work in the live hour. */
const HOUR: TimedStretch[] = [
  { at: at(13, 50), group: { work_item: task(1, 'Fix') }, spend: { seconds: 600 } },
  { at: at(14, 20), group: { work_item: task(2, 'Read') }, spend: { seconds: 300 } },
]

/** How far the middle of a box stands from the middle of another, down the page. */
const offCentre = (box: number[] | null | undefined, other: number[] | null | undefined) =>
  Math.abs((box?.[1] ?? 0) + (box?.[3] ?? 0) / 2 - (other?.[1] ?? 0) - (other?.[3] ?? 0) / 2)

/** Where the bar's parts stand and how big they are, but the freshness's own words. */
const barParts = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [
        '.analytics-period',
        '.analytics-bar-filters',
        '.analytics-bar-live',
        '.analytics-bar-fresh',
        '.analytics-refresh',
        '.analytics-bar',
      ].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect()
        return [selector, box ? [box.x, box.y, box.width, box.height] : null]
      }),
    ),
  )

test('the age of the newest record counting up moves nothing in the bar, one row at 1440px', async ({
  page,
}, info) => {
  await page.clock.install({ time: NOW })
  const { count } = await watchPage(page)
  const double = await serveLive(page, HOUR)
  double.lastEventAt = new Date(NOW.getTime() - 1000)
  const analytics = await openReport(page, 1440, nowAddress)
  await page.clock.pauseAt(new Date(NOW.getTime() + 8000))
  await settled(count, double)
  const fresh = analytics.locator('.analytics-bar-fresh')
  const seen: Record<string, unknown> = {}
  const start = await barParts(page)
  // 9 s → 10 s, then 1 min → 2 min → 12 min.
  for (const [step, words] of [
    [0, /\b9\s/u],
    [1000, /\b10\s/u],
    [50_000, /\b1\smin/u],
    [60_000, /\b2\smin/u],
    [600_000, /\b12\smin/u],
  ] as const) {
    await page.clock.runFor(step)
    await expect(fresh).toHaveText(words)
    const now = await barParts(page)
    seen[(await fresh.textContent()) ?? ''] = now
    expect(now, `the bar at «${await fresh.textContent()}»`).toEqual(start)
  }
  // One row: the periods, the filters and the read again stand on one line.
  const [period, filters, live, refresh] = [
    '.analytics-period',
    '.analytics-bar-filters',
    '.analytics-bar-live',
    '.analytics-refresh',
  ].map((selector) => start[selector])
  for (const part of [filters, live, refresh]) expect(offCentre(part, period)).toBeLessThan(4)
  await record(info, 'bar-steady', seen)
})

test('on a phone the bar is two rows, its periods one row, and the rail right under it', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(pageAt())
  await expect(page.locator('.analytics-rail-entry').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const measured = await page.evaluate(() => {
    const bar = document.querySelector('.analytics-bar')?.getBoundingClientRect()
    const rail = document.querySelector('.analytics-rail')?.getBoundingClientRect()
    const options = [...document.querySelectorAll('.analytics-period .segmented-option')].map(
      (option) => option.getBoundingClientRect().y,
    )
    return { bar: bar?.height ?? 0, gap: (rail?.y ?? 0) - (bar?.bottom ?? 0), options }
  })
  await record(info, 'bar-phone', measured)
  expect(measured.options).toHaveLength(5)
  expect(new Set(measured.options).size, 'the periods in one row').toBe(1)
  expect(measured.bar).toBeLessThanOrEqual(140)
  expect(measured.gap).toBeGreaterThanOrEqual(0)
  expect(measured.gap).toBeLessThan(40)
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()

  // The freshness shows its age alone, whole; the sentence with the clock time is its hint.
  const time = page.locator('.analytics-bar-fresh time')
  const shown = await time.evaluate((element) => ({
    drawn: getComputedStyle(element, '::after').content,
    cut: element.scrollWidth > element.clientWidth,
    words: element.textContent ?? '',
  }))
  await record(info, 'bar-phone-fresh', shown)
  const [, age] = /^Newest record \d\d:\d\d · (.+)$/u.exec(shown.words.trim()) ?? []
  expect(age).toBeTruthy()
  // Drawn, and kept out of the name, which already says the age in its sentence.
  expect(shown.drawn).toBe(`"${age}" / ""`)
  expect(shown.cut, 'the age is cut').toBe(false)
  await time.hover()
  await expect(page.getByRole('tooltip')).toContainText(shown.words.trim())
})

/** An hour's work this morning and some in the hour running; yesterday, before and after now. */
const TODAY: TimedStretch[] = [
  { at: at(9, 10), group: { work_item: task(1, 'Fix') }, spend: { seconds: 1800 } },
  { at: at(14, 10), group: { work_item: task(2, 'Read') }, spend: { seconds: 600 } },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'Fix') },
    spend: { seconds: 900 },
  },
  {
    at: new Date(2026, 10, 10, 20),
    group: { work_item: task(1, 'Fix') },
    spend: { seconds: 7200 },
  },
]

/** The hour columns of the overview's chart: each one's start, and whether it is hatched. */
const hours = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.spending-days .period-slot')].map((slot) => ({
      key: (slot as HTMLElement).dataset.key ?? '',
      hatched: slot.querySelector('.period-incomplete') !== null,
    })),
  )

test('«Today» is its hours 0 to 23, the running one hatched, against the same hours of yesterday', async ({
  page,
}, info) => {
  await page.clock.install({ time: NOW })
  const double = await serveLive(page, TODAY)
  await openReport(page, 1440, pageAt())
  const periods = page.locator('.analytics-period')
  await expect(periods.getByRole('radio')).toHaveText([
    'Now',
    'Today',
    'This week',
    'Past 4 weeks',
    'Custom',
  ])
  await periods.getByRole('radio', { name: 'Today' }).click()
  await expect
    .poll(() => page.url().slice(new URL(page.url()).origin.length))
    .toBe(pageAt({ period: 'today' }))
  await expect(page.locator('.spending-days .period-slot')).toHaveCount(24)

  const shown = await hours(page)
  const starts = shown.map(({ key }) => new Date(key).getHours())
  expect(starts).toEqual(Array.from({ length: 24 }, (_, hour) => hour))
  expect(shown.filter(({ hatched }) => hatched).map(({ key }) => new Date(key).getHours())).toEqual(
    [14],
  )

  // Asked by the hour for the whole day, and beside it yesterday from its midnight to now's time.
  const day = double.asked.filter((query) => query.get('from') === '2026-11-11')
  expect(day.at(-1)?.get('to')).toBe('2026-11-12')
  expect(day.at(-1)?.get('step')).toBe('hour')
  const yesterday = double.asked.filter(
    (query) => query.get('from') === new Date(2026, 10, 10).toISOString(),
  )
  expect(yesterday.length).toBeGreaterThan(0)
  for (const query of yesterday) {
    expect(Date.parse(query.get('to') ?? '')).toBeLessThan(new Date(2026, 10, 10, 14, 31).getTime())
    expect(Date.parse(query.get('to') ?? '')).toBeGreaterThanOrEqual(
      new Date(2026, 10, 10, 14, 30).getTime(),
    )
  }
  // Forty minutes today against fifteen yesterday by now; yesterday's evening is not counted.
  await expect(page.locator('.tile-figure[data-measure="time"]')).toHaveText('40 min')
  const change = page.locator('.spending-tiles .tile-change').first()
  await expect(change).toContainText('↑ 167%')
  const against = await change.textContent()

  await page.locator('.spending-days').screenshot(shot(info, 'analytics-today-1440.png'))

  // The address gives the view back.
  await page.reload()
  await expect(periods.getByRole('radio', { name: 'Today' })).toBeChecked()
  await expect(page.locator('.spending-days .period-slot')).toHaveCount(24)
  await record(info, 'analytics today', {
    hatched: shown.filter(({ hatched }) => hatched).length,
    columns: shown.length,
    against,
    yesterday: yesterday.map((query) => [query.get('from'), query.get('to')]),
  })
})
