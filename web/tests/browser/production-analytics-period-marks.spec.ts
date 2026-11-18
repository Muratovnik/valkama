/**
 * The marks a chart of days draws over its columns besides their hues, in the real app at the
 * widths it is used at: the tick of the period before, the hatch of a day still running, and what
 * a part with no value is drawn in. The oracle is the owner's rule for the hatch and the tick.
 *
 * - The tick of the period before is a tick wider than its column, 4px past each side of it, in
 *   the text's main ink and ringed in the ground's colour. A segment's border never leaves its
 *   column, so the overhang is what tells the tick from the gap between two segments: a grey
 *   segment hid a tick in the quiet ink, and its dark ring read as two such gaps. Where a period's
 *   room leaves less than that beside its column, the tick reaches what it can and stays 1px
 *   inside its period's room, so it never touches a neighbour's column or tick.
 * - Hatching means a figure not final yet. The legend names the hatch, «in progress», while a
 *   day still running is on the plot, and only then.
 * - A part with no value, such as work on no task, is the plain neutral under its name and never
 *   hatched; the running day of the small trend beside it is, which shows the reading sees one.
 *
 * Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { noTask, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { frames } from './frames.ts'
import { test } from './test.ts'

const HOUR = 3600

/** How far the tick reaches past each side of its column where its period has the room. */
const OVERHANG = 4
/** How far inside its period's room the tick stays, whatever the room. */
const MARGIN = 1
/** What a box's edge may stray from another's by rounding alone. */
const HALF_PIXEL = 0.5

const worked = (
  month: number,
  day: number,
  workItem: TimedStretch['group']['work_item'],
  hours: number,
) => ({
  at: new Date(2026, month, day, 10),
  group: { work_item: workItem },
  spend: { seconds: hours * HOUR, tokens: hours * 100_000, cost: hours },
})

/**
 * This week to Wednesday, running, with work on no task stacked over a task's, against the same
 * days of the week before: Monday's tick crosses the grey of «No task», Tuesday's stands over its
 * column and Wednesday's crosses it. Three days in September and October give the four weeks
 * before the past four their ticks too, which stand over columns 24px wide.
 */
const WORLD: TimedStretch[] = [
  worked(10, 9, task(1, 'Import the plans'), 4),
  worked(10, 9, noTask, 3),
  worked(10, 10, task(1, 'Import the plans'), 2),
  worked(10, 11, task(2, 'Write the notes'), 1),
  worked(10, 11, noTask, 1),
  worked(10, 2, task(1, 'Import the plans'), 5),
  worked(10, 3, task(1, 'Import the plans'), 6),
  worked(10, 4, task(1, 'Import the plans'), 1.5),
  ...[20, 27].map((day) => worked(8, day, task(1, 'Import the plans'), 3)),
  worked(9, 4, task(1, 'Import the plans'), 3),
  ...[16, 23, 30].map((day) => worked(9, day, task(1, 'Import the plans'), 2)),
]

const WIDTHS = [1440, 1024, 390]

/**
 * Each tick of the period before as drawn: its box, its period's, its column's, its ink and its
 * ring, and the series of the segments it crosses; with the text's main ink and the ground as
 * the page resolves them.
 */
const ticks = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('i')
    document.body.append(probe)
    probe.style.color = 'var(--color-text)'
    probe.style.backgroundColor = 'var(--color-canvas)'
    const ink = getComputedStyle(probe).color
    const ground = getComputedStyle(probe).backgroundColor
    probe.style.color = 'CanvasText'
    const canvasText = getComputedStyle(probe).color
    probe.remove()
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element) => {
      const { left, right, top, bottom, width } = element.getBoundingClientRect()
      return { left, right, top, bottom, width }
    }
    const slots = [...document.querySelectorAll<HTMLElement>('.spending-days .period-slot')]
    const found = slots.flatMap((slot) => {
      const tick = slot.querySelector('.period-before')
      const stack = slot.querySelector('.period-stack')
      if (!tick || !stack) return []
      const drawn = box(tick)
      const middle = (drawn.top + drawn.bottom) / 2
      const crosses = [...stack.querySelectorAll<HTMLElement>('.period-segment')]
        .filter((segment) => {
          const { top, bottom } = segment.getBoundingClientRect()
          return top < middle && middle < bottom
        })
        .map((segment) => segment.dataset.series ?? '')
      const style = getComputedStyle(tick)
      return [
        {
          key: slot.dataset.key ?? '',
          slot: box(slot),
          column: box(stack),
          tick: drawn,
          ink: style.borderTopColor,
          ring: style.boxShadow,
          crosses,
        },
      ]
    })
    return { ink, ground, canvasText, ticks: found }
  })

type Tick = Awaited<ReturnType<typeof ticks>>['ticks'][number]

/** How far the tick reaches past its column on each side, and how far it should. */
function overhangOf(one: Tick) {
  const room = (one.slot.width - one.column.width) / 2 - MARGIN
  return {
    start: one.column.left - one.tick.left,
    end: one.tick.right - one.column.right,
    wanted: Math.min(OVERHANG, Math.max(0, room)),
  }
}

/** A tick's shape: past its column by what its room allows, and never out of its period's room. */
function expectTickShape(one: Tick) {
  const reach = overhangOf(one)
  expect(Math.abs(reach.start - reach.wanted), `${one.key}: past the column's start`).toBeLessThan(
    HALF_PIXEL,
  )
  expect(Math.abs(reach.end - reach.wanted), `${one.key}: past the column's end`).toBeLessThan(
    HALF_PIXEL,
  )
  expect(one.tick.left, `${one.key}: inside its period`).toBeGreaterThanOrEqual(
    one.slot.left + Math.min(MARGIN, (one.slot.width - one.column.width) / 2) - HALF_PIXEL,
  )
  expect(one.tick.right, `${one.key}: inside its period`).toBeLessThanOrEqual(
    one.slot.right - Math.min(MARGIN, (one.slot.width - one.column.width) / 2) + HALF_PIXEL,
  )
  expect(one.tick.bottom - one.tick.top, `${one.key}: a line, not a box`).toBeLessThanOrEqual(3)
}

/** Opens the overview's chart of days, stacked by task, at `width`: its chart rather than its table. */
async function openDays(page: Page, width: number, state: Record<string, string> = {}) {
  const analytics = await openReport(page, width, pageAt(state))
  const days = analytics.locator('.spending-days')
  const chart = days.locator('.segmented-option', { hasText: 'Chart' })
  if (await chart.isVisible()) await chart.click()
  await expect(days).toHaveAttribute('data-shown', 'chart')
  await expect(days.locator('.period-before').first()).toBeAttached()
  await page.evaluate(() => document.fonts.ready)
  await frames(days)
  return days
}

for (const width of WIDTHS)
  test(`at ${width}px the tick of the period before reaches past its column in the text's ink`, async ({
    page,
  }, info) => {
    await serve(page, WORLD)
    const days = await openDays(page, width)
    const seen = await ticks(page)
    await record(info, `before ticks ${width}`, {
      ...seen,
      overhang: seen.ticks.map((one) => ({ key: one.key, ...overhangOf(one) })),
    })
    // Monday, Tuesday and Wednesday each have a day before to stand against.
    expect(seen.ticks).toHaveLength(3)
    // The case the tick is for: Monday's crosses the grey of work on no task.
    expect(seen.ticks[0]?.crosses).toEqual(['none'])
    for (const one of seen.ticks) {
      // A three-day week leaves every day the room for the whole overhang.
      expect(overhangOf(one).wanted, `${one.key}: the room beside its column`).toBe(OVERHANG)
      expect(one.tick.width, `${one.key}: wider than its column`).toBeGreaterThan(
        one.column.width + OVERHANG,
      )
      expectTickShape(one)
      expect(one.ink, `${one.key}: the text's main ink`).toBe(seen.ink)
      expect(one.ring, `${one.key}: ringed in the ground`).toContain(seen.ground)
    }
    await days.screenshot(shot(info, `days-before-running-${width}.png`))
  })

for (const width of [1440, 390])
  test(`at ${width}px over four weeks the tick stays inside its day's room`, async ({
    page,
  }, info) => {
    await serve(page, WORLD)
    await openDays(page, width, { period: 'weeks4' })
    const seen = await ticks(page)
    await record(info, `before ticks four weeks ${width}`, {
      ticks: seen.ticks.map((one) => ({
        key: one.key,
        slot: one.slot.width,
        column: one.column.width,
        tick: one.tick.width,
        ...overhangOf(one),
      })),
    })
    expect(seen.ticks.length, 'ticks over four weeks').toBeGreaterThan(0)
    for (const one of seen.ticks) {
      expectTickShape(one)
      expect(one.tick.width, `${one.key}: no narrower than its column`).toBeGreaterThanOrEqual(
        one.column.width - HALF_PIXEL,
      )
    }
  })

test('in a forced palette the tick keeps its overhang in the palette’s ink', async ({
  page,
}, info) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await serve(page, WORLD)
  await openDays(page, 1440)
  const seen = await ticks(page)
  await record(info, 'before ticks forced', seen)
  expect(seen.ticks).toHaveLength(3)
  for (const one of seen.ticks) {
    // The ring is a shadow, which a forced palette drops: the overhang alone tells the tick.
    expectTickShape(one)
    expect(overhangOf(one).wanted).toBe(OVERHANG)
    expect(one.ink, `${one.key}: the palette's ink`).toBe(seen.canvasText)
  }
})

/** The hatch's key in the day chart's legend: its words and its swatch's mask, if it is there. */
const hatchKey = (page: Page) =>
  page.evaluate(() => {
    const key = document.querySelector('.spending-days .chart-mark[data-mark="hatch"]')
    const swatch = key?.querySelector('.chart-hatch')
    return key && swatch
      ? {
          text: key.textContent.trim(),
          mask: getComputedStyle(swatch).maskImage,
          focusable: (key as HTMLElement).tabIndex >= 0,
        }
      : null
  })

for (const [locale, word] of [
  ['en', 'in progress'],
  ['ru', 'идёт'],
] as const)
  test(`in ${locale} the legend names the hatch while a running day is on the plot, and only then`, async ({
    page,
  }, info) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await serve(page, WORLD)
    const days = await openDays(page, 1440)
    const legend = days.locator('.chart-legend')
    // This week runs to Wednesday, which is hatched: the legend names the hatch.
    await expect(days.locator('.period-incomplete')).toHaveCount(1)
    const running = await hatchKey(page)
    expect(running?.text).toBe(word)
    expect(running?.mask, 'the swatch is hatched').toContain('repeating-linear-gradient')
    expect(running?.focusable, 'the key only shows').toBe(false)

    // The week before is over: nothing on the plot is hatched, and the legend has no such key,
    // though it still keys the period before (its lone series the chart's title names).
    await page.goto(pageAt({ period: 'custom', from: '2026-11-02', to: '2026-11-04' }))
    await expect(days.locator('.period-column')).toHaveCount(3)
    await expect(days.locator('.period-incomplete')).toHaveCount(0)
    await expect(legend.locator('[data-mark="outline"]')).toBeVisible()
    const past = await hatchKey(page)
    await record(info, `hatch key ${locale}`, { running, past })
    expect(past).toBeNull()
  })

test('a part with no value is the plain neutral under its name, and a running day is hatched', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await openReport(page, 1440, pageAt())
  const rail = page.locator('.analytics-rail')
  const none = rail.locator('[data-section="work_item"] .mini-share-part[data-key="none"]')
  await expect(none).toBeVisible()
  const seen = await page.evaluate(() => {
    const probe = document.createElement('i')
    document.body.append(probe)
    probe.style.backgroundColor = 'var(--color-series-apart)'
    const neutral = getComputedStyle(probe).backgroundColor
    probe.remove()
    const part = document.querySelector(
      '.analytics-rail [data-section="work_item"] .mini-share-part[data-key="none"]',
    )
    const bar = part?.closest('[role="img"]')
    const column = [...document.querySelectorAll('.analytics-rail .mini-trend-column')].at(-1)
    if (!part || !bar || !column) throw new Error('the rail drew no share bar or trend')
    return {
      neutral,
      part: getComputedStyle(part).backgroundColor,
      mask: getComputedStyle(part).maskImage,
      name: bar.getAttribute('aria-label') ?? '',
      running: getComputedStyle(column).maskImage,
    }
  })
  await record(info, 'no value part', seen)
  expect(seen.part, 'work on no task').toBe(seen.neutral)
  expect(seen.mask, 'work on no task').toBe('none')
  expect(seen.name, 'the bar names it').toContain('No task')
  // The control: the trend's running day is hatched, and the same reading sees it.
  expect(seen.running, 'the running day').toContain('repeating-linear-gradient')
})
