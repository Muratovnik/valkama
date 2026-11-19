/**
 * A day of the Analytics page's day chart gives one hint wherever a pointer stands on it: beside
 * its stack, on a segment, in the 2px of ground between two segments, over the stack and up to the
 * middle of the gap before the next day, where the next day takes over: no point of the gap is
 * neither day's. The browser finds what a point is on in whole pixels, so that middle is held to
 * within a pixel. The hint keeps its element, its words and its place while the pointer crosses
 * the day, and the next day gives its own words in the same element, placed beside its own column.
 * Each segment once had a hint of its own and the day
 * another, so every crossing swapped both the words and the place, and the gap between two days
 * belonged to neither.
 *
 * The hint stands beside the day's stack, the column drawn, 6 pixels from its edge — to its
 * right, or to its left where the chart's frame has no room there — with its top level with the
 * stack's, so it moves with the stack from one day to the next and covers nothing of it: at 1440
 * and 1280 pixels and at the narrowest window that opens the days as a plot. At 360 pixels, where
 * the plot is chosen over the table, it stands beside the stack where the window holds it, else
 * over the stack, 6 pixels over its top. It never runs out of the window. Beside the day's slot, the
 * whole place the pointer takes for it, a day of a two-day chart had its hint at the plot's top
 * some 300 pixels from its stack. Along four weeks of days it stays inside the chart's frame
 * and on the right up to the days past which the right has no room, then on the left: its side
 * changes once, at 1440 pixels, where the chart fits its frame, and at 1024, where it scrolls.
 * Each day once chose by its own hint's width, so the side jumped from one day to the next. The keyboard shows the same hint on the day and on its
 * segments, and it stays put as focus climbs into them and back.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openReport, pageAt, record } from './analyticsPage.ts'
import type { Parts, Shown } from './dayHintPage.ts'
import {
  dayParts,
  dayWithIdleSegment,
  frames,
  hintFrames,
  hintsNow,
  middleOf,
  openDays,
  pastTheDelay,
  placeOf,
  settledHint,
} from './dayHintPage.ts'
import { test } from './test.ts'

/**
 * The narrowest window, in pixels, whose task section opens its days as a plot rather than as
 * their table (`useNarrowCharts`); one pixel less opens the table.
 */
const NARROWEST = 664

/** The room between a hint and the stack it stands against (`OFFSET` in `hintPlacement.ts`). */
const OFFSET = 6

const WIDTHS = [1440, 1280, NARROWEST]

/**
 * Which day each point across the gap between day `index` and the next one is, from a pixel
 * inside this day to a pixel inside the next, a tenth of a pixel apart at the plot's middle
 * height: `0` this day, `1` the next, `null` neither. The browser finds what a point is on in
 * whole pixels, so where one day gives way to the next is said to within a pixel.
 */
const gapOwners = (page: Page, index: number) =>
  page.evaluate((at) => {
    const days = document.querySelector('.spending-days')
    const slots = [...(days?.querySelectorAll('.period-slot') ?? [])]
    const [mine, next] = [slots[at], slots[at + 1]]
    const field = days?.querySelector('.period-field')?.getBoundingClientRect()
    if (!mine || !next || !field) return []
    const [from, to] = [mine.getBoundingClientRect().right, next.getBoundingClientRect().left]
    const y = (field.top + field.bottom) / 2
    const points: { day: number | null; gap: boolean; x: number }[] = []
    for (let x = from - 1; x < to + 1; x += 0.1) {
      const slot = document.elementFromPoint(x, y)?.closest('.period-slot')
      const day = slot ? [mine, next].indexOf(slot) : -1
      points.push({ x, day: day === -1 ? null : day, gap: x > from && x < to })
    }
    return points
  }, index)

/** The points of one day a pointer crosses, after it has come to rest beside the stack. */
function crossing(parts: Parts, gapEnd: number) {
  const { field, stack, segments } = parts
  const [foot, upper] = segments
  if (!foot || !upper) throw new Error('the day holds fewer than two segments')
  const across = (stack.left + stack.right) / 2
  return [
    { name: 'into a segment', x: across, y: middleOf(foot).y },
    { name: 'through the gap between two segments', x: across, y: (foot.top + upper.bottom) / 2 },
    { name: 'into the next segment', x: across, y: middleOf(upper).y },
    { name: 'out of the top of the stack', x: across, y: (field.top + stack.top) / 2 },
    { name: 'to its edge in the gap before the next day', x: gapEnd, y: middleOf(field).y },
  ]
}

/**
 * Where a day's hint stands against its stack: on which side, how far from it — from its edge on
 * that side, or from its top where the hint stands over it — how far its top stands from the
 * stack's where it stands beside it, and whether it stays inside the window `width` wide.
 */
function besideStack(hint: Shown['box'], parts: Parts, width: number) {
  const place = placeOf(hint, parts)
  const over = place.side === 'neither'
  return {
    ...place,
    gap: over ? parts.stack.top - hint.bottom : place.apart,
    level: over ? 0 : place.below,
    inside: hint.left >= 0 && hint.right <= width,
  }
}

/** The day to cross: one with room over its stack, and a day after it. */
async function dayToCross(page: Page, days: Locator) {
  const count = await days.locator('.period-slot').count()
  let best = { index: 0, room: -1 }
  for (let index = 0; index < count - 1; index += 1) {
    const parts = await dayParts(page, index)
    const room = parts.stack.top - parts.field.top
    if (parts.segments.length > 1 && room > best.room) best = { index, room }
  }
  return best.index
}

for (const width of WIDTHS)
  test(`a day gives one hint across all of it and the next day its own, beside each, at ${width}px`, async ({
    page,
  }, info) => {
    const days = await openDays(page, width)
    const index = await dayToCross(page, days)
    const parts = await dayParts(page, index)
    const [foot, upper] = parts.segments
    expect(foot && upper, 'the day holds two segments').toBeTruthy()
    expect(parts.stack.left - parts.slot.left, 'room beside the stack').toBeGreaterThan(4)
    expect((foot?.top ?? 0) - (upper?.bottom ?? 0), 'ground between the segments').toBeGreaterThan(
      1,
    )
    expect(parts.stack.top - parts.field.top, 'room over the stack').toBeGreaterThan(4)
    // No strip between two days points at nothing: the gap is this day's, then the next one's,
    // turning over within a pixel of its middle.
    const gap = await gapOwners(page, index)
    const middle = (parts.slot.right + parts.next.left) / 2
    const turn = gap.find((point) => point.day === 1)?.x ?? Number.POSITIVE_INFINITY
    // The farthest point toward the next day that is still this day's.
    const edge = gap.findLast((point) => point.day === 0 && point.x < turn)
    expect(gap.filter((point) => point.gap).length, 'points of the gap').toBeGreaterThan(10)
    expect(
      gap.filter((point) => point.day === null),
      'points of no day',
    ).toEqual([])
    expect(
      gap.filter((point) => point.x > turn && point.day === 0),
      'in order',
    ).toEqual([])
    // A pixel, and the tenth of one between two points sampled.
    expect(Math.abs(turn - middle), 'one day gives way at the middle').toBeLessThanOrEqual(1.1)
    expect(edge, 'a point of this day').toBeDefined()

    // At rest beside the stack, in the day's own ground: its hint, after the delay.
    await page.mouse.move(0, 0)
    await expect(page.locator('.tooltip-hint')).toHaveCount(0)
    await page.mouse.move((parts.slot.left + parts.stack.left) / 2, middleOf(foot ?? parts.stack).y)
    const first = await settledHint(page)
    await hintFrames(page)
    const walked: { hints: Shown[]; name: string; under: string }[] = []
    for (const point of crossing(parts, edge?.x ?? parts.slot.right)) {
      await page.mouse.move(point.x, point.y, { steps: 4 })
      await frames(page)
      const under = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.className ?? '',
        point,
      )
      walked.push({ name: point.name, under, hints: await hintsNow(page) })
    }
    const crossed = await hintFrames(page)

    // Into the next day: its own hint, at once, since one was up.
    const nextAt = middleOf(parts.next)
    await page.mouse.move(nextAt.x, (parts.field.top + parts.field.bottom) / 2, { steps: 4 })
    await expect
      .poll(async () => {
        const shown = await hintsNow(page)
        return shown.map((one) => one.text)
      })
      .not.toEqual([first.text])
    const next = await settledHint(page)
    const nextParts = await dayParts(page, index + 1)
    // The first day, with the plot's width on its right: its hint stands there.
    const firstParts = await dayParts(page, 0)
    await page.mouse.move(middleOf(firstParts.column).x, firstParts.field.top + 2, { steps: 4 })
    await expect
      .poll(async () => {
        const shown = await hintsNow(page)
        return shown.map((one) => one.text)
      })
      .not.toEqual([next.text])
    const opening = await settledHint(page)
    const place = {
      day: besideStack(first.box, parts, width),
      next: besideStack(next.box, nextParts, width),
      first: besideStack(opening.box, firstParts, width),
    }
    await record(info, `day-hint-${width}`, {
      index,
      parts,
      gap,
      first,
      walked,
      next,
      opening,
      place,
    })

    for (const [at, frame] of crossed.entries()) {
      expect(frame, `frame ${at}: one hint`).toHaveLength(1)
      expect(frame[0]?.id, `frame ${at}: the same hint element`).toBe(first.id)
      expect(frame[0]?.text, `frame ${at}: the same words`).toBe(first.text)
      expect(frame[0]?.box, `frame ${at}: the same place`).toEqual(first.box)
    }
    for (const step of walked) {
      expect(
        step.hints.map((one) => one.text),
        step.name,
      ).toEqual([first.text])
      expect(step.hints[0]?.box, step.name).toEqual(first.box)
    }
    expect(crossed.length, 'frames noted while crossing').toBeGreaterThan(0)
    // The day says each series' share of it, bare in the share column of its grid.
    expect(first.text).toMatch(/\d+\s?%/u)
    expect(next.text, 'the next day says its own words').not.toBe(first.text)

    for (const [day, where] of Object.entries(place)) {
      expect(where.side, `${day}: beside its stack`).not.toBe('neither')
      expect(where.covers, `${day}: over none of its stack`).toBe(false)
      expect(Math.abs(where.gap - OFFSET), `${day}: ${OFFSET}px from its stack`).toBeLessThan(1)
      expect(Math.abs(where.level), `${day}: level with its stack's top`).toBeLessThan(1)
      expect(where.inside, `${day}: inside the window`).toBe(true)
    }
    expect(place.first.side, 'the first day: to the right, where there is room').toBe('right')
  })

test('in a window 360px wide a day’s hint stands beside its stack or over it, inside the window', async ({
  page,
}, info) => {
  const width = 360
  const days = await openDays(page, width)
  const count = await days.locator('.period-slot').count()
  const placed: ReturnType<typeof besideStack>[] = []
  for (let index = 0; index < count; index += 1) {
    const parts = await dayParts(page, index)
    await page.mouse.move(0, 0)
    await expect(page.locator('.tooltip-hint')).toHaveCount(0)
    await page.mouse.move(middleOf(parts.column).x, parts.field.top + 2, { steps: 4 })
    const shown = await settledHint(page)
    placed.push(besideStack(shown.box, parts, width))
  }
  await record(info, 'day-hint-360', placed)
  expect(placed.length, 'days pointed at').toBeGreaterThan(1)
  // Beside its stack where the window holds 12rem there, else over it, 6px over its top; a hint
  // taller than the window's room under the stack's top is lifted inside the window.
  for (const [index, where] of placed.entries()) {
    expect(where.covers, `day ${index}: over none of its stack`).toBe(false)
    expect(Math.abs(where.gap - OFFSET), `day ${index}: ${OFFSET}px from it`).toBeLessThan(1)
    expect(where.inside, `day ${index}: inside the window`).toBe(true)
  }
})

/** Four weeks of the task section: twenty-eight days. */
const WEEKS = pageAt({ period: 'weeks4', by: 'work_item' })

for (const [width, scrolls] of [
  [1440, false],
  [1024, true],
] as const)
  test(`passing along four weeks of days, the hint changes its side once, inside the chart, at ${width}px`, async ({
    page,
  }, info) => {
    const days = await openDays(page, width, undefined, WEEKS)
    await expect(days.locator('.period-slot'), 'four weeks of days').toHaveCount(28)
    const frame = await days.locator('.period-frame').evaluate((node) => {
      const { left, right } = node.getBoundingClientRect()
      return { left, right, scrolls: node.scrollWidth > node.clientWidth }
    })
    // The days inside the frame: one the chart has scrolled out of it is not passed.
    const inside = await days.locator('.period-column').evaluateAll(
      (columns, { left, right }) =>
        columns.flatMap((column, index) => {
          const box = column.getBoundingClientRect()
          return box.left >= left && box.right <= right ? [index] : []
        }),
      frame,
    )
    const texts = async () => {
      const shown = await hintsNow(page)
      return shown.map((one) => one.text)
    }
    await page.mouse.move(0, 0)
    const passed: { box: Shown['box']; index: number; side: string }[] = []
    let before: string[] = []
    for (const index of inside) {
      const parts = await dayParts(page, index)
      await page.mouse.move(middleOf(parts.column).x, parts.field.top + 2, { steps: 4 })
      await expect.poll(texts, `day ${index}: its own hint`).not.toEqual(before)
      const shown = await settledHint(page)
      before = [shown.text]
      passed.push({ index, box: shown.box, side: placeOf(shown.box, parts).side })
    }
    await record(info, `day-hint-sides-${width}`, { frame, passed })

    expect(frame.scrolls, 'the chart scrolls in its frame').toBe(scrolls)
    expect(passed.length, 'days passed').toBeGreaterThan(20)
    const sides = passed.map((one) => one.side)
    expect(sides[0], 'the first day: to the right').toBe('right')
    expect(
      sides.filter((side) => side === 'neither'),
      'beside its day',
    ).toEqual([])
    expect(
      sides.filter((side, at) => at > 0 && side !== sides[at - 1]),
      `one change of side along ${sides.join(' ')}`,
    ).toEqual(['left'])
    for (const { box, index } of passed) {
      expect(box.left, `day ${index}: inside the chart's frame`).toBeGreaterThanOrEqual(
        frame.left - 0.5,
      )
      expect(box.right, `day ${index}: inside the chart's frame`).toBeLessThanOrEqual(
        frame.right + 0.5,
      )
    }
  })

test(`the narrowest window that draws the days as a plot is ${NARROWEST}px`, async ({ page }) => {
  await openDays(page, NARROWEST)
  const analytics = await openReport(page, NARROWEST - 1)
  await expect(analytics.locator('.spending-days')).toHaveAttribute('data-shown', 'table')
})

// The host opens a hint once per element until the pointer leaves it, and a day is one element
// for it: a press closed the hint, and the rest of the day then showed none until the pointer left.
test('after a press closes the day’s hint, another part of the day asks for it again', async ({
  page,
}, info) => {
  await openDays(page, 1440)
  const day = await dayWithIdleSegment(page)
  const idle = middleOf(day.idle)
  await page.mouse.move(0, 0)
  await page.mouse.move(idle.x, idle.y)
  const before = await settledHint(page)

  // A press on what does nothing closes the hint, and resting there, even moving a little on
  // what it pressed, past the delay, brings none back.
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.locator('.tooltip-hint')).toHaveCount(0)
  await hintFrames(page)
  await page.mouse.move(idle.x + 1, idle.y + 1)
  await pastTheDelay(page)
  const rested = await hintFrames(page)

  // Onto another segment of the same day: its hint again.
  const other = middleOf(day.other)
  await page.mouse.move(other.x, other.y, { steps: 4 })
  const again = await settledHint(page)

  // Pressed once more, then onto the day's ground beside its stack: its hint again too.
  await page.mouse.move(idle.x, idle.y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.locator('.tooltip-hint')).toHaveCount(0)
  await page.mouse.move((day.slot.left + day.stack.left) / 2, idle.y, { steps: 4 })
  const ground = await settledHint(page)
  await record(info, 'day-hint-after-press', { day, before, rested, again, ground })

  expect(
    rested.filter((frame) => frame.length > 0),
    'no hint while resting on what was pressed',
  ).toEqual([])
  expect(again.text, 'another segment: the day’s hint').toBe(before.text)
  expect(ground.text, 'the day’s ground: the day’s hint').toBe(before.text)
})

test('focus on a day and on its segments shows the day’s one hint, and it stays put', async ({
  page,
}, info) => {
  const days = await openDays(page, 1440)
  // The latest day is the chart's stop; an arrow brings the focus to the day before it.
  await days.locator('.period-column[tabindex="0"]').focus()
  await page.keyboard.press('ArrowLeft')
  const focused = page.locator(':focus')
  await expect(focused).toHaveAttribute('data-cell', '1:')
  const first = await settledHint(page)
  await hintFrames(page)
  const stood: { cell: string | null; hints: Shown[] }[] = []
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown']) {
    await page.keyboard.press(key)
    await frames(page)
    stood.push({ cell: await focused.getAttribute('data-cell'), hints: await hintsNow(page) })
  }
  const kept = await hintFrames(page)
  await record(info, 'day-hint-focus', { first, stood })

  expect(stood.map((one) => one.cell)).toEqual(['1:0', '1:1', '1:0', '1:'])
  // Two frames at the least after each of the four keys (`frames`).
  expect(kept.length, 'the frames noted').toBeGreaterThanOrEqual(8)
  for (const [at, frame] of kept.entries()) {
    expect(frame, `frame ${at}: one hint`).toHaveLength(1)
    expect(frame[0]?.id, `frame ${at}: the same hint element`).toBe(first.id)
    expect(frame[0]?.text, `frame ${at}: the same words`).toBe(first.text)
    expect(frame[0]?.box, `frame ${at}: the same place`).toEqual(first.box)
  }
})
