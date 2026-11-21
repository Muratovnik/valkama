/**
 * The names of the tables a chart is read as (its table twin), in the real app at a phone's width
 * and a laptop's. The oracle is the requirement (`DESIGN.md`, Charts): a twin's name, a row's or a
 * series' over its figures, takes two lines at most, then an ellipsis, whole in its hint, as the
 * side panel's narrow names do. A short name keeps one line and needs no hint. Unbounded, a task's
 * long name in the ranked twin stood on as many lines as its words took on a phone, and the days'
 * twin by task stood its heading row as tall as the longest task's name. The whole words laid
 * over a name its clamp cuts take the clamp's column and alignment and wrap where it did, a
 * heading's aligned to its end as well (`DESIGN.md`, the hint of a cut text). Each run prints
 * what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { WORK_GROUP as WORK } from '../fixtures/quotaSpent.ts'
import { NARROW_FRAME, pageAt, record, serve } from './analyticsPage.ts'
import { standing } from './cutFieldPage.ts'
import { drawLined } from './drawnViews.ts'
import { drawnName, letters, rowNamed } from './tableNames.ts'
import { test } from './test.ts'

const said = messages.en.analytics

const on = (day: number) => new Date(2026, 10, day, 10)

/**
 * A task whose title runs close to the longest a title may be (200 letters), past two lines of a
 * twin's name on a phone and on a laptop.
 */
const LONG_TITLE =
  'Keep the period switch beside the measure and hold its words whole on a narrow screen, so ' +
  'that a reader who turns a phone sideways still finds every period with the chosen one in view always'
const LONG_NAME = `MAIN-41 ${LONG_TITLE}`
const SHORT_NAME = 'MAIN-42 Fix'

/** A session of the run, with an id made up for it. */
const session = (index: number) => ({
  id: `${String(index).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`,
  unknown: false,
  family: 'claude',
  opened_in: '',
  opened_host: '',
  title: `Session ${index}`,
})

/** Two tasks this week, the long one first, each spent on three days under its own model. */
const NAMES: TimedStretch[] = [LONG_TITLE, 'Fix'].flatMap((title, index) =>
  [9, 10, 11].map((day) => ({
    at: on(day),
    group: {
      work_item: task(41 + index, title),
      model: value(`model-${41 + index}`),
      executor: session(41 + index),
      ...WORK,
    },
    spend: { seconds: (4 - index) * 1800, tokens: (4 - index) * 10_000, cost: 4 - index },
  })),
)

/** The task section with every chart shown as its table; a narrow window shows the section alone. */
async function openTwins(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  const state: Record<string, string> =
    width < NARROW_FRAME ? { by: 'work_item', open: 'section' } : { by: 'work_item' }
  await page.goto(pageAt(state))
  await drawLined(page.locator('.spending-bars'))
  const tables = page.getByRole('radio', { name: said.shown.table, exact: true })
  const count = await tables.count()
  expect(count, 'charts that offer their table').toBeGreaterThanOrEqual(2)
  for (let index = 0; index < count; index += 1) await tables.nth(index).click()
  await page.evaluate(() => document.fonts.ready)
  return page.locator('[data-shown="table"]').getByRole('table')
}

/** The lines a heading's words show inside its cell, read from their letters' line boxes. */
function headingLines(cell: Locator) {
  return cell.evaluate((th) => {
    const box = th.getBoundingClientRect()
    const range = document.createRange()
    const tops = new Set<number>()
    let shown = ''
    const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null)
      for (let at = 0; at < node.length; at += 1) {
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const rect = [...range.getClientRects()].find((one) => one.width > 0)
        if (!rect || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) continue
        tops.add(Math.round(rect.top))
        shown += node.data[at]
      }
    return { lines: tops.size, shown }
  })
}

for (const width of [390, 1024])
  test(`at ${width}px a twin's long task name takes two lines, whole in its hint, and a short one one line`, async ({
    page,
  }, info) => {
    await serve(page, NAMES)
    const twins = await openTwins(page, width)
    const hint = page.locator('[data-hint-surface]')

    // The ranked twin: a row a task, its name heading the row.
    const ranked = twins.filter({ has: page.getByRole('rowheader', { name: LONG_NAME }) })
    await expect(ranked).toHaveCount(1)
    const long = await drawnName(rowNamed(ranked, LONG_NAME))
    const short = await drawnName(rowNamed(ranked, SHORT_NAME))
    expect(long.lines, 'the long name on two lines').toBe(2)
    expect(
      letters(long.shown).startsWith(letters('MAIN-41 Keep the')),
      `shown: ${long.shown}`,
    ).toBe(true)
    expect(letters(long.shown).length, 'the long name cut').toBeLessThan(letters(LONG_NAME).length)
    expect(short.lines, 'the short name on one line').toBe(1)
    expect(letters(short.shown)).toBe(letters(SHORT_NAME))
    // The short one first: the long name's hint lays it whole over its lines, which on a phone
    // reaches over the rows under it.
    await ranked.getByRole('link', { name: SHORT_NAME }).hover()
    await expect(hint).toHaveCount(0)
    await ranked.getByRole('link', { name: LONG_NAME }).hover()
    await expect(hint).toHaveText(LONG_NAME)

    // The days' twin: a column a task, its name over the column's figures.
    const days = twins.filter({ has: page.getByRole('columnheader', { name: LONG_NAME }) })
    await expect(days).toHaveCount(1)
    const longHead = days.getByRole('columnheader', { name: LONG_NAME })
    const shortHead = days.getByRole('columnheader', { name: SHORT_NAME })
    const heading = await headingLines(longHead)
    const shortHeading = await headingLines(shortHead)
    expect(heading.lines, 'the long heading on two lines').toBe(2)
    expect(letters(heading.shown).length, 'the long heading cut').toBeLessThan(
      letters(LONG_NAME).length,
    )
    expect(shortHeading.lines, 'the short heading on one line').toBe(1)
    await longHead.hover()
    await expect(hint).toHaveText(LONG_NAME)

    await record(info, `twin names ${width}`, { long, short, heading, shortHeading })
  })

/**
 * The lines `element` draws, each as the letters it holds, read from their line boxes, with the
 * content box it draws them in and its alignment. A line its own box cuts away, as a clamp's
 * third, is left out.
 */
const linesOf = (element: Locator) =>
  element.evaluate((box: HTMLElement) => {
    const style = getComputedStyle(box)
    const edges = box.getBoundingClientRect()
    const inset = (side: 'Left' | 'Right' | 'Top' | 'Bottom') =>
      Number.parseFloat(style[`padding${side}`]) + Number.parseFloat(style[`border${side}Width`])
    const content = {
      left: edges.left + inset('Left'),
      right: edges.right - inset('Right'),
      top: edges.top + inset('Top'),
      bottom: edges.bottom - inset('Bottom'),
    }
    const range = document.createRange()
    const lines = new Map<number, string>()
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null)
      for (let at = 0; at < node.length; at += 1) {
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const rect = [...range.getClientRects()].find((one) => one.width > 0)
        if (!rect || rect.bottom > content.bottom + 1) continue
        const top = Math.round(rect.top)
        lines.set(top, (lines.get(top) ?? '') + node.data.charAt(at))
      }
    return {
      align: style.textAlign,
      content,
      lines: [...lines.keys()].sort((one, other) => one - other).map((top) => lines.get(top) ?? ''),
    }
  })

/**
 * The pieces of `lines` that are no word of `text`: a word a line's end cut in two. The piece
 * an ellipsis ends, where a clamp cuts its last line, is no break.
 */
const brokenWords = (lines: readonly string[], text: string) => {
  const words = new Set(text.split(' '))
  return lines.flatMap((line) =>
    line
      .trim()
      .split(' ')
      .filter((piece) => piece !== '' && !piece.endsWith('…') && !words.has(piece)),
  )
}

/**
 * Eight tasks this week, the long one first, each spent on three days: the days' twin has a
 * column for each, so each heading stands at its least width, a few words a line.
 */
const HEADS: TimedStretch[] = [
  LONG_TITLE,
  'Read the attached store an older build wrote',
  'Name every scope the read had to skip',
  'Keep the outcome preview inside the window',
  'Say which build can still open a store',
  'Hold the rail open while a panel slides in',
  'Draw the quota meter at the width of its label',
  'Let the finder choose with the arrows and Enter',
].flatMap((title, index) =>
  [9, 10, 11].map((day) => ({
    at: on(day),
    group: {
      work_item: task(41 + index, title),
      model: value(`model-${41 + index}`),
      executor: session(41 + index),
      ...WORK,
    },
    spend: { seconds: (9 - index) * 1800, tokens: (9 - index) * 10_000, cost: 9 - index },
  })),
)

// The days' twin heads each task's column with its name, its lines aligned to the column's end
// over the figures. Laid from the cut name's first letter, which stands inside the column, the
// whole words took the room from that letter to the column's end: narrower than the clamp, they
// broke words the clamp kept whole and left the clamp's second line showing beside them.
for (const width of [1440, 1024])
  test(`at ${width}px the whole words over a days' twin heading, aligned to its end, take its column and wrap where it did`, async ({
    page,
  }, info) => {
    await serve(page, HEADS)
    const twins = await openTwins(page, width)
    const days = twins.filter({ has: page.getByRole('columnheader', { name: LONG_NAME }) })
    await expect(days).toHaveCount(1)
    const clamp = days
      .getByRole('columnheader', { name: LONG_NAME })
      .locator('[data-tooltip-kind="clipped"]')
    await expect(clamp).toHaveCount(1)
    // Near the top of a tall window, where the room under it takes all the whole words' lines,
    // so they stand where they are laid rather than raised.
    await page.setViewportSize({ width, height: 1400 })
    await clamp.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    const cut = await linesOf(clamp)
    expect(cut.align, 'the heading aligned to its end').toMatch(/^(end|right)$/u)
    expect(cut.content.right - cut.content.left, 'a heading at its least width').toBeLessThan(120)
    expect(cut.lines, 'the lines the clamp shows').toHaveLength(2)
    expect(brokenWords(cut.lines, LONG_NAME), 'words the clamp breaks').toEqual([])
    // Its first line ends at the column's end, so its first letter stands inside the column.
    const letter = await clamp.evaluate((element: HTMLElement) => {
      element.dataset.probeCut = ''
      const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode() as Text
      const at = text.data.search(/\S/u)
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 1)
      const { left, top, width: wide, height } = range.getBoundingClientRect()
      return { left, top, width: wide, height }
    })
    expect(letter.left - cut.content.left, 'the first letter inside the column').toBeGreaterThan(4)

    await page.mouse.move(letter.left + letter.width / 2, letter.top + letter.height / 2)
    const laid = page.locator('.whole-text')
    await expect(laid).toHaveText(LONG_NAME)
    await expect.poll(() => standing(page)).toBe('on its text')
    const whole = await linesOf(laid)
    const columns = {
      clamp: cut.content.right - cut.content.left,
      whole: whole.content.right - whole.content.left,
    }
    await record(info, `heading whole words ${width}`, { cut, whole, columns })
    // Its lines take the clamp's column at the clamp's alignment, so they wrap where the clamp
    // did: the first line is the clamp's, and the words run on down past the second.
    expect(
      Math.abs(whole.content.left - cut.content.left),
      'the column’s start',
    ).toBeLessThanOrEqual(0.5)
    expect(Math.abs(columns.whole - columns.clamp), 'the column’s width').toBeLessThanOrEqual(0.5)
    expect(whole.lines.length, 'the lines the whole words take').toBeGreaterThan(2)
    expect(whole.lines[0], 'the first line, the clamp’s').toBe(cut.lines[0])
    expect(brokenWords(whole.lines, LONG_NAME), 'words the whole words break').toEqual([])
  })
