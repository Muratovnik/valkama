/**
 * The days of the Analytics page as a chart whose columns act, in the real app at the widths it
 * is used at, over spans of three days, four weeks and sixty days.
 *
 * A day a pointer presses is never narrower than an inline action. A span
 * of such days wider than the chart scrolls sideways inside the chart and never moves the page:
 * it opens on its last days, the scale stays at the chart's start with nothing showing under
 * it, the days' names stay under their columns, and the keyboard reaches the first day and the
 * last with the focused column whole in view. Each run prints what it measured.
 *
 * Such a span keeps what it shows when the chart around it changes: its last days when the
 * window is made narrower, the reader's place when they had scrolled away, and the room it
 * keeps clear of the scale when another measure makes the scale wider or narrower. The ground
 * under the scale takes a press, so none reaches a day scrolled under it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, pageScroll, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024, 390]

/** `--size-control-inline`: the least width of a day that acts, in pixels. */
const FLOOR = 28

/** An hour of work on each of the sixty days that end on Wednesday 11 November 2026. */
const SIXTY_DAYS: TimedStretch[] = Array.from({ length: 60 }, (_, back) => ({
  at: new Date(2026, 10, 11 - back, 10),
  group: { work_item: task(1, 'Import the planning documents') },
  spend: { seconds: 3600, tokens: 1_250_000 },
}))

const SPANS: { days: number; name: string; state: Record<string, string> }[] = [
  { name: 'this week', state: {}, days: 3 },
  { name: 'the past four weeks', state: { period: 'weeks4' }, days: 28 },
  {
    name: 'sixty days',
    state: { period: 'custom', from: '2026-09-13', to: '2026-11-11' },
    days: 60,
  },
]

/** Where the chart's frame, its scale and its columns stand, and how far the frame is scrolled. */
const chartPlace = (page: Page) =>
  page.evaluate(() => {
    const days = document.querySelector('.spending-days')
    const frame = days?.querySelector<HTMLElement>('.period-frame')
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null | undefined) => {
      const { left, right, top, bottom } = element?.getBoundingClientRect() ?? new DOMRect()
      return { left, right, top, bottom }
    }
    const columns = [...(days?.querySelectorAll('.period-column') ?? [])].map((column) =>
      box(column),
    )
    return {
      frame: box(frame),
      plot: box(days?.querySelector('.period-plot')),
      // How far into the plot the frame thinks the periods start: what it keeps clear of the scale.
      gutter: Number.parseFloat(
        frame ? getComputedStyle(frame).getPropertyValue('--period-gutter') : '',
      ),
      scale: box(days?.querySelector('.period-scale')),
      field: box(days?.querySelector('.period-field')),
      axis: box(days?.querySelector('.period-axis')),
      columns,
      narrowest: Math.min(...columns.map((column) => column.right - column.left)),
      scrolled: frame?.scrollLeft ?? 0,
      room: (frame?.scrollWidth ?? 0) - (frame?.clientWidth ?? 0),
    }
  })

/** The column the keyboard stands on: its box, and whether its ring shows. */
const focusedColumn = (page: Page) =>
  page.evaluate(() => {
    const column = document.activeElement
    const { left, right } = column?.getBoundingClientRect() ?? new DOMRect()
    const style = column ? getComputedStyle(column) : null
    return {
      isColumn: column?.classList.contains('period-column') ?? false,
      visible: column?.matches(':focus-visible') ?? false,
      ring: !style || style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth),
      left,
      right,
      // What stands on top at the column's middle: the column or a part of it, never the scale.
      onTop:
        column?.contains(
          document.elementFromPoint(
            (left + right) / 2,
            (column.getBoundingClientRect().top + column.getBoundingClientRect().bottom) / 2,
          ),
        ) ?? false,
    }
  })

for (const width of WIDTHS)
  for (const span of SPANS)
    test(`a day that acts keeps a width a pointer can hit over ${span.name} at ${width}px`, async ({
      page,
    }, info) => {
      await serve(page, SIXTY_DAYS)
      const analytics = await openReport(page, width, pageAt(span.state))
      const days = analytics.locator('.spending-days')
      // A narrow page shows the days as a table first; the section's own control draws them.
      await days.locator('.segmented-option', { hasText: 'Chart' }).click()
      await expect(days).toHaveAttribute('data-shown', 'chart')
      await expect(days.locator('.period-column')).toHaveCount(span.days)

      const opened = await chartPlace(page)
      // Every day is wide enough to hit, and the page itself never scrolls sideways.
      expect(Math.round(opened.narrowest * 10) / 10, 'the narrowest day').toBeGreaterThanOrEqual(
        FLOOR,
      )
      expect(await pageScroll(page), 'the page scrolls sideways').toBe(0)
      expect(opened.frame.right, 'the chart leaves the screen').toBeLessThanOrEqual(width)
      // A span wider than the chart opens on its end: the last day stands whole inside it.
      expect(Math.abs(opened.scrolled - opened.room), 'opened off its end').toBeLessThanOrEqual(1)
      const last = opened.columns.at(-1)
      expect(last?.right ?? 0, 'the last day').toBeLessThanOrEqual(opened.frame.right + 1)
      // The scale stays at the chart's start, and the days' names stand under their columns.
      expect(Math.abs(opened.scale.left - opened.frame.left), 'the scale').toBeLessThanOrEqual(1)
      expect(Math.abs(opened.axis.left - opened.field.left), 'the names').toBeLessThanOrEqual(1)
      expect(Math.abs(opened.axis.right - opened.field.right), 'the names').toBeLessThanOrEqual(1)
      expect(
        Math.abs(opened.gutter - (opened.field.left - opened.plot.left)),
        'the room kept clear of the scale',
      ).toBeLessThanOrEqual(1)

      // By keyboard: the chart is one stop, on its last day; Home goes to the first, End back.
      await days.locator('.period-column').last().focus()
      await page.keyboard.press('Home')
      const first = await focusedColumn(page)
      const atStart = await chartPlace(page)
      expect(first.isColumn && first.visible && first.ring > 0, 'the first day’s ring').toBe(true)
      expect(first.left, 'the first day under the scale').toBeGreaterThanOrEqual(
        atStart.scale.right - 1,
      )
      expect(first.onTop, 'the first day is covered').toBe(true)
      expect(Math.abs(atStart.scale.left - atStart.frame.left), 'the scale').toBeLessThanOrEqual(1)
      await page.keyboard.press('End')
      const end = await focusedColumn(page)
      const atEnd = await chartPlace(page)
      expect(end.isColumn && end.visible && end.ring > 0, 'the last day’s ring').toBe(true)
      expect(end.right, 'the last day past the chart').toBeLessThanOrEqual(atEnd.frame.right + 1)
      expect(await pageScroll(page), 'the page scrolls sideways').toBe(0)
      await expectNoSilentClipping(page, `${span.name} at ${width}px`, '.spending-days')
      await days.screenshot(shot(info, `days-${span.days}-${width}.png`))

      await record(info, `analytics days ${span.days} ${width}`, {
        narrowest: Math.round(opened.narrowest * 10) / 10,
        room: Math.round(opened.room),
        scrolledAtStart: Math.round(atStart.scrolled),
        scale: Math.round(opened.scale.right - opened.scale.left),
        firstDay: Math.round(first.left),
        scaleEnd: Math.round(atStart.scale.right),
      })
    })

/** What stands on top a little past the scale's end, at the middle of the plot's height. */
const pastScale = (page: Page) =>
  page.evaluate(() => {
    const days = document.querySelector('.spending-days')
    const scale = days?.querySelector('.period-scale')?.getBoundingClientRect()
    const field = days?.querySelector('.period-field')?.getBoundingClientRect()
    if (!scale || !field) return null
    const top = document.elementFromPoint(scale.right + 4, (field.top + field.bottom) / 2)
    return {
      ground: top?.classList.contains('period-gutter') ?? false,
      period: top?.closest('.period-slot, .period-column, .period-segment') !== null,
    }
  })

test('a span wider than the chart keeps its end, the reader’s place and the scale’s room as the chart changes', async ({
  page,
}) => {
  await serve(page, SIXTY_DAYS)
  const analytics = await openReport(page, 1440, pageAt(SPANS[2]?.state))
  const days = analytics.locator('.spending-days')
  await days.locator('.segmented-option', { hasText: 'Chart' }).click()
  await expect(days.locator('.period-column')).toHaveCount(60)
  const offEnd = async () => {
    const place = await chartPlace(page)
    return Math.abs(place.scrolled - place.room)
  }
  const frameEnd = async () => {
    const place = await chartPlace(page)
    return place.frame.right
  }
  const gutterOff = async () => {
    const place = await chartPlace(page)
    return Math.abs(place.gutter - (place.field.left - place.plot.left))
  }
  await expect.poll(offEnd, { message: 'opened off its end' }).toBeLessThanOrEqual(1)

  // The window made narrower: the plot is as wide as it was, and the last days stay in view.
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(days).toHaveAttribute('data-shown', 'chart')
  await expect
    .poll(offEnd, { message: 'left its end as the window narrowed' })
    .toBeLessThanOrEqual(1)
  const narrowed = await chartPlace(page)
  expect(narrowed.room, 'the span no longer scrolls').toBeGreaterThan(0)
  expect(narrowed.columns.at(-1)?.right ?? 0, 'the last day').toBeLessThanOrEqual(
    narrowed.frame.right + 1,
  )

  // A reader who scrolled away keeps their place when the window changes again.
  await days.locator('.period-frame').evaluate((frame) => {
    frame.scrollLeft = 200
  })
  await page.setViewportSize({ width: 1100, height: 900 })
  await expect.poll(frameEnd).toBeGreaterThan(narrowed.frame.right)
  const widened = await chartPlace(page)
  expect(widened.scrolled, 'the reader’s place').toBe(200)
  // Days stand under the scale now, and a press past its end reaches none of them.
  expect(await pastScale(page), 'a press past the scale').toEqual({ ground: true, period: false })

  // Another measure, another width of scale: the room kept clear of it follows.
  const scaleMoved = async () => {
    const place = await chartPlace(page)
    return place.scale.right - widened.scale.right
  }
  await analytics.locator('.spending-tiles .segmented-option').nth(1).click()
  await expect(days.locator('h2')).toContainText('Tokens')
  await expect
    .poll(scaleMoved, { message: 'the scale kept its width, so this run measures nothing' })
    .not.toBe(0)
  await expect
    .poll(gutterOff, { message: 'the room kept clear of the scale' })
    .toBeLessThanOrEqual(1)
})
