/**
 * The forecast's end in the built app, on the step line and on the bar (`StepLine`, `WindowBar`).
 *
 * On the step line the forecast is one dashed line of the readings' width in their hue from where
 * they end at now, along the faster pace. Where that runs out before the reset the line ends at
 * the run-out on the level of the whole window and nothing of the forecast stands past it; where it
 * does not it ends at the reset at its share. A week's range down to the slower pace is a solid
 * fill of low opacity under the line, with no hatch and no outline, and none where it would be
 * under a few pixels tall. The line's end is the forecast's place: pointed at, a round dot at
 * least a reading's dot across, ringed in the ground, never a ring around nothing and never a dash,
 * as wide as it is tall at every width, in a forced palette's ink under one; its hint stands beside
 * it and off the line's head. The owner's complaint it answers: the forecast drawn as a hatched
 * band was thick, and its end's mark at 100 % was a flat dash. On the bar a week's forecast is one
 * hatched tail from the fill's end, past the gap the fill keeps, to the range's high end, with no
 * gap inside it; five hours draw theirs as before, and the bar's hint and its words for a screen
 * reader say what the pace tick stands for.
 *
 * The cases, from the quota fixture: «Work»'s week at 41 %, 56.93 % to 61.2 % by the reset, which
 * lasts, its range three and a half pixels tall; the unnamed account's week at 88 %, 97.5 % to 104.2 %, which
 * may run out before the reset a day off; «Work»'s five hours at 62 %, running out before the
 * reset; the unnamed account's five hours at 0 %, lasting to the reset at 35 %; and «Edge»'s model
 * week at 0 %, 4 % to 9 %, which lasts with a range of five. Each run attaches what it measured and
 * a picture of the window.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { NIGHT_NAME } from '../fixtures/quota.ts'
import { present } from '../support/present.ts'
import { openPanel, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** How far a drawn edge may stand from where it should: the drawing's rounding, a pixel. */
const NEAR = 1

/** The surface gap the bar keeps between the fill and the tail (`--space-half`). */
const GAP = 2

/** Opens the window of `account` of the `kind` in the section `by`, drawn as a chart. */
async function openWindow(
  page: Page,
  {
    by,
    account,
    kind,
    width = 1440,
  }: { account: string; by: string; kind: string; width?: number },
) {
  await serve(page)
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  return panel.locator(`[data-account="${account}"] [data-window="${kind}"]`)
}

/** Where a share stands down the line's drawing, in pixels of the page. */
const shareAt = (window: Locator, share: number) =>
  window.locator('[data-chart="steps"] [data-region="drawing"]').evaluate((drawing, value) => {
    const box = drawing.getBoundingClientRect()
    return box.top + box.height * (1 - value / 100)
  }, share)

/** A point on the page. */
interface Spot {
  left: number
  top: number
}

/**
 * The forecast as the line draws it: how many lines, the corners of the line and of its range's
 * fill where the plot's own mapping puts them on the page, how each is painted, and where the
 * reset of the current window stands across, under the axis word that names it.
 */
const forecastOf = (window: Locator) =>
  window.locator('[data-chart="steps"]').evaluate((figure) => {
    const corners = (path: SVGPathElement | null): Spot[] | null => {
      const matrix = path?.getScreenCTM()
      if (!path || !matrix) return null
      const numbers = (path.getAttribute('d') ?? '').match(/-?[\d.]+(?:e-?\d+)?/gu) ?? []
      const found: Spot[] = []
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        const point = new DOMPoint(Number(numbers[index]), Number(numbers[index + 1]))
        const { x, y } = point.matrixTransform(matrix)
        found.push({ left: x, top: y })
      }
      return found
    }
    const lines = figure.querySelectorAll<SVGPathElement>('[data-mark="forecast"]')
    const range = figure.querySelector<SVGPathElement>('[data-mark="range"]')
    const line = lines[0] ?? null
    const stroke = line ? getComputedStyle(line) : null
    const fill = range ? getComputedStyle(range) : null
    const reset = figure.querySelector('[data-region="axis"] [data-moment="to"]')
    return {
      count: lines.length,
      line: corners(line),
      stroke: stroke && {
        paint: stroke.stroke,
        width: Number.parseFloat(stroke.strokeWidth),
        dash: stroke.strokeDasharray,
      },
      range: corners(range),
      fill: fill && {
        paint: fill.fill,
        opacity: Number(fill.fillOpacity),
        stroke: fill.stroke,
        mask: fill.maskImage,
      },
      reset: reset?.getBoundingClientRect().right ?? null,
    }
  })

/** Points at the forecast's place and returns its mark, painted, and the hint it shows. */
async function pointAtForecast(page: Page, window: Locator) {
  const mark = window.locator('[data-target="reset"] [data-mark="place"]')
  await expect(mark).toHaveCount(1)
  await window.locator('[data-chart="steps"]').scrollIntoViewIfNeeded()
  await expect(mark).toHaveCSS('opacity', '0')
  const box = present(await mark.boundingBox(), 'the forecast’s mark')
  await page.mouse.move(1, 1)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 })
  await expect(mark).toHaveCSS('opacity', '1')
  const hint = page.locator('.tooltip-hint')
  await expect(hint).toHaveCount(1)
  return { mark, hint }
}

/** The mark as drawn: its box, its shape's hook, its paint and ring, and the forced palette's ink. */
const drawnMark = (mark: Locator) =>
  mark.evaluate((element) => {
    const style = getComputedStyle(element)
    const probe = document.createElement('i')
    document.body.append(probe)
    probe.style.color = 'CanvasText'
    const ink = getComputedStyle(probe).color
    probe.style.color = 'Canvas'
    const ground = getComputedStyle(probe).color
    probe.remove()
    const { top, left, width, height } = element.getBoundingClientRect()
    return {
      shape: (element as HTMLElement).dataset.shape ?? '',
      centre: { left: left + width / 2, top: top + height / 2 },
      width,
      height,
      round: style.borderRadius,
      paint: style.backgroundColor,
      ring: { width: style.outlineWidth, paint: style.outlineColor, style: style.outlineStyle },
      inset: style.boxShadow,
      ink,
      ground,
    }
  })

/** Whether the hint stands beside the mark, clear of it across, and clear of the line's head. */
async function expectBeside(hint: Locator, mark: Locator, window: Locator) {
  const hintBox = present(await hint.boundingBox(), 'the hint')
  const markBox = present(await mark.boundingBox(), 'the mark')
  const head = present(
    await window.locator('[data-chart="steps"] [data-region="head"]').boundingBox(),
    'the line’s head',
  )
  const clearAcross =
    hintBox.x >= markBox.x + markBox.width - NEAR || hintBox.x + hintBox.width <= markBox.x + NEAR
  expect(clearAcross, 'the hint beside the mark, not over it').toBe(true)
  expect(hintBox.y, 'the hint off the line’s head').toBeGreaterThanOrEqual(
    head.y + head.height - NEAR,
  )
}

/** Whether a range's fill is quiet and solid: a paint at low opacity, no outline, no mask; or none. */
const quietFill = (fill: Awaited<ReturnType<typeof forecastOf>>['fill']) =>
  fill === null ||
  (fill.stroke === 'none' &&
    fill.mask === 'none' &&
    !fill.paint.startsWith('url(') &&
    fill.opacity > 0 &&
    fill.opacity < 0.5)

/** Where the line's top stands at `left` along the forecast's line `line`, between its corners. */
function lineTopAt(line: readonly Spot[], left: number) {
  for (const [index, from] of line.entries()) {
    const to = line[index + 1]
    if (!to || left > to.left) continue
    const along = to.left === from.left ? 0 : (left - from.left) / (to.left - from.left)
    return from.top + (to.top - from.top) * along
  }
  return line.at(-1)?.top ?? Number.NaN
}

/** The cases: a window by its account and kind, its section, and where its forecast's line ends. */
const CASES = [
  {
    name: 'a week that runs out',
    by: 'quota_week',
    account: NIGHT_NAME,
    kind: 'week',
    ends: { share: 100, before: true },
    fill: true,
  },
  {
    name: 'a week that lasts',
    by: 'quota_week',
    account: 'Work',
    kind: 'week',
    ends: { share: 61.2, before: false },
    // 61.2 less 56.93 is three and a half pixels of the line's 82: a fill, just.
    fill: true,
  },
  {
    name: 'five hours that run out',
    by: 'quota_five_hour',
    account: 'Work',
    kind: 'five_hour',
    ends: { share: 100, before: true },
    fill: false,
  },
  {
    name: 'five hours that last',
    by: 'quota_five_hour',
    account: NIGHT_NAME,
    kind: 'five_hour',
    ends: { share: 35, before: false },
    fill: false,
  },
] as const satisfies readonly {
  account: string
  by: string
  ends: { before: boolean; share: number }
  fill: boolean
  kind: string
  name: string
}[]

for (const width of [1440, 1024, 390])
  for (const one of CASES)
    test(`at ${width}px ${one.name}: one dashed line to its end, a quiet fill under it, a round dot there`, async ({
      page,
    }, info) => {
      const window = await openWindow(page, { ...one, width })
      // Pointed at first, so the line, its share and its dot are measured where it stands then.
      const { mark, hint } = await pointAtForecast(page, window)
      const drawn = await forecastOf(window)
      const level = await shareAt(window, one.ends.share)
      const dot = await drawnMark(mark)
      await record(info, `forecast ${one.kind} ${one.account} ${width}`, { drawn, level, dot })
      // One line, 2px and dashed in the readings' hue, from now to its end.
      expect(drawn.count, 'one forecast line').toBe(1)
      const line = present(drawn.line, 'the forecast line')
      const end = present(line.at(-1), 'its end')
      expect(drawn.stroke?.width, 'as wide as the readings').toBe(2)
      expect(drawn.stroke?.dash, 'dashed').not.toBe('none')
      // It ends at the run-out on the level of the whole window, short of the reset, or at the
      // reset at its share.
      expect(Math.abs(end.top - level), 'its end at its share').toBeLessThan(NEAR)
      const reset = present(drawn.reset, 'the reset')
      expect(end.left < reset - NEAR, 'its end short of the reset').toBe(one.ends.before)
      expect(Math.abs(end.left - reset) < NEAR, 'its end at the reset').toBe(!one.ends.before)
      // The range's fill where it is a few pixels tall: solid at low opacity under the line, never
      // past its end; or none.
      expect(drawn.range !== null, 'a fill').toBe(one.fill)
      for (const corner of drawn.range ?? []) {
        expect(corner.left, 'the fill inside the line across').toBeLessThanOrEqual(end.left + NEAR)
        expect(corner.top, 'the fill under the line').toBeGreaterThanOrEqual(
          lineTopAt(line, corner.left) - NEAR,
        )
      }
      expect(quietFill(drawn.fill), 'a quiet solid fill or none').toBe(true)
      // Its end's mark: a round dot centred on the line's end, at least a reading's dot across, as
      // wide as it is tall, painted in the line's hue and ringed in the ground; never a ring, never a dash.
      expect(dot.shape).toBe('dot')
      expect(Math.abs(dot.width - dot.height), 'round').toBeLessThanOrEqual(0.5)
      expect(dot.width, 'at least a reading’s dot').toBeGreaterThanOrEqual(8)
      expect(dot.round).toBe('50%')
      expect(dot.inset, 'no ring around nothing').toBe('none')
      expect(dot.paint, 'in the line’s hue').toBe(drawn.stroke?.paint)
      expect(dot.ring.style, 'ringed').toBe('solid')
      expect(Math.abs(dot.centre.left - end.left), 'at the line’s end across').toBeLessThan(NEAR)
      expect(Math.abs(dot.centre.top - end.top), 'at the line’s end up').toBeLessThan(NEAR)
      await expectBeside(hint, mark, window)
      // The picture without the hint, which stands over the line it names.
      await page.mouse.move(1, 1)
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      await info.attach(
        `forecast-${one.kind}-${one.ends.before ? 'runs-out' : 'lasts'}-${width}.png`,
        {
          body: await window.screenshot(),
          contentType: 'image/png',
        },
      )
    })

test('in a forced palette the line, the fill and the dot are drawn in its ink, the ring in its ground', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  const window = await openWindow(page, { by: 'quota_week', account: NIGHT_NAME, kind: 'week' })
  const { mark } = await pointAtForecast(page, window)
  const drawn = await forecastOf(window)
  const dot = await drawnMark(mark)
  expect([drawn.stroke?.paint, drawn.fill?.paint, dot.paint]).toEqual([dot.ink, dot.ink, dot.ink])
  expect(dot.ring.paint).toBe(dot.ground)
})

test('a week’s bar draws one tail from the fill to the high end; five hours as before', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_week' }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  const bar = (scope: Locator) =>
    scope.evaluate((window) => {
      const box = (selector: string) => window.querySelector(selector)?.getBoundingClientRect()
      const track = box('[data-mark="track"]')
      return {
        tails: [...window.querySelectorAll('[data-mark="ahead"]')].map((tail) => {
          const { left, right } = tail.getBoundingClientRect()
          return { left, right }
        }),
        fill: box('[data-mark="fill"]')?.right ?? null,
        left: track?.left ?? Number.NaN,
        width: track?.width ?? Number.NaN,
        label: window.querySelector('[data-mark="track"]')?.getAttribute('aria-label') ?? '',
      }
    })
  const week = panel.locator('[data-account="Work"] [data-window="week"]')
  const drawn = await bar(week)
  await record(info, 'week-bar', drawn)
  expect(drawn.tails, 'one tail').toHaveLength(1)
  const [tail] = drawn.tails
  const fill = present(drawn.fill, 'the fill')
  expect(
    Math.abs((tail?.left ?? Number.NaN) - fill - GAP),
    'the tail past the fill’s gap',
  ).toBeLessThan(NEAR)
  expect(
    Math.abs((tail?.right ?? Number.NaN) - (drawn.left + (drawn.width * 61.2) / 100)),
    'the tail to the high end',
  ).toBeLessThan(NEAR)
  // The pace tick's meaning, in the bar's words for a screen reader and in its hint.
  expect(drawn.label).toContain('steady use since the window started would be at 57% now')
  const track = week.locator('[data-mark="track"]')
  await track.hover()
  await expect(page.locator('.tooltip-hint')).toContainText(
    'Pace tick · steady use since the window started would be at 57% now',
  )

  // Five hours: «Work»'s from 62 % to the track's end, the unnamed account's from 0 % to 35 %.
  await openPanel(page, pageAt({ by: 'quota_five_hour' }))
  await panel.getByRole('radio', { name: 'Chart' }).check()
  const share = ({ left, width }: { left: number; width: number }, x: number) =>
    Math.round(((x - left) / width) * 100)
  const work = await bar(panel.locator('[data-account="Work"] [data-window="five_hour"]'))
  const night = await bar(panel.locator(`[data-account="${NIGHT_NAME}"] [data-window="five_hour"]`))
  await record(info, 'five-hours-bars', { work, night })
  expect(work.tails.map(({ right }) => share(work, right))).toEqual([100])
  expect(
    Math.abs((work.tails[0]?.left ?? Number.NaN) - present(work.fill, 'fill') - GAP),
  ).toBeLessThan(NEAR)
  expect(night.tails.map(({ left, right }) => [share(night, left), share(night, right)])).toEqual([
    [0, 35],
  ])
})
