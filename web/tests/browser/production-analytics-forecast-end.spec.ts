/**
 * The forecast's end in the built app, on the step line and on the bar (`StepLine`, `WindowBar`).
 *
 * On the step line the forecast at the reset is no ring. A week forecasts a range, and while its
 * place is pointed at its mark is a bar at the reset from the range's high end to its low, in the
 * corridor's hue, a forced palette's ink under one; five hours forecast one value, and its mark is
 * a dash at that value. Its hint stands beside the mark and off the line's head. On the bar a
 * week's forecast is one hatched tail from the fill's end, past the gap the fill keeps, to the
 * range's high end, with no gap inside it; five hours draw theirs as before, and the bar's hint and
 * its words for a screen reader say what the pace tick stands for.
 *
 * The quota fixture's windows: «Work»'s week at 41 %, its forecast 56.93 % to 61.2 % by the reset;
 * «Work»'s five hours at 62 %, running out before the reset; the unnamed account's five hours at
 * 0 %, lasting to the reset at 35 %. Each line is shown whole, to its reset, so the mark stands
 * at the forecast's own ends.
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

async function openWindow(page: Page, by: string, account: string, kind: string) {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
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

/** The mark as drawn: its box, its shape's hook and what would make it a ring or a dot. */
const drawnMark = (mark: Locator) =>
  mark.evaluate((element) => {
    const style = getComputedStyle(element)
    const cap = getComputedStyle(element, '::before')
    const probe = document.createElement('i')
    document.body.append(probe)
    probe.style.color = 'CanvasText'
    const ink = getComputedStyle(probe).color
    probe.remove()
    const { top, bottom, left, right, width, height } = element.getBoundingClientRect()
    return {
      shape: (element as HTMLElement).dataset.shape ?? '',
      top,
      bottom,
      left,
      right,
      middle: top + height / 2,
      width,
      height,
      ring: style.boxShadow !== 'none' || style.borderRadius !== '0px',
      paint: style.backgroundColor,
      cap: cap.content === 'none' ? null : { paint: cap.backgroundColor, width: cap.width },
      ink,
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

for (const forcedColors of ['none', 'active'] as const)
  test(`a week's forecast ends in a bar from its high end to its low, no ring (forced colours ${forcedColors})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ forcedColors })
    const window = await openWindow(page, 'quota_week', 'Work', 'week')
    const { mark, hint } = await pointAtForecast(page, window)
    const drawn = await drawnMark(mark)
    const high = await shareAt(window, 61.2)
    const low = await shareAt(window, 56.93)
    await record(info, `week-forecast-end-${forcedColors}`, { drawn, high, low })
    expect(drawn.shape).toBe('range')
    expect(drawn.ring, 'no ring').toBe(false)
    expect(Math.abs(drawn.top - high), 'its top at the high end').toBeLessThan(NEAR)
    expect(Math.abs(drawn.bottom - low), 'its bottom at the low end').toBeLessThan(NEAR)
    // Capped at each end by a stroke as wide as the mark: never a dot, however short the range.
    expect(drawn.cap?.width, 'its caps as wide as a reading’s dot').toBe('8px')
    expect(drawn.cap?.paint, 'its caps in its own paint').toBe(drawn.paint)
    // The corridor's hue, a forced palette's ink under one.
    expect(drawn.paint === drawn.ink, 'drawn in the forced palette’s ink').toBe(
      forcedColors === 'active',
    )
    await expect(hint).toContainText('Forecast by the reset')
    await expectBeside(hint, mark, window)
  })

test('five hours forecast one value, and its end is a dash at that value, no ring', async ({
  page,
}, info) => {
  const window = await openWindow(page, 'quota_five_hour', NIGHT_NAME, 'five_hour')
  const { mark, hint } = await pointAtForecast(page, window)
  const drawn = await drawnMark(mark)
  const value = await shareAt(window, 35)
  await record(info, 'five-hours-forecast-end', { drawn, value })
  expect(drawn.shape).toBe('point')
  expect(drawn.ring, 'no ring').toBe(false)
  expect(drawn.cap, 'no caps: a dash alone').toBeNull()
  expect(Math.abs(drawn.middle - value), 'the dash at its value').toBeLessThan(NEAR)
  // A dash: two pixels tall and wider than a reading's dot.
  expect(drawn.height).toBeCloseTo(2, 0)
  expect(drawn.width, 'wider than a dot').toBeGreaterThan(8)
  await expectBeside(hint, mark, window)
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
