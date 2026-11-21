/**
 * The hint of a reading on the step line of a quota window, in the built app, at 1440, 1280 and
 * 360 pixels: it stands at the top right of the reading's mark, its bottom left corner 6 pixels
 * past the mark's right edge and over its top, as a chart's hint stands at the point pointed at;
 * at the top left, mirrored, where the line's frame has no room for it on the right; and under
 * the mark where the window has no room over it, which the panel here, under the page's bar,
 * never leaves (`ui-charts-window.spec.ts` sets a mark at the window's top). It never runs out of
 * the window. It stood under
 * the plot, from the reading's moment on, over the moments named under it.
 *
 * Every part of a mark takes the pointer for its own reading: its middle, its left half over the
 * step before it and its lower half, which a reading at 0 % sets on the floor. The plot keeps the
 * marks at 0 % and at its top inside its box, and the line at 0 % on its floor and no lower. The
 * marks once stood half out of the plot at 0 %, where the pointer found no reading.
 *
 * A reading whose mark stands within a mark's reach of a place's — the latest, two minutes before
 * «now» — is found as that place, whose hint says the share at its moment (`DESIGN.md`, the step
 * line: a place before any reading); the keyboard and the table still reach it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openPanel, pageAt, record, serve } from './analyticsPage.ts'
import { HIT, shareOf } from './stepAhead.ts'
import { test } from './test.ts'

/** The room between a hint and what it stands against (`OFFSET` in `hintPlacement.ts`). */
const OFFSET = 6

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/** Opens the five hours' panel drawn as charts, as a reader chooses them on a narrow page too. */
async function openFiveHours(page: Page, width: number) {
  await serve(page)
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_five_hour' }))
  const panel = page.locator('.quota-panel')
  await expect(panel.locator('.quota-account')).toHaveCount(4)
  await panel.getByRole('radio', { name: 'Chart' }).check()
  await expect(panel.locator('.step-line')).toHaveCount(3)
  await page.evaluate(() => document.fonts.ready)
}

/** Each reading of a line, by its place: its mark, its reach's words and the line's boxes. */
const readingAt = (line: Locator, index: number) =>
  line.evaluate(
    (figure, [at = 0, reach = HIT]) => {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- runs in the page
      const box = (element: Element | null | undefined): Box => {
        const { left, top, right, bottom } = element?.getBoundingClientRect() ?? new DOMRect()
        return { left, top, right, bottom }
      }
      const mark = box(figure.querySelectorAll('.step-mark')[at])
      const middle = (mark.left + mark.right) / 2
      // Whether a place's mark stands within a mark's reach of this one, which the pointer finds.
      const nearPlace = [...figure.querySelectorAll('[data-target] [data-mark="place"]')].some(
        (place) => {
          const { left, right } = place.getBoundingClientRect()
          return Math.abs((left + right) / 2 - middle) <= reach
        },
      )
      return {
        words: figure.querySelectorAll('.step-reach')[at]?.getAttribute('aria-label') ?? '',
        mark,
        nearPlace,
        field: box(figure.querySelector('.step-field')),
        frame: box(figure),
      }
    },
    [index, HIT],
  )

/**
 * The one hint shown, once it stands still for two frames, with what it says: a grid's copy for
 * assistive technology, else its words; null where none shows.
 */
async function hintNow(page: Page) {
  const read = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.tooltip-hint')].map((hint) => {
        const { left, top, right, bottom } = hint.getBoundingClientRect()
        const said = hint.querySelector('[role="tooltip"]') ?? hint
        return { text: said.textContent ?? '', box: { left, top, right, bottom } }
      }),
    )
  let last: Awaited<ReturnType<typeof read>> = []
  await expect
    .poll(
      async () => {
        const before = await read()
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        )
        last = await read()
        return last.length === 1 && JSON.stringify(before) === JSON.stringify(last)
      },
      { message: 'one hint, standing still', timeout: 3000 },
    )
    .toBe(true)
  return last[0] ?? null
}

/** Points at `x, y` from a place with no hint, and reads the hint that shows. */
async function pointAt(page: Page, x: number, y: number) {
  await page.mouse.move(1, 1)
  await expect(page.locator('.tooltip-hint')).toHaveCount(0)
  await page.mouse.move(x, y, { steps: 2 })
  return hintNow(page)
}

/** Where a hint stands against a mark: the corner it stands at and how far from each edge. */
function cornerOf(hint: Box, mark: Box) {
  let side = 'neither'
  if (hint.left >= mark.right) side = 'right'
  else if (hint.right <= mark.left) side = 'left'
  let level = 'neither'
  if (hint.bottom <= mark.top) level = 'over'
  else if (hint.top >= mark.bottom) level = 'under'
  return {
    side,
    level,
    across: side === 'right' ? hint.left - mark.right : mark.left - hint.right,
    down: level === 'over' ? mark.top - hint.bottom : hint.top - mark.bottom,
  }
}

const middleOf = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

/**
 * Whether reading `index` of `line` keeps its mark inside the plot, and which parts of the mark
 * show no hint of the reading when pointed at: its middle, and a third of its height down and left
 * of it, in its lower half and its left half.
 */
async function reachOf(page: Page, line: Locator, index: number) {
  const { mark, field, words, nearPlace } = await readingAt(line, index)
  const inside =
    mark.top >= field.top - 0.5 &&
    mark.bottom <= field.bottom + 0.5 &&
    mark.left >= field.left - 0.5
  const middle = middleOf(mark)
  const reach = (mark.bottom - mark.top) * 0.3
  const missed: string[] = []
  for (const [part, x, y] of [
    ['its middle', middle.x, middle.y],
    ['its lower half', middle.x, middle.y + reach],
    ['its left half', middle.x - reach, middle.y],
  ] as const) {
    const hint = await pointAt(page, x, y).catch(() => null)
    // Beside a place, the place's hint, which says the reading's share.
    const found = nearPlace ? hint?.text.includes(shareOf(words)) : hint?.text === words
    if (!found) missed.push(`${words}: ${part} showed ${hint?.text ?? 'none'}`)
  }
  return { outside: inside ? [] : [`${words}: ${JSON.stringify({ mark, field })}`], missed }
}

for (const width of [1440, 1280, 360])
  test(`a reading's hint stands at the top right of its mark, or the top left, inside the window, at ${width}px`, async ({
    page,
  }, info) => {
    await openFiveHours(page, width)
    const viewport = { width, height: 1000 }
    const placed: unknown[] = []
    const beside: unknown[] = []
    const sides = new Set<string>()
    for (const line of await page.locator('.quota-window .step-line').all()) {
      await line.evaluate((figure) => figure.scrollIntoView({ block: 'center' }))
      const count = await line.locator('.step-reach').count()
      const readings = await Promise.all(
        Array.from({ length: count }, async (_, index) => ({
          index,
          ...(await readingAt(line, index)),
        })),
      )
      // A reading within a mark's reach of a place is found as the place, which says its share.
      for (const { mark, words } of readings.filter(({ nearPlace }) => nearPlace)) {
        const at = middleOf(mark)
        const hint = await pointAt(page, at.x, at.y)
        beside.push({ words, hint: hint?.text })
        expect(hint?.text, `${words}: the place beside it says its share`).toContain(shareOf(words))
      }
      for (const { index } of readings.filter(({ nearPlace }) => !nearPlace)) {
        const before = await readingAt(line, index)
        const at = middleOf(before.mark)
        const hint = await pointAt(page, at.x, at.y)
        // The mark as it is drawn while it is pointed at, larger.
        const { mark, frame, words } = await readingAt(line, index)
        const corner = cornerOf(hint?.box ?? mark, mark)
        const width = (hint?.box.right ?? 0) - (hint?.box.left ?? 0)
        const height = (hint?.box.bottom ?? 0) - (hint?.box.top ?? 0)
        placed.push({ words, mark, frame, hint, corner })
        sides.add(corner.side)
        expect(hint?.text, `${words}: its own hint`).toBe(words)
        // On the right where the line's frame holds it, else on the left: by the mark as it is
        // drawn under the pointer, larger, and the hint as wide as it is drawn.
        const room = frame.right - mark.right - OFFSET - width
        expect(corner.side, `${words}: the side, ${room}px to spare`).toBe(
          room >= 0 ? 'right' : 'left',
        )
        // Over the mark where the window holds it, else under it.
        expect(corner.level, `${words}: over or under`).toBe(
          mark.top - OFFSET - height >= 8 ? 'over' : 'under',
        )
        expect(Math.abs(corner.across - OFFSET), `${words}: ${OFFSET}px across`).toBeLessThan(1)
        expect(Math.abs(corner.down - OFFSET), `${words}: ${OFFSET}px down`).toBeLessThan(1)
        expect(hint?.box.left, `${words}: inside the window`).toBeGreaterThanOrEqual(0)
        expect(hint?.box.right, `${words}: inside the window`).toBeLessThanOrEqual(viewport.width)
      }
    }
    await record(info, `reading-hint-${width}`, { placed, beside })
    // Every reading counts, whether its own hint or the place beside it answered.
    expect(placed.length + beside.length, 'readings pointed at').toBeGreaterThanOrEqual(6)
    expect(sides.has('right'), 'a reading with room on its right').toBe(true)
  })

test('every part of a mark takes the pointer for its reading, and the marks stand inside the plot', async ({
  page,
}, info) => {
  await openFiveHours(page, 1440)
  const missed: string[] = []
  const outside: string[] = []
  const floors: { floor: number; lowest: number }[] = []
  // The three windows of five hours that have readings, each a step line (`StepLine`).
  const lines = page.locator('[data-window] [data-chart="steps"]')
  await expect(lines).toHaveCount(3)
  const readings: number[] = []
  for (const line of await lines.all()) {
    await line.evaluate((figure) => figure.scrollIntoView({ block: 'center' }))
    const count = await line.locator('[data-reading]').count()
    readings.push(count)
    for (let index = 0; index < count; index += 1) {
      const reading = await reachOf(page, line, index)
      outside.push(...reading.outside)
      missed.push(...reading.missed)
    }
    // The line's lowest point and the floor it stands on, in the window.
    floors.push(
      await line.evaluate((figure) => {
        // The floor is the drawing's foot, where 0 % stands; the line is its readings' path.
        const floor = figure.querySelector('[data-region="drawing"]')?.getBoundingClientRect()
        const path = figure.querySelector('[data-mark="line"]')?.getBoundingClientRect()
        return { floor: floor?.bottom ?? 0, lowest: path?.bottom ?? 0 }
      }),
    )
  }
  await record(info, 'reading-reach', { missed, outside, floors, readings })
  // Every line has its readings to point at.
  expect(
    readings.filter((count) => count === 0),
    'a line with no readings',
  ).toEqual([])
  expect(missed, 'a part of a mark that shows no hint of its reading').toEqual([])
  expect(outside, 'a mark out of the plot').toEqual([])
  for (const { floor, lowest } of floors)
    expect(lowest, 'the line on its floor or over it').toBeLessThanOrEqual(floor + 0.5)
})

/**
 * Points at each reading of `line` that is no place's, and reads the side its hint took against
 * the side its room asks for: the line's frame past the mark as it is drawn pointed at, larger,
 * less the hint as wide as it is drawn. The room is how far it was from either side.
 */
async function sidesOn(page: Page, line: Locator) {
  const count = await line.locator('.step-reach').count()
  const read: { asked: string; room: number; side: string; words: string }[] = []
  for (let index = 0; index < count; index += 1) {
    const before = await readingAt(line, index)
    const at = middleOf(before.mark)
    const hint = before.nearPlace ? null : await pointAt(page, at.x, at.y)
    if (!hint) continue
    const { mark, frame, words } = await readingAt(line, index)
    const room = frame.right - mark.right - OFFSET - (hint.box.right - hint.box.left)
    const side = cornerOf(hint.box, mark).side
    read.push({ words, room, side, asked: room >= 0 ? 'right' : 'left' })
  }
  return read
}

test("a reading's hint takes its side by the mark as it is drawn pointed at, at every phone's width", async ({
  page,
}, info) => {
  // Across these widths a reading's room on the right passes zero: the side was once taken by
  // the mark before the pointer drew it larger and by a width measured without the tabular
  // figures the hint is drawn in, and a hint stood 2.4px out of its line's frame on the right.
  await openFiveHours(page, 400)
  const read: (Awaited<ReturnType<typeof sidesOn>>[number] & { width: number })[] = []
  for (let width = 400; width >= 330; width -= 2) {
    await page.setViewportSize({ width, height: 1000 })
    for (const line of await page.locator('.quota-window .step-line').all()) {
      await line.evaluate((figure) => figure.scrollIntoView({ block: 'center' }))
      const sides = await sidesOn(page, line)
      read.push(...sides.map((one) => ({ ...one, width })))
    }
  }
  const wrong = read.filter(({ side, asked }) => side !== asked)
  const near = Math.min(...read.map(({ room }) => Math.abs(room)))
  await record(info, 'reading-hint-phones', { wrong, near })
  // The widths hold a reading whose room is within the few pixels the side once missed by.
  expect(near, 'the least room to spare').toBeLessThan(3)
  expect(wrong, 'readings on the wrong side').toEqual([])
})
