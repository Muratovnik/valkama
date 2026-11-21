/**
 * The names of the tables a chart is read as (its table twin), in the real app at a phone's width
 * and a laptop's. The oracle is the requirement (`DESIGN.md`, Charts): a twin's name, a row's or a
 * series' over its figures, takes two lines at most, then an ellipsis, whole in its hint, as the
 * side panel's narrow names do. A short name keeps one line and needs no hint. Unbounded, a task's
 * long name in the ranked twin stood on as many lines as its words took on a phone, and the days'
 * twin by task stood its heading row as tall as the longest task's name. Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { WORK_GROUP as WORK } from '../fixtures/quotaSpent.ts'
import { NARROW_FRAME, pageAt, record, serve } from './analyticsPage.ts'
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
