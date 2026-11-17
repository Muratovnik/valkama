/**
 * Every series mark answers the pointer and the keyboard one way, in the real app over the browser
 * double: a ring's sector, a ranked row's bar, a small chart's column, a period's stack and a
 * segment of it lift — the paint of the mark pointed at changes and nothing else does: not its box,
 * not the paint of a mark beside it, which is the control. A ring's legend entry pointed at lifts
 * its sector, a sector reached from the keyboard lifts, and in a forced palette a lifted mark takes
 * the palette's highlight. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { sectorBand } from './ringBand.ts'
import { test } from './test.ts'

/** A mark's paint, `fill` for a drawing's shape and the background for a box, and its box. */
const paintOf = (mark: Locator) =>
  mark.evaluate((element) => {
    const style = getComputedStyle(element)
    const { x, y, width, height } = element.getBoundingClientRect()
    return {
      paint: element instanceof SVGElement ? style.fill : style.backgroundColor,
      box: [x, y, width, height].map((one) => Math.round(one * 100) / 100),
    }
  })

/** A mark's paint alone. */
async function paintNow(mark: Locator) {
  const { paint } = await paintOf(mark)
  return paint
}

/** Where an element stands, which it must: a check on a box that is not laid out checks nothing. */
async function laidOut(element: Locator) {
  const box = await element.boundingBox()
  if (!box) throw new Error('not laid out')
  return box
}

/** A colour as the browser computes the system colour `name` of a forced palette. */
const systemColour = (page: Page, name: string) =>
  page.evaluate((chosen) => {
    const probe = document.createElement('i')
    probe.style.color = chosen
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, name)

/**
 * Points at `target` and reads `mark` and `control` before and while it is pointed at: the mark
 * lifts, its box stays, and the control's paint stays.
 */
async function lift(page: Page, target: Locator, mark: Locator, control: Locator) {
  await page.mouse.move(0, 0)
  const before = { mark: await paintOf(mark), control: await paintOf(control) }
  await target.hover()
  const during = { mark: await paintOf(mark), control: await paintOf(control) }
  await page.mouse.move(0, 0)
  expect(during.mark.paint, 'the mark pointed at lifts').not.toBe(before.mark.paint)
  expect(during.mark.box, 'and keeps its box').toEqual(before.mark.box)
  expect(during.control.paint, 'a mark not pointed at stays').toBe(before.control.paint)
  return { before, during }
}

test('every series mark lifts under the pointer, its box and its neighbours as they were', async ({
  page,
}, info) => {
  await serve(page)
  await openReport(page, 1440, pageAt({ by: 'model' }))
  const analytics = page.locator('.analytics-panel')
  const seen: Record<string, unknown> = {}

  // A ring's sector, and the sector of a legend entry pointed at.
  const ring = analytics.locator('.spending-bars .donut-chart')
  const sectors = ring.locator('.donut-sector')
  await expect(sectors.first()).toBeVisible()
  const band = await sectorBand(sectors.first())
  await page.mouse.move(0, 0)
  const resting = { mark: await paintOf(sectors.first()), control: await paintOf(sectors.nth(1)) }
  // Pointed at in its band: the middle of its box is the ring's hole.
  await page.mouse.move(band.x, band.y)
  const pointed = { mark: await paintOf(sectors.first()), control: await paintOf(sectors.nth(1)) }
  expect(pointed.mark.paint, 'the sector pointed at lifts').not.toBe(resting.mark.paint)
  expect(pointed.mark.box, 'and keeps its box').toEqual(resting.mark.box)
  expect(pointed.control.paint, 'its neighbour stays').toBe(resting.control.paint)
  seen.sector = { resting, pointed }
  seen.legend = await lift(
    page,
    ring.locator('.chart-entry').nth(1),
    sectors.nth(1),
    sectors.first(),
  )

  // A sector reached from the keyboard lifts as well.
  await sectors.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(sectors.nth(1)).toBeFocused()
  const keyed = await paintNow(sectors.nth(1))
  expect(keyed).not.toBe((seen.legend as Awaited<ReturnType<typeof lift>>).before.mark.paint)
  await page.keyboard.press('Escape')
  await analytics.locator('.spending-bars h3').click()

  // A ranked row's bar, the row taking the pointer.
  const bars = analytics.locator('.spending-bars')
  await bars.getByRole('radio', { name: 'Bars', exact: true }).click()
  const rows = bars.locator('.ranked-line')
  seen.bar = await lift(
    page,
    rows.first().locator('.ranked-label'),
    rows.first().locator('.ranked-bar'),
    rows.nth(1).locator('.ranked-bar'),
  )

  // A small chart's column, its period taking the pointer.
  const periods = analytics
    .locator('.spending-multiples .multiple')
    .first()
    .locator('.multiple-period')
  const drawn = periods.filter({ has: page.locator('.multiple-column') })
  seen.multiple = await lift(
    page,
    drawn.first(),
    drawn.first().locator('.multiple-column'),
    drawn.nth(1).locator('.multiple-column'),
  )

  // A period's stack: the period pointed at above its stack lifts every segment of it.
  const days = analytics.locator('.spending-days')
  const slots = days.locator('.period-slot').filter({ has: page.locator('.period-segment') })
  const first = slots.first()
  const column = await laidOut(first.locator('.period-column'))
  await page.mouse.move(0, 0)
  const restingStack = await paintOf(first.locator('.period-segment').first())
  await page.mouse.move(column.x + column.width / 2, column.y + 2)
  const pointedStack = await paintOf(first.locator('.period-segment').first())
  expect(pointedStack.paint).not.toBe(restingStack.paint)
  expect(pointedStack.box).toEqual(restingStack.box)
  seen.stack = { restingStack, pointedStack }
  // A segment pointed at on its own.
  seen.segment = await lift(
    page,
    slots.nth(1).locator('.period-segment').first(),
    slots.nth(1).locator('.period-segment').first(),
    first.locator('.period-segment').first(),
  )
  await record(info, 'mark lift', seen)
})

test('in a forced palette a lifted mark takes the highlight, and a resting one the ink', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await serve(page)
  await openReport(page, 1440, pageAt({ by: 'model' }))
  const ring = page.locator('.analytics-panel .spending-bars .donut-chart')
  const sectors = ring.locator('.donut-sector')
  await expect(sectors.first()).toBeVisible()
  const highlight = await systemColour(page, 'Highlight')
  const ink = await systemColour(page, 'CanvasText')
  await page.mouse.move(0, 0)
  expect(await paintNow(sectors.first())).toBe(ink)
  await ring.locator('.chart-entry').first().hover()
  expect(await paintNow(sectors.first())).toBe(highlight)
  expect(await paintNow(sectors.nth(1))).toBe(ink)
})
