/**
 * Every hint of a chart's mark stands at that mark, in the built app on Analytics: a day of the
 * day chart, a column of a small chart and the small chart's name, a ranked row, a sector of a
 * ring, a reading of a quota window and a legend entry, at 1440 and 390 pixels.
 *
 * The oracle is the one rule (`hintPlacement.ts`): the hint's start stands 6 pixels past the mark's
 * right edge, level with its top, or at the top right of a point; mirrored on the left where there
 * is no room on the right, under the mark where there is none over it, over it centred where
 * neither side has room; a legend entry's, a detail, under it from its start. So one corner of the
 * hint, or the middle of its edge over a mark it stands centred on, stands within 6 pixels and the
 * 2 of a border and rounding from a corner, or the middle of the top or bottom edge, of the mark;
 * one the window's edge holds in, as a day's hint of twenty series at 390 pixels is lifted, stands
 * against that edge 6 pixels from the mark across it. It covers no part of the mark, keeps inside
 * the window and stays where it stood while the pointer moves to another spot of the same mark.
 *
 * Before, a column of a small chart had its hint at the top left corner of the small chart's frame,
 * over the columns, and a ranked row's past the ranking's right edge, far from a short bar.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { drawAllLined } from './drawnViews.ts'
import { test } from './test.ts'

/** The room between a hint and its mark (`OFFSET` in `hintPlacement.ts`), and to the window's edge. */
const OFFSET = 6
const EDGE = 8
/** A border's pixel and a pixel of rounding. */
const SLACK = 2
/** Longer than the rest a hint waits for, and the grace it stays after the pointer leaves. */
const PAST_REST = 1000

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

interface Point {
  x: number
  y: number
}

/** A mark found in the page: where it is drawn and the spots inside it the pointer rests on. */
interface Found {
  mark: Box
  spots: Point[]
}

/** How a mark kind is found in the page from the element that carries the hint. */
type Finder = (hinted: Element) => Found | null

/** The points of a box a hint is measured from: its corners and the middles of its top and bottom. */
const pointsOf = (box: Box): Point[] => {
  const middle = (box.left + box.right) / 2
  return [
    { x: box.left, y: box.top },
    { x: middle, y: box.top },
    { x: box.right, y: box.top },
    { x: box.left, y: box.bottom },
    { x: middle, y: box.bottom },
    { x: box.right, y: box.bottom },
  ]
}

/** How far the hint stands from its mark: the nearest of its points to one of the mark's. */
const distance = (hint: Box, mark: Box) =>
  Math.min(
    ...pointsOf(hint).flatMap((one) =>
      pointsOf(mark).map((other) => Math.max(Math.abs(one.x - other.x), Math.abs(one.y - other.y))),
    ),
  )

/** Whether two boxes share more than the pixel a border meets on. */
const covers = (one: Box, other: Box) =>
  Math.min(one.right, other.right) - Math.max(one.left, other.left) > 1 &&
  Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top) > 1

/** How far apart two spans stand along one axis: nothing where they meet or overlap. */
const gapBetween = (from: number, to: number, otherFrom: number, otherTo: number) =>
  Math.max(otherFrom - to, from - otherTo, 0)

/**
 * Whether a hint the window's edge holds in stands at its mark all the same: against the edge it
 * was pushed to, `OFFSET` from the mark across that edge and over the mark's span along it, as a
 * hint taller than the room under a mark's top is lifted, or one under a legend entry at the
 * window's side is moved in.
 */
/** Whether a gap is the hint's `OFFSET`, give or take a border and rounding. */
const near = (gap: number) => Math.abs(gap - OFFSET) <= SLACK

function heldIn(hint: Box, mark: Box, window: { height: number; width: number }) {
  const across = gapBetween(hint.left, hint.right, mark.left, mark.right)
  const down = gapBetween(hint.top, hint.bottom, mark.top, mark.bottom)
  const atSide = hint.left <= EDGE + 1 || hint.right >= window.width - EDGE - 1
  const atFoot = hint.top <= EDGE + 1 || hint.bottom >= window.height - EDGE - 1
  return (
    (atSide && near(down) && across === 0) ||
    (atFoot && near(across) && hint.top <= mark.top && hint.bottom >= mark.top)
  )
}

/** Where the hint stands against its mark, said so a list of failures reads by itself. */
function verdict(hint: Box, mark: Box, window: { height: number; width: number }): string {
  const far = distance(hint, mark) > OFFSET + SLACK && !heldIn(hint, mark, window)
  const faults = [
    far ? `${distance(hint, mark).toFixed(1)}px from it` : '',
    covers(hint, mark) ? 'over it' : '',
    hint.left < EDGE - 1 || hint.right > window.width - EDGE + 1 ? 'out of the window' : '',
  ].filter(Boolean)
  return faults.length ? faults.join(', ') : 'at its mark'
}

const boxOf = (element: Element | null | undefined): Box => {
  const { bottom, left, right, top } = element?.getBoundingClientRect() ?? new DOMRect()
  return { bottom, left, right, top }
}

/** The hint shown now, once it has settled. */
async function shownHint(page: Page): Promise<Box> {
  const hint = page.locator('.tooltip-hint')
  await expect(hint).toBeVisible()
  let last: Box | null = null
  await expect
    .poll(async () => {
      const now = await hint.evaluate(boxOf)
      const settled = last !== null && JSON.stringify(last) === JSON.stringify(now)
      last = now
      return settled
    })
    .toBe(true)
  return last as unknown as Box
}

interface Measured {
  at: string
  first: Box
  mark: Box
  second: Box
  where: string
}

/** A kind of mark: its name in the report, the elements that carry its hints, how it is found. */
interface Marks {
  find: Finder
  hinted: Locator
  name: string
}

/**
 * Rests the pointer on each spot of the marks the hinted elements stand for, from a place with
 * no hint for the first and from the first for the others, and says where each hint stood
 * against its mark; `pick` chooses the marks by their order, a negative one from the last.
 */
async function measure(page: Page, { find, hinted, name }: Marks, pick: number[]) {
  const count = await hinted.count()
  expect(count, `${name}: marks drawn`).toBeGreaterThan(0)
  const window = page.viewportSize() ?? { height: 0, width: 0 }
  const measured: Measured[] = []
  const chosen = [...new Set(pick.map((at) => (at < 0 ? count + at : at)))].filter(
    (at) => at >= 0 && at < count,
  )
  for (const index of chosen) {
    const element = hinted.nth(index)
    await element.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
    const found = await element.evaluate(find)
    if (!found) continue
    const [first, ...others] = found.spots
    if (!first) continue
    await page.mouse.move(2, 2)
    await page.clock.runFor(PAST_REST)
    await page.mouse.move(first.x, first.y)
    await page.clock.runFor(PAST_REST)
    const shown = await shownHint(page)
    for (const spot of others) {
      await page.mouse.move(spot.x, spot.y, { steps: 4 })
      await page.clock.runFor(PAST_REST)
      const moved = await shownHint(page)
      const now = await element.evaluate(find)
      const mark = now?.mark ?? found.mark
      measured.push({
        at: `${name} ${index}`,
        first: shown,
        mark,
        second: moved,
        where: verdict(shown, mark, window),
      })
    }
  }
  return measured
}

/** Expects every hint measured at its mark and still between the spots of the mark. */
async function expectAtMarks(info: TestInfo, label: string, measured: Measured[]) {
  await record(info, label, measured)
  expect(measured.length, `${label}: marks measured`).toBeGreaterThan(0)
  expect(
    measured.filter((one) => one.where !== 'at its mark').map((one) => `${one.at}: ${one.where}`),
    label,
  ).toEqual([])
  for (const one of measured)
    for (const side of ['left', 'top', 'right', 'bottom'] as const)
      expect(
        Math.abs(one.first[side] - one.second[side]),
        `${one.at}: the same ${side} from both spots`,
      ).toBeLessThan(0.6)
}

/* The finders run in the page, so each holds its own helpers. */

/**
 * A day of the day chart: its stack, rested on beside it and over it, its ground. A segment
 * marks its row in the hint in semibold, which can wrap a long name of a narrowed hint onto one
 * more line; that is the row's mark, not the hint's place, so the spots leave the segments alone.
 */
const day: Finder = (hinted) => {
  const slot = hinted.closest('.period-slot')
  const stack = slot?.querySelector('.period-stack')?.getBoundingClientRect()
  const own = slot?.getBoundingClientRect()
  if (!stack || !own || stack.height < 4 || stack.top - own.top < 8) return null
  const middle = (stack.top + stack.bottom) / 2
  return {
    mark: { bottom: stack.bottom, left: stack.left, right: stack.right, top: stack.top },
    spots: [
      { x: (own.left + stack.left) / 2, y: middle },
      { x: (stack.left + stack.right) / 2, y: (own.top + stack.top) / 2 },
    ],
  }
}

/** A column of a small chart: its column, or its floor where it has none; rested on at two heights. */
const column: Finder = (hinted) => {
  const period = hinted.getBoundingClientRect()
  const drawn = hinted.querySelector('.multiple-column')?.getBoundingClientRect()
  const x = (period.left + period.right) / 2
  return {
    mark: drawn
      ? { bottom: drawn.bottom, left: drawn.left, right: drawn.right, top: drawn.top }
      : { bottom: period.bottom, left: period.left, right: period.right, top: period.bottom },
    spots: [
      { x, y: period.bottom - 2 },
      { x, y: period.top + period.height / 3 },
    ],
  }
}

/** A small chart's name, or a legend entry: the element itself, rested on near each end. */
const own: Finder = (hinted) => {
  const box = hinted.getBoundingClientRect()
  const words = hinted.lastElementChild?.getBoundingClientRect() ?? box
  const y = (box.top + box.bottom) / 2
  return {
    mark: { bottom: box.bottom, left: box.left, right: box.right, top: box.top },
    spots: [
      { x: box.left + 3, y },
      { x: Math.min(words.right, box.right) - 3, y },
    ],
  }
}

/** A ranked row: its bar, rested on its name and on its bar. */
const row: Finder = (hinted) => {
  const bar = hinted.querySelector('.ranked-bar')?.getBoundingClientRect()
  const label = hinted.querySelector('.ranked-label')?.getBoundingClientRect()
  if (!bar || !label || bar.width < 4) return null
  return {
    mark: { bottom: bar.bottom, left: bar.left, right: bar.right, top: bar.top },
    spots: [
      { x: label.left + 4, y: (label.top + label.bottom) / 2 },
      { x: (bar.left + bar.right) / 2, y: (bar.top + bar.bottom) / 2 },
    ],
  }
}

/** A reading of a quota window: its mark, rested on its step and on the mark. */
const reading: Finder = (hinted) => {
  const mark = hinted.querySelector('.step-mark')?.getBoundingClientRect()
  const reach = hinted.getBoundingClientRect()
  if (!mark || reach.width < 8) return null
  return {
    mark: { bottom: mark.bottom, left: mark.left, right: mark.right, top: mark.top },
    spots: [
      { x: (mark.left + mark.right) / 2, y: (mark.top + mark.bottom) / 2 },
      { x: Math.min(reach.right - 2, mark.right + 6), y: reach.bottom - 4 },
    ],
  }
}

/**
 * A sector of a ring: the middle of its band, a point, rested on there and a few degrees round
 * the ring on either side where those still fall on the sector.
 */
const sector: Finder = (hinted) => {
  if (!(hinted instanceof SVGGraphicsElement)) return null
  const named = (hinted.dataset.hintPoint ?? '').split(' ').map(Number)
  const matrix = hinted.getScreenCTM()
  const svg = hinted.ownerSVGElement
  if (named.length !== 2 || !matrix || !svg) return null
  const [x = 0, y = 0] = named
  const box = svg.viewBox.baseVal
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const turned = (degrees: number) => {
    const angle = (degrees * Math.PI) / 180
    const dx = x - centre.x
    const dy = y - centre.y
    const point = new DOMPoint(
      centre.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      centre.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    ).matrixTransform(matrix)
    return { x: point.x, y: point.y }
  }
  const point = turned(0)
  const spots = [point, turned(-4), turned(4)].filter(
    (spot) => document.elementFromPoint(spot.x, spot.y) === hinted,
  )
  return {
    mark: { bottom: point.y, left: point.x, right: point.x, top: point.y },
    spots,
  }
}

/** Draws each section that offers `view` («Ring», «Chart») as that, rather than as its table. */
async function showAs(page: Page, view: string) {
  for (const radio of await page.getByRole('radio', { name: view, exact: true }).all())
    if (!(await radio.isChecked()) && (await radio.isVisible())) await radio.click()
}

async function open(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  // The hint's delay runs on this clock, so each hint is read after it.
  await page.clock.install()
  await serve(page)
  await openReport(page, width)
  await drawAllLined(page)
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Goes to a section by its address, on a narrow window from the list of sections, and draws it as
 * `view`.
 */
async function goToSection(page: Page, width: number, { by, view }: { by: string; view: string }) {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(pageAt({ by }))
  const analytics = page.locator('.analytics-page')
  await analytics.locator('.analytics-rail:visible, .analytics-panel:visible').first().waitFor()
  if (!(await analytics.locator('.analytics-panel').isVisible()))
    await analytics.locator('.analytics-rail [aria-current="page"]').click()
  await expect(analytics.locator('.analytics-panel')).toBeVisible()
  await showAs(page, view)
  await page.evaluate(() => document.fonts.ready)
}

for (const width of [1440, 390]) {
  test(`at ${width}px a day's, a ranked row's and a legend entry's hint stand at their marks`, async ({
    page,
  }, info) => {
    await open(page, width)
    const days = page.locator('.spending-days .period-column')
    const rows = page.locator('.spending-bars .ranked-line')
    const keys = page.locator('.spending-days .chart-key')
    await expect(rows.first()).toBeVisible()
    const measured = [
      ...(await measure(page, { name: 'day', hinted: days, find: day }, [0, 1, -1])),
      ...(await measure(page, { name: 'ranked row', hinted: rows, find: row }, [0, 1, 2, -1])),
      ...(await measure(page, { name: 'legend entry', hinted: keys, find: own }, [0, -1])),
    ]
    await expectAtMarks(info, `marks-${width}`, measured)
  })

  test(`at ${width}px a small chart's columns and name have their hints at them`, async ({
    page,
  }, info) => {
    await open(page, width)
    const multiples = page.locator('.spending-multiples')
    await multiples.scrollIntoViewIfNeeded()
    await expect(multiples.locator('.multiple-period').first()).toBeVisible()
    const cells = multiples.locator('.multiple')
    const measured: Measured[] = []
    for (const at of [0, 1, (await cells.count()) - 1]) {
      const cell = cells.nth(at)
      measured.push(
        ...(await measure(
          page,
          { name: `chart ${at} column`, hinted: cell.locator('.multiple-period'), find: column },
          [0, 1, -1],
        )),
        ...(await measure(
          page,
          { name: `chart ${at} name`, hinted: cell.locator('.multiple-name'), find: own },
          [0],
        )),
      )
    }
    await expectAtMarks(info, `multiples-${width}`, measured)
  })

  test(`at ${width}px a ring's sector and a quota reading have their hints at them`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
    await page.clock.install()
    await serve(page)
    await goToSection(page, width, { by: 'effort', view: 'Ring' })
    const sectors = page.locator('.analytics-panel .donut-sector')
    await expect(sectors.first()).toBeVisible()
    const measured = await measure(
      page,
      { name: 'sector', hinted: sectors, find: sector },
      [0, 1, -1],
    )
    await goToSection(page, width, { by: 'quota_five_hour', view: 'Chart' })
    const readings = page.locator('.step-line').first().locator('.step-reach')
    await expect(readings.first()).toBeVisible()
    measured.push(
      ...(await measure(page, { name: 'reading', hinted: readings, find: reading }, [0, 1, -1])),
    )
    await expectAtMarks(info, `points-${width}`, measured)
  })
}
