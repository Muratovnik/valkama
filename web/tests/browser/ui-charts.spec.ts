/**
 * The chart primitives in the browser, measured rather than looked at: at a wide desktop, a
 * laptop and a phone, nothing they draw is cut or lies on something else, the values of a
 * ranked chart end on one line, the time axis names fewer periods as it narrows, a still-running
 * period and a change stay named, and the keyboard reaches and presses what the charts open
 * with a ring that is seen. Each width attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024, 390] as const

/** `--size-control-inline`: the least width of a period's column that acts, in pixels. */
const ACTING_COLUMN = 28
/** The smallest target a pointer is asked to hit, in pixels. */
const SMALLEST_TARGET = 24

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

const HALF_PIXEL = 0.5

/** Boxes in a row of one axis that touch or cross each other, by their order along it. */
function crossings(boxes: Box[], along: 'inline' | 'block') {
  const [start, end] =
    along === 'inline' ? (['left', 'right'] as const) : (['top', 'bottom'] as const)
  const sorted = [...boxes].sort((first, second) => first[start] - second[start])
  return sorted.slice(1).filter((box, index) => {
    const before = sorted[index]
    return before !== undefined && box[start] < before[end] - HALF_PIXEL
  })
}

const inside = (box: Box, frame: Box) =>
  box.left >= frame.left - HALF_PIXEL &&
  box.right <= frame.right + HALF_PIXEL &&
  box.top >= frame.top - HALF_PIXEL &&
  box.bottom <= frame.bottom + HALF_PIXEL

const overlaps = (first: Box, second: Box) =>
  first.left < second.right - HALF_PIXEL &&
  second.left < first.right - HALF_PIXEL &&
  first.top < second.bottom - HALF_PIXEL &&
  second.top < first.bottom - HALF_PIXEL

/** Every box the assertions below read, taken in one pass after the page settled. */
function measure(page: Page) {
  return page.evaluate(() => {
    // This body is serialized and evaluated in the page, so a module-scope helper would not
    // be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element) => {
      const { bottom, left, right, top } = element.getBoundingClientRect()
      return { bottom, left, right, top }
    }
    const all = (selector: string) => [...document.querySelectorAll(selector)]
    const ranked = document.querySelector('[data-harness="ranked"] figure')
    const days = document.querySelector('[data-harness="days"] figure')
    const hours = document.querySelector('[data-harness="hours"] figure')
    if (!ranked || !days || !hours) throw new Error('the charts surface did not draw')
    const field = days.querySelector('.period-field')
    if (!field) throw new Error('the days chart drew no field')
    const zero = [...days.querySelectorAll('.period-scale .chart-tick')].find(
      (tick) => tick.textContent?.trim() === '0 min',
    )
    const zeroBox = zero ? box(zero) : null
    const floor = box(field).bottom
    return {
      viewport: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      // The harness page is a pane that scrolls, as the product's panes do; what overflows
      // sideways shows there, not in the document.
      pane: (() => {
        const pane = document.querySelector('[data-harness="charts"]')
        return { scrollWidth: pane?.scrollWidth ?? 0, clientWidth: pane?.clientWidth ?? 0 }
      })(),
      ranked: {
        frame: box(ranked),
        values: all('[data-harness="ranked"] .ranked-value').map((element) => box(element)),
        rows: all('[data-harness="ranked"] .ranked-line').map((line) => ({
          key: (line as HTMLElement).dataset.key,
          label: box(line.querySelector('.ranked-label') ?? line),
          labelText: line.querySelector('.ranked-label')?.textContent ?? '',
          track: box(line.querySelector('.ranked-track') ?? line),
          value: box(line.querySelector('.ranked-value') ?? line),
        })),
      },
      days: {
        frame: box(days),
        // The plot the chart scrolls: wider than the chart where its periods, which act and so
        // keep a width a pointer can hit, do not fit.
        plot: box(days.querySelector('.period-plot') ?? days),
        field: box(field),
        // How far the middle of the scale's zero stands from the field's floor.
        zeroFromFloor: zeroBox ? (zeroBox.top + zeroBox.bottom) / 2 - floor : null,
        axis: all('[data-harness="days"] .period-axis .chart-tick').map((tick) => ({
          text: tick.textContent?.trim() ?? '',
          ...box(tick),
        })),
        scale: all('[data-harness="days"] .period-scale .chart-tick').map((element) =>
          box(element),
        ),
        markers: all('[data-harness="days"] .period-markers .chart-tick').map((element) =>
          box(element),
        ),
        legend: all('[data-harness="days"] .chart-key').map((element) => box(element)),
        readout: box(days.querySelector('.period-readout') ?? days),
        stacks: all('[data-harness="days"] .period-stack').map((element) => box(element)),
        incomplete: all('[data-harness="days"] .period-incomplete').length,
      },
      hours: {
        frame: box(hours),
        axis: all('[data-harness="hours"] .period-axis .chart-tick').map((element) => box(element)),
      },
      // How wide each thing a pointer presses in the two charts of periods is: a day's segments
      // where segments act, an hour's column where columns do.
      pressed: {
        segments: all('[data-harness="days"] .period-segment').map(
          (element) => element.getBoundingClientRect().width,
        ),
        columns: all('[data-harness="hours"] .period-column').map(
          (element) => element.getBoundingClientRect().width,
        ),
      },
      tables: all('[data-harness$="-table"] table').map((table) => ({
        frame: box(table.parentElement ?? table),
        table: box(table),
      })),
    }
  })
}

for (const width of WIDTHS) {
  test(`the charts at ${width}px cut nothing, cross nothing and keep their values aligned`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
    await expect(
      page.locator('[data-harness="days"] .period-axis .chart-tick').last(),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const seen = await measure(page)
    await testInfo.attach(`measurements-${width}`, {
      body: JSON.stringify(seen, null, 2),
      contentType: 'application/json',
    })

    expect(seen.pageWidth, 'the page scrolls sideways').toBeLessThanOrEqual(seen.viewport)
    expect(seen.pane.scrollWidth, 'the pane scrolls sideways').toBeLessThanOrEqual(
      seen.pane.clientWidth,
    )
    await expectNoSilentClipping(page, `charts at ${width}px`, '[data-harness="charts"]')

    // Ranked: the values end on one line, every row stays in its figure, and a name never lies
    // on its bar or its value, however long; the longest name wraps rather than being cut.
    const ends = seen.ranked.values.map((value) => value.right)
    expect(Math.max(...ends) - Math.min(...ends), 'ranked values end apart').toBeLessThanOrEqual(
      HALF_PIXEL,
    )
    for (const row of seen.ranked.rows) {
      expect(inside(row.label, seen.ranked.frame), `${row.key} name inside`).toBe(true)
      expect(inside(row.value, seen.ranked.frame), `${row.key} value inside`).toBe(true)
      expect(overlaps(row.label, row.track), `${row.key} name on its bar`).toBe(false)
      expect(overlaps(row.label, row.value), `${row.key} name on its value`).toBe(false)
    }
    const long = seen.ranked.rows.find(
      (row) => row.key === 'example-project-with-a-rather-long-repository-identifier',
    )
    expect(long?.labelText).toBe('example-project-with-a-rather-long-repository-identifier')

    // Days: the axis labels, the scale and the change markers stand clear of each other and
    // inside the figure; the scale's zero stands on the field's floor; the running day is
    // hatched and still named on the axis.
    expect(crossings(seen.days.axis, 'inline'), 'axis labels cross').toEqual([])
    expect(crossings(seen.hours.axis, 'inline'), 'hour labels cross').toEqual([])
    expect(crossings(seen.days.scale, 'block'), 'scale labels cross').toEqual([])
    // A label stands inside the plot, which the chart scrolls where it is the wider of the two.
    const scrolled = {
      ...seen.days.frame,
      left: Math.min(seen.days.frame.left, seen.days.plot.left),
      right: Math.max(seen.days.frame.right, seen.days.plot.right),
    }
    for (const tick of [...seen.days.axis, ...seen.days.scale, ...seen.days.markers])
      expect(inside(tick, scrolled), 'a label outside its chart').toBe(true)
    for (const key of seen.days.legend)
      expect(inside(key, seen.days.frame), 'a legend key outside its chart').toBe(true)
    expect(inside(seen.days.readout, seen.days.frame)).toBe(true)
    expect(seen.days.axis.at(-1)?.text).toBe('Oct 30so far')
    expect(seen.days.axis.length).toBeLessThanOrEqual(8)
    expect(seen.days.incomplete).toBe(1)
    expect(seen.days.zeroFromFloor, 'the scale names zero').not.toBeNull()
    expect(Math.abs(seen.days.zeroFromFloor ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1)
    for (const stack of seen.days.stacks) {
      expect(stack.bottom).toBeCloseTo(seen.days.field.bottom, 0)
      expect(stack.top).toBeGreaterThanOrEqual(seen.days.field.top - HALF_PIXEL)
    }

    // A table wider than its column scrolls inside its own frame instead of the page.
    for (const table of seen.tables) expect(table.frame.right).toBeLessThanOrEqual(seen.viewport)
    // A period that acts keeps a width a pointer can hit, however many the chart holds: its
    // column the width of an inline action, and a segment the stack drawn inside that column,
    // which is the smallest target the product allows.
    const narrowest = (widths: number[]) => Math.round(Math.min(...widths) * 10) / 10
    expect(narrowest(seen.pressed.columns), 'the narrowest pressed column').toBeGreaterThanOrEqual(
      ACTING_COLUMN,
    )
    expect(
      narrowest(seen.pressed.segments),
      'the narrowest pressed segment',
    ).toBeGreaterThanOrEqual(SMALLEST_TARGET)
  })
}

/**
 * These periods act, so each keeps a width a pointer can hit and the plot stops narrowing with
 * the chart: it scrolls instead. The axis then names as many periods as before and never more;
 * that it names fewer where the plot itself narrows is held by the tests of `dayTicks`.
 */
test('the time axis names no more periods as the chart narrows', async ({ page }, testInfo) => {
  const counts: Record<number, number> = {}
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
    const ticks = page.locator('[data-harness="days"] .period-axis .chart-tick')
    await expect(ticks.last()).toBeVisible()
    counts[width] = await ticks.count()
  }
  await testInfo.attach('axis-labels', {
    body: JSON.stringify(counts),
    contentType: 'application/json',
  })
  expect(counts[390]).toBeLessThanOrEqual(counts[1440] ?? 0)
  expect(counts[390]).toBeGreaterThanOrEqual(2)
  // An axis that read no width would name the two ends alone, at any width.
  expect(counts[1440]).toBeGreaterThan(2)
})

/** Where the ring of the focused element is drawn, and whether something cuts it. */
function ring(page: Page) {
  return page.evaluate(() => {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement)) return null
    const style = getComputedStyle(focused)
    const reach = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
    const own = focused.getBoundingClientRect()
    const drawn = {
      left: own.left - reach,
      right: own.right + reach,
      top: own.top - reach,
      bottom: own.bottom + reach,
    }
    // What the chart itself holds the ring in; the page's own scrolling pane is the page's.
    const chart = focused.closest('figure, .chart-table-frame')
    let cutBy: string | null = null
    for (
      let node = focused.parentElement;
      node && node !== chart?.parentElement;
      node = node.parentElement
    ) {
      const clip = getComputedStyle(node)
      if (clip.overflowX === 'visible' && clip.overflowY === 'visible') continue
      const frame = node.getBoundingClientRect()
      if (
        drawn.left < frame.left ||
        drawn.right > frame.right ||
        drawn.top < frame.top ||
        drawn.bottom > frame.bottom
      )
        cutBy = node.className || node.tagName
    }
    return {
      name: focused.getAttribute('aria-label') ?? focused.textContent?.trim() ?? '',
      cell: focused.dataset.cell ?? null,
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
      drawn,
      cutBy,
    }
  })
}

for (const width of [1440, 390] as const) {
  test(`at ${width}px the keyboard reaches, walks and presses what the charts open, ringed`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
    const selected = page.locator('[data-harness="selected"]')
    const rings: unknown[] = []

    // The ranked chart: its first row that opens is the first stop; Enter presses it.
    await page.locator('body').press('Tab')
    await expect(page.locator(':focus')).toHaveAttribute('data-key', 'core')
    rings.push(await ring(page))
    await page.keyboard.press('Enter')
    await expect(selected).toHaveText('row core')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    await expect(selected).toHaveText('row web')

    // Tab leaves the ranked chart past its rows that open, then lands once in the days chart,
    // on the latest day's lowest segment.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const segment = page.locator(':focus')
    await expect(segment).toHaveAttribute('data-cell', '29:0')
    await expect(segment).toHaveAttribute('aria-label', /^October 30: personal .+ so far$/u)
    rings.push(await ring(page))
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowUp')
    await expect(page.locator(':focus')).toHaveAttribute('data-cell', '28:1')
    rings.push(await ring(page))
    await page.keyboard.press('Enter')
    await expect(selected).toHaveText('period 2026-10-29 work')

    // One more Tab leaves the days chart for the hours chart: thirty days were one stop.
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toHaveAttribute('data-cell', '23:')
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(selected).toHaveText('period h0 -')
    rings.push(await ring(page))

    await testInfo.attach(`rings-${width}`, {
      body: JSON.stringify(rings, null, 2),
      contentType: 'application/json',
    })
    for (const drawn of rings) {
      expect(drawn).not.toBeNull()
      const one = drawn as { cutBy: string | null; outline: string }
      expect(one.outline).toMatch(/^solid [1-9]/u)
      expect(one.cutBy, JSON.stringify(drawn)).toBeNull()
    }
  })
}

test('with reduced motion asked for, nothing in the charts moves on hover or focus', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
  await page.locator('[data-harness="ranked"] [data-key="core"]').hover()
  await page.locator('[data-harness="days"] .period-slot').nth(3).hover()
  await page.locator('[data-harness="hours"] .period-column').nth(12).focus()
  // The product's answer to the request (`shell.css`) leaves every change a transition of
  // 0.01ms, which nobody sees; anything longer is motion the reader asked not to have.
  const moving = await page.evaluate(() =>
    document
      .getAnimations()
      .map((animation) => ({
        target: String((animation.effect as KeyframeEffect | null)?.target?.className ?? '?'),
        duration: Number(animation.effect?.getComputedTiming().duration ?? 0),
      }))
      .filter((animation) => animation.duration > 0.01),
  )
  expect(moving).toEqual([])
})

test('in a forced palette the series, the neutral, the floor, a change and the running day stay drawn', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
  const paints = await page.evaluate(() => {
    const probe = document.createElement('i')
    document.body.append(probe)
    const system = (name: string) => {
      probe.style.color = name
      return getComputedStyle(probe).color
    }
    const style = (selector: string) => {
      const found = document.querySelector(selector)
      if (!found) throw new Error(`${selector} is not drawn`)
      return getComputedStyle(found)
    }
    const result = {
      canvasText: system('CanvasText'),
      grayText: system('GrayText'),
      segment: style('[data-harness="days"] .period-segment').backgroundColor,
      neutral: style('[data-harness="ranked"] .ranked-rest .ranked-bar').backgroundColor,
      floor: style('[data-harness="days"] .period-baseline').backgroundColor,
      change: style('[data-harness="days"] .period-mark').backgroundColor,
      hatch: style('[data-harness="days"] .period-incomplete > .period-segment').maskImage,
    }
    probe.remove()
    return result
  })
  expect(paints.segment).toBe(paints.canvasText)
  expect(paints.neutral).toBe(paints.grayText)
  expect(paints.floor).toBe(paints.grayText)
  expect(paints.change).toBe(paints.canvasText)
  expect(paints.hatch).toContain('repeating-linear-gradient')
})

test('an empty chart says so in a status and draws no plot', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
  const empty = page.locator('[data-harness="empty"]')
  await expect(empty.getByRole('status')).toHaveText([
    'No sessions in this range.',
    'No time recorded in this range.',
  ])
  await expect(empty.locator('.period-plot, .ranked-list')).toHaveCount(0)
})
