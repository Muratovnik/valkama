/**
 * A day of the Analytics page's day chart gives one hint wherever a pointer stands on it: beside
 * its stack, on a segment, in the 2px of ground between two segments, over the stack and up to the
 * middle of the gap before the next day, where the next day takes over: no point of the gap is
 * neither day's. The browser finds what a point is on in whole pixels, so that middle is held to
 * within a pixel. The hint keeps its element, its words and its place while the pointer crosses
 * the day, and the next day gives its own. Each segment once had a hint of its own and the day
 * another, so every crossing swapped both the words and the place, and the gap between two days
 * belonged to neither.
 *
 * The hint stands beside the day's column — to its right, or to its left where the window has no
 * room there — at the same height for every day, so moving to the next day moves it sideways only,
 * and it covers nothing of the day it speaks for: at 1440 and 1280 pixels and at the narrowest
 * window that opens the days as a plot. The keyboard shows the same hint on the day and on its
 * segments, and it stays put as focus climbs into them and back.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openReport, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/**
 * The narrowest window, in pixels, whose task section opens its days as a plot rather than as
 * their table (`useNarrowCharts`); one pixel less opens the table.
 */
const NARROWEST = 664

const WIDTHS = [1440, 1280, NARROWEST]

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

interface Shown {
  box: Box
  /** Which element the hint is: a new one for each hint the host opened. */
  id: number
  text: string
}

/** Where one day's parts stand, and where the next day's slot does. */
const dayParts = (page: Page, index: number) =>
  page.evaluate((at) => {
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null | undefined): Box => {
      const { left, top, right, bottom } = element?.getBoundingClientRect() ?? new DOMRect()
      return { left, top, right, bottom }
    }
    const days = document.querySelector('.spending-days')
    const slots = [...(days?.querySelectorAll('.period-slot') ?? [])]
    const slot = slots[at]
    return {
      field: box(days?.querySelector('.period-field')),
      slot: box(slot),
      column: box(slot?.querySelector('.period-column')),
      stack: box(slot?.querySelector('.period-stack')),
      // From the foot of the stack up.
      segments: [...(slot?.querySelectorAll('.period-segment') ?? [])]
        .map((segment) => box(segment))
        .sort((low, high) => high.bottom - low.bottom),
      next: box(slots[at + 1]),
    }
  }, index)

type Parts = Awaited<ReturnType<typeof dayParts>>

/**
 * Teaches the page to note every hint it shows — which element it is, the words it shows and
 * its box — and, from then on, to note them every frame, so a hint that swapped for a frame and
 * back is noted too. The words leave out the copy the popup library keeps for a screen reader,
 * which can trail the words on screen by a render.
 */
const noteHints = (page: Page) =>
  page.evaluate(() => {
    const host = window as unknown as { hintFrames?: Shown[][]; hintsNow?: () => Shown[] }
    const ids = new WeakMap<Element, number>()
    let count = 0
    host.hintsNow = () =>
      [...document.querySelectorAll('.tooltip-hint')].map((hint) => {
        if (!ids.has(hint)) {
          count += 1
          ids.set(hint, count)
        }
        const shown = hint.cloneNode(true) as Element
        for (const copy of shown.querySelectorAll('[role="tooltip"]')) copy.remove()
        const { left, top, right, bottom } = hint.getBoundingClientRect()
        return {
          id: ids.get(hint) ?? 0,
          text: shown.textContent ?? '',
          box: { left, top, right, bottom },
        }
      })
    host.hintFrames = []
    const note = () => {
      host.hintFrames?.push(host.hintsNow?.() ?? [])
      requestAnimationFrame(note)
    }
    requestAnimationFrame(note)
  })

/** Every hint shown now (`noteHints`). */
const hintsNow = (page: Page) =>
  page.evaluate(() => (window as unknown as { hintsNow: () => Shown[] }).hintsNow())

/** The hints noted every frame since the last call (`noteHints`). */
const hintFrames = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { hintFrames: Shown[][] }).hintFrames.splice(0) as Shown[][],
  )

/** Two frames, so what the last move asked for is drawn. */
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/** The one hint shown, once it has stood still for two frames. */
async function settledHint(page: Page): Promise<Shown> {
  let last: Shown[] = []
  await expect
    .poll(async () => {
      const shown = await hintsNow(page)
      await frames(page)
      last = await hintsNow(page)
      return last.length === 1 && JSON.stringify(shown) === JSON.stringify(last)
    }, 'one hint, standing still')
    .toBe(true)
  return last[0] as Shown
}

const middleOf = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

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

const overlaps = (one: Box, other: Box) =>
  one.left < other.right &&
  other.left < one.right &&
  one.top < other.bottom &&
  other.top < one.bottom

/** Where a hint stands against the day's column: beside it, and over none of it. */
function placeOf(hint: Box, parts: Parts) {
  const { column, slot, stack } = parts
  let side = 'neither'
  if (hint.left >= column.right) side = 'right'
  else if (hint.right <= column.left) side = 'left'
  return {
    side,
    // Beside means level with the column too, not over the plot or under it.
    level: hint.top < column.bottom && hint.bottom > column.top,
    covers: overlaps(hint, column) || overlaps(hint, slot) || overlaps(hint, stack),
  }
}

/** The days of the task section, drawn as a plot at `width`. */
async function openDays(page: Page, width: number) {
  await serve(page)
  const analytics = await openReport(page, width)
  const days = analytics.locator('.spending-days')
  await expect(days).toHaveAttribute('data-shown', 'chart')
  // The plot in the middle of the window, so a hint has room over and under it.
  await days
    .locator('.period-field')
    .evaluate((field) => field.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await noteHints(page)
  return days
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
      day: placeOf(first.box, parts),
      next: placeOf(next.box, nextParts),
      first: placeOf(opening.box, firstParts),
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
    // The day says each series' share of it.
    expect(first.text).toMatch(/\d+\s?% of the total/u)
    expect(next.id, 'the next day is a hint of its own').not.toBe(first.id)

    for (const [day, where] of Object.entries(place)) {
      expect(where.side, `${day}: beside its column`).not.toBe('neither')
      expect(where.level, `${day}: level with its column`).toBe(true)
      expect(where.covers, `${day}: over none of its day`).toBe(false)
    }
    // The same height for every day: the next day moves the hint sideways only.
    expect(Math.abs(next.box.top - first.box.top), 'the same height').toBeLessThanOrEqual(0.5)
    expect(Math.abs(opening.box.top - first.box.top), 'the same height').toBeLessThanOrEqual(0.5)
    expect(place.first.side, 'the first day: to the right, where there is room').toBe('right')
  })

test(`the narrowest window that draws the days as a plot is ${NARROWEST}px`, async ({ page }) => {
  await openDays(page, NARROWEST)
  const analytics = await openReport(page, NARROWEST - 1)
  await expect(analytics.locator('.spending-days')).toHaveAttribute('data-shown', 'table')
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
  for (const [at, frame] of kept.entries()) {
    expect(frame, `frame ${at}: one hint`).toHaveLength(1)
    expect(frame[0]?.id, `frame ${at}: the same hint element`).toBe(first.id)
    expect(frame[0]?.text, `frame ${at}: the same words`).toBe(first.text)
    expect(frame[0]?.box, `frame ${at}: the same place`).toEqual(first.box)
  }
})
