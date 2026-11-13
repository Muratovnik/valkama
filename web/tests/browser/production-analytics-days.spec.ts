/**
 * The days of the Analytics page as a chart whose columns act, in the real app at the widths it
 * is used at, over spans of three days, four weeks and sixty days, in both panels that draw one:
 * the overview and a dimension's section.
 *
 * A day a pointer presses is never narrower than the 24px target WCAG 2.5.8 asks, and a span
 * whose days all fit at that width does not scroll. A span of such days wider than the chart
 * scrolls sideways inside the chart and never moves the page: it opens on its first days, fades
 * toward the edge past which days are hidden, the scale stays at the chart's start with nothing
 * showing under it, the days' names stay under their columns, and the keyboard reaches the first
 * day and the last with the focused column whole in view. Each run prints what it measured.
 *
 * Such a span keeps what it shows when the chart around it changes: its first days when the
 * window is made narrower, the reader's place when they had scrolled away, and the room it
 * keeps clear of the scale when another measure makes the scale wider or narrower. The ground
 * under the scale takes a press, so none reaches a day scrolled under it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { noTask, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, pageScroll, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024, 390]

/** `--period-reach`: the least width of a day that acts, WCAG 2.5.8's target, in pixels. */
const FLOOR = 24

/** Half a pixel: what a box's edge may stray from another's by rounding alone. */
const HALF_PIXEL = 0.5

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
      frameWidth: frame?.clientWidth ?? 0,
      // Which edges say days are hidden past them, and whether the frame draws that.
      hint: {
        start: frame?.dataset.hiddenStart !== undefined,
        end: frame?.dataset.hiddenEnd !== undefined,
        drawn: frame instanceof HTMLElement && getComputedStyle(frame).maskImage !== 'none',
      },
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
      // What stands on top at the column's middle: the day — its column or a segment of its stack,
      // which stand side by side in its slot so that no control holds another — never the scale.
      onTop:
        column
          ?.closest('.period-slot')
          ?.contains(
            document.elementFromPoint(
              (left + right) / 2,
              (column.getBoundingClientRect().top + column.getBoundingClientRect().bottom) / 2,
            ),
          ) ?? false,
    }
  })

/**
 * The two panels whose days act: the overview, at the plain address, and a dimension's section,
 * held beside the rail to the panel's height with its charts scrolling on their own.
 */
const PANELS: { key: string; name: string; state: Record<string, string> }[] = [
  { key: 'overview', name: 'the overview', state: {} },
  { key: 'task', name: 'the task section', state: { by: 'work_item' } },
]

for (const panel of PANELS)
  for (const width of WIDTHS)
    for (const span of SPANS)
      test(`a day that acts keeps a width a pointer can hit over ${span.name} at ${width}px in ${panel.name}`, async ({
        page,
      }, info) => {
        await serve(page, SIXTY_DAYS)
        const analytics = await openReport(page, width, pageAt({ ...panel.state, ...span.state }))
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
        // A span wider than the chart opens on its start, its first day beside the scale, and
        // says at the frame's end that more days are there; one that fits says nothing.
        expect(opened.scrolled, 'opened off its start').toBeLessThanOrEqual(1)
        expect(opened.columns[0]?.left ?? 0, 'the first day').toBeGreaterThanOrEqual(
          opened.scale.right - 1,
        )
        const scrolls = opened.room > 0
        expect(opened.hint, 'the hint of hidden days').toEqual({
          start: false,
          end: scrolls,
          drawn: scrolls,
        })
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
        expect(Math.abs(atStart.scale.left - atStart.frame.left), 'the scale').toBeLessThanOrEqual(
          1,
        )
        await page.keyboard.press('End')
        const end = await focusedColumn(page)
        const atEnd = await chartPlace(page)
        expect(end.isColumn && end.visible && end.ring > 0, 'the last day’s ring').toBe(true)
        expect(end.right, 'the last day past the chart').toBeLessThanOrEqual(atEnd.frame.right + 1)
        expect(await pageScroll(page), 'the page scrolls sideways').toBe(0)
        await expectNoSilentClipping(
          page,
          `${span.name} at ${width}px in ${panel.name}`,
          '.spending-days',
        )
        await days.screenshot(shot(info, `days-${panel.key}-${span.days}-${width}.png`))

        await record(info, `analytics days ${panel.key} ${span.days} ${width}`, {
          narrowest: Math.round(opened.narrowest * 10) / 10,
          room: Math.round(opened.room),
          scrolledAtStart: Math.round(atStart.scrolled),
          scale: Math.round(opened.scale.right - opened.scale.left),
          firstDay: Math.round(first.left),
          scaleEnd: Math.round(atStart.scale.right),
          frame: opened.frameWidth,
        })
      })

// The task section's day chart spans its panel; four weeks fit there at both desktop sizes.
for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
] as const)
  test(`four weeks fit the task section's day chart at ${width}×${height}, every day hit at 24px or more`, async ({
    page,
  }, info) => {
    await serve(page, SIXTY_DAYS)
    await openReport(page, width, pageAt({ by: 'work_item', ...SPANS[1]?.state }))
    await page.setViewportSize({ width, height })
    const days = page.locator('.spending-days')
    await days.locator('.segmented-option', { hasText: 'Chart' }).click()
    await expect(days.locator('.period-column')).toHaveCount(28)
    await page.evaluate(() => document.fonts.ready)
    const fit = await chartPlace(page)
    await record(info, `analytics four weeks fit ${width}`, {
      frame: fit.frameWidth,
      room: fit.room,
      narrowest: Math.round(fit.narrowest * 10) / 10,
      scale: Math.round(fit.scale.right - fit.scale.left),
    })
    expect(fit.room, 'the frame scrolls sideways').toBe(0)
    expect(Math.round(fit.narrowest * 10) / 10, 'the narrowest day').toBeGreaterThanOrEqual(FLOOR)
    expect(fit.hint, 'a hint of hidden days').toEqual({ start: false, end: false, drawn: false })
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

test('a span wider than the chart keeps its start, the reader’s place and the scale’s room as the chart changes', async ({
  page,
}) => {
  await serve(page, SIXTY_DAYS)
  // The task section, whose day chart stands under its other charts in the held layout.
  const analytics = await openReport(page, 1440, pageAt({ by: 'work_item', ...SPANS[2]?.state }))
  const days = analytics.locator('.spending-days')
  await days.locator('.segmented-option', { hasText: 'Chart' }).click()
  await expect(days.locator('.period-column')).toHaveCount(60)
  const scrolled = async () => {
    const place = await chartPlace(page)
    return place.scrolled
  }
  const frameEnd = async () => {
    const place = await chartPlace(page)
    return place.frame.right
  }
  const gutterOff = async () => {
    const place = await chartPlace(page)
    return Math.abs(place.gutter - (place.field.left - place.plot.left))
  }
  await expect.poll(scrolled, { message: 'opened off its start' }).toBe(0)

  // The window made narrower: the plot is as wide as it was, and the first days stay in view.
  // Narrower, not narrow: beside the rail, a window of 1200px leaves the report wide enough to
  // keep its charts, where 1024px would open each as its table.
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(days).toHaveAttribute('data-shown', 'chart')
  const narrowed = await chartPlace(page)
  expect(narrowed.room, 'the span no longer scrolls').toBeGreaterThan(0)
  expect(narrowed.scrolled, 'left its start as the window narrowed').toBe(0)
  expect(narrowed.hint, 'the hint of hidden days').toEqual({
    start: false,
    end: true,
    drawn: true,
  })

  // A reader who scrolled away keeps their place when the window changes again.
  await days.locator('.period-frame').evaluate((frame) => {
    frame.scrollLeft = 200
  })
  await page.setViewportSize({ width: 1300, height: 900 })
  await expect.poll(frameEnd).toBeGreaterThan(narrowed.frame.right)
  const widened = await chartPlace(page)
  expect(widened.scrolled, 'the reader’s place').toBe(200)
  // Scrolled into the span, days are hidden at both edges, and both say so.
  expect(widened.hint, 'the hint of hidden days').toEqual({ start: true, end: true, drawn: true })
  // Held beside the rail, the charts scroll on their own and the day chart stands below their
  // fold: brought into view, as a reader scrolls to it, before a press is aimed at it. Scrolling
  // the charts down moves nothing sideways, so the reader's place still holds.
  await days.locator('.period-field').scrollIntoViewIfNeeded()
  const inView = await chartPlace(page)
  expect(inView.scrolled, 'the reader’s place').toBe(200)
  // Days stand under the scale now, and a press past its end reaches none of them.
  expect(await pastScale(page), 'a press past the scale').toEqual({ ground: true, period: false })

  // Another measure, another width of scale: the room kept clear of it follows.
  const scaleMoved = async () => {
    const place = await chartPlace(page)
    return place.scale.right - widened.scale.right
  }
  await analytics.locator('.spending-tiles .segmented-option').nth(1).click()
  await expect(days.locator('h3')).toContainText('Tokens')
  await expect
    .poll(scaleMoved, { message: 'the scale kept its width, so this run measures nothing' })
    .not.toBe(0)
  await expect
    .poll(gutterOff, { message: 'the room kept clear of the scale' })
    .toBeLessThanOrEqual(1)
})

/** The widths the plot is held at: a phone, a laptop beside the app's navigation, two desktops. */
const PLOT_WIDTHS = [390, 1024, 1440, 1920]

/**
 * How the plot sits in its frame: what the frame has to scroll up and down, where each name on the
 * time axis stands against the middle of its column and against the plot's edges, and how tall
 * and how wide each mark of the period before is beside its column.
 */
const plotFit = (page: Page) =>
  page.evaluate(() => {
    const days = document.querySelector('.spending-days')
    const frame = days?.querySelector<HTMLElement>('.period-frame')
    const field = days?.querySelector('.period-field')?.getBoundingClientRect()
    if (!days || !frame || !field) throw new Error('the day chart drew no plot')
    const slots = [...days.querySelectorAll<HTMLElement>('.period-slot')]
    const middles = new Map(
      slots.map((slot) => {
        const { left, right } = slot.getBoundingClientRect()
        return [slot.dataset.key, (left + right) / 2]
      }),
    )
    const names = [...days.querySelectorAll<HTMLElement>('.period-axis .chart-tick')].map(
      (tick) => {
        const { left, right, width } = tick.getBoundingClientRect()
        return { key: tick.dataset.key, left, right, width, column: middles.get(tick.dataset.key) }
      },
    )
    const before = slots.flatMap((slot) => {
      const mark = slot.querySelector('.period-before')?.getBoundingClientRect()
      const stack = slot.querySelector('.period-stack')?.getBoundingClientRect()
      return mark && stack
        ? [{ height: mark.height, width: mark.width, column: stack.width, top: mark.top }]
        : []
    })
    return {
      scrollHeight: frame.scrollHeight,
      clientHeight: frame.clientHeight,
      field: { left: field.left, right: field.right },
      names,
      before,
    }
  })

/** Where a name's middle belongs: its column's middle, kept inside the plot by half its width. */
const heldInside = (
  name: { width: number; column?: number },
  field: { left: number; right: number },
) =>
  Math.min(
    Math.max(name.column ?? Number.NaN, field.left + name.width / 2),
    field.right - name.width / 2,
  )

for (const panel of PANELS)
  for (const width of PLOT_WIDTHS)
    test(`at ${width}px in ${panel.name} the plot fits its frame and each day's name stands under its column`, async ({
      page,
    }, info) => {
      await serve(page)
      const analytics = await openReport(page, width, pageAt(panel.state))
      const days = analytics.locator('.spending-days')
      await days.locator('.segmented-option', { hasText: 'Chart' }).click()
      await expect(days).toHaveAttribute('data-shown', 'chart')
      await page.evaluate(() => document.fonts.ready)
      const fit = await plotFit(page)
      await record(info, `analytics plot ${panel.key} ${width}`, fit)

      // Nothing to scroll up and down: the frame is as tall as the plot with its names.
      expect(fit.scrollHeight, 'the frame scrolls up and down').toBeLessThanOrEqual(
        fit.clientHeight,
      )
      expect(fit.names.length, 'the axis names no day').toBeGreaterThan(0)
      for (const name of fit.names) {
        expect(name.column, `${name.key} names no column`).toBeDefined()
        // Never past the plot, and centred under its column but for what would hang past the
        // plot's edge: the middle of its column held inside the plot by half the name's width.
        expect(name.left, `${name.key} past the plot's start`).toBeGreaterThanOrEqual(
          fit.field.left - HALF_PIXEL,
        )
        expect(name.right, `${name.key} past the plot's end`).toBeLessThanOrEqual(
          fit.field.right + HALF_PIXEL,
        )
        expect(
          Math.abs((name.left + name.right) / 2 - heldInside(name, fit.field)),
          `${name.key} off its column further than the plot's edge needs`,
        ).toBeLessThanOrEqual(1)
      }
      // The period before is a short mark at its height, never a box up the plot.
      for (const mark of fit.before) {
        expect(mark.height, 'the mark of the period before').toBeLessThanOrEqual(3)
        expect(mark.width, 'the mark of the period before').toBeLessThanOrEqual(mark.column + 1)
      }
    })

const HOUR = 3600

/**
 * This week at 9 hours against 21 the same days of the week before, −57 %: two hours on a task
 * and one on no task each day, against seven hours a day a week before.
 */
const LOWER: TimedStretch[] = [
  ...[9, 10, 11].flatMap((day) => [
    {
      at: new Date(2026, 10, day, 10),
      group: { work_item: task(1, 'Import the planning documents') },
      spend: { seconds: 2 * HOUR },
    },
    { at: new Date(2026, 10, day, 11), group: { work_item: noTask }, spend: { seconds: HOUR } },
  ]),
  ...[2, 3, 4].map((day) => ({
    at: new Date(2026, 10, day, 10),
    group: { work_item: task(1, 'Import the planning documents') },
    spend: { seconds: 7 * HOUR },
  })),
]

for (const width of [1440, 1920])
  test(`at ${width}px a week lower than the one before reads by its own columns`, async ({
    page,
  }, info) => {
    await serve(page, LOWER)
    const analytics = await openReport(page, width, pageAt())
    const days = analytics.locator('.spending-days')
    await expect(days.locator('.period-before')).toHaveCount(3)
    const fit = await plotFit(page)
    const stacks = await days
      .locator('.period-stack')
      .evaluateAll((all) => all.map((stack) => stack.getBoundingClientRect().top))
    await record(info, `analytics lower week ${width}`, { before: fit.before, stacks })
    for (const [index, mark] of fit.before.entries()) {
      expect(mark.height, 'the mark of the period before').toBeLessThanOrEqual(3)
      // Higher than this week's column, as the week before was.
      expect(mark.top, 'the mark under its column’s top').toBeLessThan(stacks[index] ?? 0)
    }
    // The latest day's hint still says the figure of the week before in words.
    await expect(days.locator('.period-column[tabindex="0"]')).toHaveAttribute(
      'data-tooltip',
      /period before 7\sh/u,
    )
    await days.screenshot(shot(info, `days-lower-week-${width}.png`))
  })
