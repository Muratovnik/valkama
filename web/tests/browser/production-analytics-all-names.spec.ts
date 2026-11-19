/**
 * The names of the side panel's table of every value, in the real app at the widths it is used
 * at. The oracle is the requirement (`DESIGN.md`, Charts): a table row is one line, save the side
 * panel's table of values named by free text, tasks and sessions, whose names take two lines at
 * most, as a ranked list does in a narrow place: the reference and the start of the title stand
 * together, an ellipsis ends the second line, and the hint says the name whole. A short name keeps
 * one line, a model's name keeps one line there, a session's detail takes a line of its own under
 * its name, and the section's own table keeps every name on one line. The row's figures stand on
 * the name's first line, every cell of the row on one baseline. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { WORK_GROUP as WORK } from '../fixtures/quotaSpent.ts'
import { NARROW_FRAME, pageAt, record, serve } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'

const said = messages.en.analytics

const on = (day: number) => new Date(2026, 10, day, 10)

/** A task whose title runs to a sentence, far past two lines of the panel's name column. */
const LONG_TITLE =
  'Keep the period switch beside the measure and hold its words whole on a narrow screen'
const LONG_NAME = `MAIN-41 ${LONG_TITLE}`
const SHORT_NAME = 'MAIN-42 Fix'
/** A model's name of one long run, which would break inside if its row could wrap. */
const LONG_MODEL = 'model-with-a-name-long-enough-to-run-past-its-column'
const LONG_SESSION =
  'Draw the quota window with its forecast and the restarts it has seen this week'

/** A session of the panel's table: its title, and an id made up for the run. */
const session = (index: number, title: string) => ({
  id: `${String(index).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`,
  unknown: false,
  family: 'claude',
  opened_in: '',
  opened_host: '',
  title,
})

/**
 * Thirteen tasks this week, so every section lists twelve and leaves the rest to «All 13»: the
 * long one first, then the short one and eleven more, each under a model and a session of its
 * own. The long task's model and session have the long names.
 */
const NAMES: TimedStretch[] = Array.from({ length: 13 }, (_, index) => {
  const number = 41 + index
  const title = [LONG_TITLE, 'Fix'][index] ?? `Task ${number}`
  return {
    at: on(9 + (index % 3)),
    group: {
      work_item: task(number, title),
      model: value(index === 0 ? LONG_MODEL : `model-${number}`),
      executor: session(number, index === 0 ? LONG_SESSION : `Session ${number}`),
      ...WORK,
    },
    spend: { seconds: (20 - index) * 600, tokens: (20 - index) * 10_000, cost: 20 - index },
  }
})

/** Words of the app's messages with their placeholders filled. */
function fill(words: string, values: Record<string, string>) {
  let filled = words
  for (const [key, one] of Object.entries(values)) filled = filled.replace(`{${key}}`, one)
  return filled
}

/** The page at a section, its ranked list drawn; a narrow window shows the section alone. */
async function openSection(page: Page, width: number, by: UsageDimension) {
  await page.setViewportSize({ width, height: 900 })
  const state: Record<string, string> = width < NARROW_FRAME ? { by, open: 'section' } : { by }
  await page.goto(pageAt(state))
  const bars = page.locator('.spending-bars')
  await drawLined(bars)
  await page.evaluate(() => document.fonts.ready)
  return bars
}

/** The table of the side panel of every value of the section, opened by «All 13», at rest. */
async function openEvery(page: Page, bars: Locator, by: UsageDimension) {
  await bars.locator('[data-all]').click()
  const name = fill(said.detail.label, {
    title: fill(said.detail.all.title, { dimension: said.dimensions[by] }),
  })
  const panel = page.getByRole('dialog', { name })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveCSS('transform', 'none')
  return panel.locator('[data-detail="all"]').getByRole('table')
}

/**
 * A row's name as drawn: the lines its words show and their text, read from the line boxes of
 * each letter inside the box that holds them (the press, or the name's cell); the lines a detail
 * after it shows; and the baseline of the name's first line beside the baseline of each figure,
 * read from an empty box set before each one's first letter, whose bottom stands on the baseline.
 */
function drawnName(row: Locator) {
  return row.evaluate((tr) => {
    const cells = [...tr.children] as HTMLElement[]
    const [name, ...figures] = cells
    if (!name) throw new Error('a row with no cells')
    const holder = name.querySelector<HTMLElement>('a, button') ?? name
    // This body is serialized and evaluated in the page, so a module-scope helper would not be in
    // scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const texts = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const found: Text[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.textContent?.trim()) found.push(node as Text)
      return found
    }
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const inside = (rect: DOMRect, box: DOMRect) =>
      rect.top >= box.top - 1 &&
      rect.bottom <= box.bottom + 1 &&
      rect.left >= box.left - 1 &&
      rect.right <= box.right + 1
    /** The letters of `nodes` drawn inside `box`, and the lines they stand on. */
    const shownIn = (nodes: Text[], box: DOMRect) => {
      const range = document.createRange()
      const tops = new Set<number>()
      let shown = ''
      let top = Infinity
      for (const node of nodes)
        for (let at = 0; at < node.length; at += 1) {
          range.setStart(node, at)
          range.setEnd(node, at + 1)
          const rect = [...range.getClientRects()].find((one) => one.width > 0)
          if (!rect || !inside(rect, box)) continue
          tops.add(Math.round(rect.top))
          top = Math.min(top, rect.top)
          shown += node.data[at]
        }
      return { lines: tops.size, shown, top }
    }
    const baseline = (root: Element) => {
      const [first] = texts(root)
      if (!first?.parentNode) throw new Error('a cell with no text')
      const mark = document.createElement('span')
      mark.style.cssText = 'display:inline-block;inline-size:0;block-size:0'
      first.parentNode.insertBefore(mark, first)
      const at = mark.getBoundingClientRect().bottom
      mark.remove()
      return at
    }
    const nameBox = holder.getBoundingClientRect()
    const words = shownIn(texts(holder), nameBox)
    // What the cell says past its press: a session's detail.
    const after = texts(name).filter((node) => !holder.contains(node))
    const detail = after.length ? shownIn(after, name.getBoundingClientRect()) : null
    const edges = cells.map((cell) => cell.getBoundingClientRect())
    return {
      ...words,
      whole: holder.textContent ?? '',
      height: Math.round(nameBox.height * 100) / 100,
      nameBottom: Math.round(nameBox.bottom),
      detail,
      nameBaseline: baseline(holder),
      figureBaselines: figures.map((cell) => baseline(cell)),
      tops: edges.map((edge) => Math.round(edge.top * 100) / 100),
      bottoms: edges.map((edge) => Math.round(edge.bottom * 100) / 100),
    }
  })
}

type Drawn = Awaited<ReturnType<typeof drawnName>>

/**
 * A text's letters without its spaces: a space a line breaks at is drawn with no width, and one
 * between two parts of a name stands outside both, so what is read off the screen has none.
 */
const letters = (text: string) => text.replaceAll(/\s/gu, '')

/** Every figure on the name's first baseline, and every cell of the row as tall as the row. */
function expectOneBaseline(drawn: Drawn, what: string) {
  expect(drawn.figureBaselines.length, `${what}: its figures`).toBeGreaterThan(0)
  for (const [index, at] of drawn.figureBaselines.entries())
    expect(
      Math.abs(at - drawn.nameBaseline),
      `${what}: figure ${index + 1} on the name's first line`,
    ).toBeLessThanOrEqual(1)
  expect(drawn.tops.length, `${what}: its cells`).toBeGreaterThan(1)
  for (const top of drawn.tops)
    expect(Math.abs(top - (drawn.tops[0] ?? 0)), `${what}: cell tops`).toBeLessThanOrEqual(1)
  for (const bottom of drawn.bottoms)
    expect(Math.abs(bottom - (drawn.bottoms[0] ?? 0)), `${what}: cell bottoms`).toBeLessThanOrEqual(
      1,
    )
}

/** The row of the table whose name holds `name`. */
const rowNamed = (table: Locator, name: string) =>
  table
    .locator('tbody')
    .getByRole('row')
    .filter({ has: table.page().getByRole('rowheader', { name, exact: true }) })

for (const width of [1440, 1024])
  test(`at ${width}px a task's name takes two lines in the panel's table of every value, a short one one line, the figures on its first line, and the section's table keeps one line`, async ({
    page,
  }, info) => {
    await serve(page, NAMES)
    const bars = await openSection(page, width, 'work_item')

    // The section's own table: every name on one line.
    const section = page.locator('[data-rows]').getByRole('table')
    const sectionLong = await drawnName(rowNamed(section, LONG_NAME))
    const sectionShort = await drawnName(rowNamed(section, SHORT_NAME))
    expect(sectionLong.lines, "the section's long name").toBe(1)
    expect(sectionShort.lines, "the section's short name").toBe(1)

    const table = await openEvery(page, bars, 'work_item')
    await expect(table.locator('tbody').getByRole('row')).toHaveCount(13)
    const long = await drawnName(rowNamed(table, LONG_NAME))
    const short = await drawnName(rowNamed(table, SHORT_NAME))

    expect(long.lines, 'the long name on two lines').toBe(2)
    // Its reference and the start of its title stand, and the rest is cut.
    expect(
      letters(long.shown).startsWith(letters('MAIN-41 Keep the')),
      `shown: ${long.shown}`,
    ).toBe(true)
    expect(letters(long.shown).length, 'the long name cut').toBeLessThan(letters(LONG_NAME).length)
    expect(long.whole).toBe(LONG_NAME)
    expect(short.lines, 'the short name on one line').toBe(1)
    expect(letters(short.shown)).toBe(letters(SHORT_NAME))
    expect(Math.abs(long.height - short.height * 2), 'two lines are twice one').toBeLessThanOrEqual(
      1,
    )
    expectOneBaseline(long, 'the long row')
    expectOneBaseline(short, 'the short row')

    // The hint says the long name whole, laid over its lines; the short one, whole on screen, has
    // none. Either surface a hint is drawn on counts.
    const hint = page.locator('[data-hint-surface]')
    await table.getByRole('link', { name: LONG_NAME }).hover()
    await expect(hint).toHaveText(LONG_NAME)
    await table.getByRole('link', { name: SHORT_NAME }).hover()
    await expect(hint).toHaveCount(0)

    await record(info, `every value's names ${width}`, {
      section: { sectionLong, sectionShort },
      long,
      short,
    })
  })

for (const width of [1440, 1024])
  test(`at ${width}px in the panel's table of every value a session's name takes two lines with its detail on a line of its own, and a model's name keeps one line`, async ({
    page,
  }, info) => {
    await serve(page, NAMES)
    const sessions = await openSection(page, width, 'executor')
    const sessionTable = await openEvery(page, sessions, 'executor')
    const row = sessionTable
      .locator('tbody')
      .getByRole('row')
      .filter({ hasText: 'Draw the quota window' })
    await expect(row).toHaveCount(1)
    const longSession = await drawnName(row)
    expect(longSession.lines, "the session's long name on two lines").toBe(2)
    expect(letters(longSession.shown).startsWith(letters('Draw the')), longSession.shown).toBe(true)
    expect(longSession.detail?.lines, 'its detail on one line').toBe(1)
    // The client and the start of the id, cut at the column's end where it is narrower.
    expect(letters(longSession.detail?.shown ?? '')).toMatch(/^claude·0{4}/u)
    expect(longSession.detail?.top ?? 0, 'its detail under the name').toBeGreaterThanOrEqual(
      longSession.nameBottom - 1,
    )
    expectOneBaseline(longSession, "the long session's row")

    const models = await openSection(page, width, 'model')
    const modelTable = await openEvery(page, models, 'model')
    const longModel = await drawnName(rowNamed(modelTable, LONG_MODEL))
    expect(longModel.lines, "the model's long name on one line").toBe(1)
    expect(longModel.shown.length, "the model's long name cut").toBeLessThan(LONG_MODEL.length)
    expectOneBaseline(longModel, "the long model's row")

    await record(info, `every value's sessions and models ${width}`, { longSession, longModel })
  })
