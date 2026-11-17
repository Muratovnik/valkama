/**
 * The hint of a day of the Analytics page's day chart is a grid: the day's name and sum, the day
 * compared with in the quiet ink, a row for each series with its hue, its figure and its bare
 * share, figures and shares each at one right edge and on one line, and what changed under the
 * rows; at 1440 and 1024 pixels. The row of the segment the pointer or the keyboard stands on is
 * marked, and the mark follows it without the hint opening again, moving or changing its size.
 * The hint once ran every fact of the day together in lines of words that wrapped mid-phrase.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { LONG_TAIL, record } from './analyticsPage.ts'
import type { Box } from './dayHintPage.ts'
import {
  dayParts,
  frames,
  hintFrames,
  middleOf,
  openDays,
  placeOf,
  settledHint,
} from './dayHintPage.ts'
import { test } from './test.ts'

/** What a cell of the shown hint's grid says, where it stands and how many lines it takes. */
interface Cell {
  box: Box
  /** Where its first line stands, from its top to its bottom. */
  first: { bottom: number; top: number }
  lines: number
  text: string
}

/**
 * The shown hint's grid, row by row: each row's kind, the series it stands for, its cells, its
 * swatch's hue and whether it is marked; its notes; the hint's box and whether anything in it is
 * cut. With the hue of each segment of day `index`, by series, to compare a swatch with.
 */
const gridOf = (page: Page, index: number) =>
  page.evaluate((at) => {
    const hint = document.querySelector('.tooltip-hint')
    const cell = (element: Element | null | undefined): Cell | null => {
      if (!element) return null
      const range = document.createRange()
      range.selectNodeContents(element)
      const drawn = [...range.getClientRects()]
      const tops = new Set(drawn.map((line) => Math.round(line.top)))
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return {
        text: element.textContent ?? '',
        first: { top: drawn[0]?.top ?? 0, bottom: drawn[0]?.bottom ?? 0 },
        lines: tops.size,
        box: { left, top, right, bottom },
      }
    }
    const rows = [...(hint?.querySelectorAll<HTMLElement>('.tooltip-body-row') ?? [])].map(
      (row) => {
        const swatch = row.querySelector('.tooltip-body-swatch')
        return {
          kind: ['head', 'quiet', 'main'].find((kind) =>
            row.classList.contains(`tooltip-body-${kind}`),
          ),
          series: row.dataset.row ?? null,
          current: row.classList.contains('tooltip-body-current'),
          name: cell(row.querySelector('.tooltip-body-name')),
          figure: cell(row.querySelector('.tooltip-body-figure')),
          share: cell(row.querySelector('.tooltip-body-share')),
          hue: swatch ? getComputedStyle(swatch).backgroundColor : null,
          swatch: swatch?.getBoundingClientRect().toJSON() as DOMRect | undefined,
        }
      },
    )
    const slot = document.querySelectorAll('.spending-days .period-slot')[at]
    // A segment's hue, not its paint: the pointer on its day lifts the paint of every segment,
    // and the hue a mark carries is its fill as well as its background.
    const hues = Object.fromEntries(
      [...(slot?.querySelectorAll<HTMLElement>('.period-segment') ?? [])].map((segment) => [
        segment.dataset.series,
        getComputedStyle(segment).fill,
      ]),
    )
    const { left, top, right, bottom } = hint?.getBoundingClientRect() ?? new DOMRect()
    return {
      rows,
      notes: [...(hint?.querySelectorAll('.tooltip-body-note') ?? [])].map((note) => cell(note)),
      hues,
      box: { left, top, right, bottom },
      cut: !hint || hint.scrollWidth > hint.clientWidth || hint.scrollHeight > hint.clientHeight,
      widest: hint ? getComputedStyle(hint).maxInlineSize : '',
    }
  }, index)

/**
 * The day with the most segments, among days with two or more; with `changed`, among days with an
 * account change.
 */
const dayWithSegments = (page: Page, changed: boolean) =>
  page.evaluate((change) => {
    const slots = [...document.querySelectorAll('.spending-days .period-slot')]
    const counted = slots
      .map((slot, index) => ({
        index,
        changed: slot.querySelector('.period-mark') !== null,
        segments: slot.querySelectorAll('.period-segment').length,
      }))
      .filter((one) => (one.changed || !change) && one.segments > 1)
      .sort((one, other) => other.segments - one.segments)
    return counted[0]?.index ?? -1
  }, changed)

for (const width of [1440, 1024])
  test(`a day's hint is a grid: its name and sum, its series with hue, figure and share in columns, its change under them, at ${width}px`, async ({
    page,
  }, info) => {
    const days = await openDays(page, width)
    const index = await dayWithSegments(page, true)
    expect(index, 'a day with an account change and two series').toBeGreaterThanOrEqual(0)
    const parts = await dayParts(page, index)
    await page.mouse.move(0, 0)
    await expect(page.locator('.tooltip-hint')).toHaveCount(0)
    await page.mouse.move(
      (parts.slot.left + parts.stack.left) / 2,
      middleOf(parts.segments[0] ?? parts.stack).y,
    )
    await settledHint(page)
    const grid = await gridOf(page, index)
    await page
      .locator('.tooltip-hint')
      .screenshot({ path: info.outputPath(`day-grid-${width}.png`) })
    await record(info, `day-grid-${width}`, grid)

    const [head, ...rest] = grid.rows
    expect(head?.kind, 'the head row first').toBe('head')
    expect(head?.figure?.text, 'the head says the sum').toBeTruthy()
    const main = rest.filter((row) => row.kind === 'main')
    expect(main, 'a row for each series of the day').toHaveLength(
      await days.locator('.period-slot').nth(index).locator('.period-segment').count(),
    )
    expect(grid.notes.length, 'the change said under the rows').toBeGreaterThan(0)
    expect(grid.notes.map((note) => note?.text).join(' ')).toContain('Account change:')
    // Figures and shares at one right edge each, on one line each.
    const figures = grid.rows.flatMap((row) => (row.figure ? [row.figure] : []))
    const shares = main.flatMap((row) => (row.share ? [row.share] : []))
    expect(shares, 'a bare share on every series').toHaveLength(main.length)
    for (const share of shares) expect(share.text).toMatch(/^[<>]?\d+\s?%$/u)
    for (const column of [figures, shares]) {
      const edges = column.map((one) => one.box.right)
      expect(Math.max(...edges) - Math.min(...edges), 'one right edge').toBeLessThanOrEqual(1)
      for (const one of column) expect(one.lines, `«${one.text}» on one line`).toBe(1)
    }
    // Each swatch in its segment's hue, as the legend's is, beside its name's first line.
    for (const row of main) {
      expect(row.hue, `${row.series}: a swatch`).toBeTruthy()
      expect(row.hue, `${row.series}: the segment's hue`).toBe(grid.hues[row.series ?? ''])
      const middle = ((row.swatch?.top ?? 0) + (row.swatch?.bottom ?? 0)) / 2
      const line = row.name?.first ?? { top: 0, bottom: 0 }
      const level = Math.abs(middle - (line.top + line.bottom) / 2)
      expect(level, `${row.series}: level with the first line`).toBeLessThanOrEqual(3)
    }
    expect(grid.cut, 'nothing in the hint cut').toBe(false)
    // Beside its stack and over none of it, as the estimate of its width placed it.
    const place = placeOf(grid.box, parts)
    expect(place.side).not.toBe('neither')
    expect(place.covers).toBe(false)
  })

/**
 * The segment of day `index` whose series has the widest name in the shown hint, other than
 * `apart`'s: where it stands and its series. Marked semibold, that name is the one that would
 * widen the hint.
 */
const widestNamed = (page: Page, index: number, apart: string | null) =>
  page.evaluate(
    ({ at, other }) => {
      const width = (element: Element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getBoundingClientRect().width
      }
      const rows = [
        ...document.querySelectorAll<HTMLElement>('.tooltip-hint .tooltip-body-main'),
      ].filter((row) => row.dataset.row !== other)
      const name = (row: HTMLElement) => row.querySelector('.tooltip-body-name')
      const [widest] = rows.sort(
        (one, next) => width(name(next) ?? document.body) - width(name(one) ?? document.body),
      )
      const key = widest?.dataset.row ?? ''
      const slot = document.querySelectorAll('.spending-days .period-slot')[at]
      const segment = slot?.querySelector(`.period-segment[data-series="${CSS.escape(key)}"]`)
      const { left, top, right, bottom } = segment?.getBoundingClientRect() ?? new DOMRect()
      return { key, box: { left, top, right, bottom } }
    },
    { at: index, other: apart },
  )

test('the row of the segment under the pointer is marked, and the mark follows it in the same hint', async ({
  page,
}, info) => {
  // Short names, so the hint is as wide as its words rather than its widest: a marked name that
  // grew semibold would widen it.
  await openDays(page, 1440, LONG_TAIL)
  const index = await dayWithSegments(page, false)
  const parts = await dayParts(page, index)
  expect(parts.segments.length, 'the day holds two segments').toBeGreaterThan(1)
  const [foot = parts.stack] = parts.segments
  const footSeries = await page.evaluate(({ x, y }) => {
    const under = document.elementFromPoint(x, y)?.closest<HTMLElement>('.period-segment')
    return under?.dataset.series ?? null
  }, middleOf(foot))
  const marked = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.tooltip-hint .tooltip-body-current')].map(
        (row) => row.dataset.row ?? null,
      ),
    )
  await page.mouse.move(0, 0)
  await page.mouse.move(middleOf(foot).x, middleOf(foot).y)
  const first = await settledHint(page)
  const onFoot = await marked()
  // On to the segment whose name is the hint's widest: marked semibold, it is held as wide.
  const target = await widestNamed(page, index, footSeries)
  await hintFrames(page)
  await page.mouse.move(middleOf(target.box).x, middleOf(target.box).y, { steps: 4 })
  await expect.poll(marked).toEqual([target.key])
  const second = await settledHint(page)
  await page.mouse.move((parts.slot.left + parts.stack.left) / 2, middleOf(foot).y, { steps: 4 })
  await expect.poll(marked).toEqual([])
  const crossed = await hintFrames(page)
  await record(info, 'day-hint-current', { index, footSeries, target, onFoot, first, second })

  expect(footSeries, 'the foot is a segment').toBeTruthy()
  expect(target.key, 'another series').not.toBe(footSeries)
  expect(onFoot, 'the foot’s series marked').toEqual([footSeries])
  expect(second.id, 'the same hint element').toBe(first.id)
  expect(second.box, 'the same place and size').toEqual(first.box)
  for (const [at, frame] of crossed.entries()) {
    expect(frame, `frame ${at}: one hint`).toHaveLength(1)
    expect(frame[0]?.id, `frame ${at}: the same hint element`).toBe(first.id)
    expect(frame[0]?.box, `frame ${at}: the same place`).toEqual(first.box)
  }
})

test('the row of the segment focus climbs to is marked, and none on the day itself', async ({
  page,
}) => {
  const days = await openDays(page, 1440)
  await days.locator('.period-column[tabindex="0"]').focus()
  await page.keyboard.press('ArrowLeft')
  const focused = page.locator(':focus')
  const first = await settledHint(page)
  const stood: { focus: string | null; marked: (string | null)[] }[] = []
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown']) {
    await page.keyboard.press(key)
    await frames(page)
    stood.push({
      focus: await focused.getAttribute('data-series'),
      marked: await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.tooltip-hint .tooltip-body-current')].map(
          (row) => row.dataset.row ?? null,
        ),
      ),
    })
  }
  const after = await settledHint(page)
  expect(stood.map((one) => one.marked)).toEqual(stood.map((one) => (one.focus ? [one.focus] : [])))
  expect(stood[0]?.focus, 'focus on a segment').toBeTruthy()
  expect(after.id, 'the same hint element').toBe(first.id)
  expect(after.box, 'the same place and size').toEqual(first.box)
})
