/**
 * A cell of a section's table that says in words why its change has no figure — no price
 * before, no tokens in either period, nothing before, an account not known before — says it in
 * the width a figure takes, so the name, the three measures, the period before and the change
 * stand in the table's frame as it opens (`DESIGN.md`, Analytics). The heading over the column
 * names the period it is compared with, so the cell's words need not; the section's tiles say
 * the whole sentence.
 *
 * In the real app over the browser double, at 1280 pixels, whose panel gives a section's table
 * its narrowest frame of a desktop window, every word the table may write in a change cell, in
 * every language, is set into each change cell of the task table of «Today» in turn, under each
 * measure it is said under — a missing price under the cost, missing tokens under the tokens,
 * the rest under all three: the period before is named with its hours, and a cost that leaves
 * tokens without a price says so under its amount, the widest figures the other columns hold.
 * The change must still end inside the frame. Said in whole sentences, «Нет цены ни в одном периоде» made the
 * column 215 pixels wide and put the change 50 pixels past the frame; a translation that long
 * fails here before it does that on a reader's screen. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { PARTLY_PRICED } from './taskTables.ts'
import { test } from './test.ts'

/** The width whose panel gives a section's table its narrowest frame of a desktop window. */
const WIDTH = 1280

/** A share as wide as a change of a figure is likely to be, for the words that hold one. */
const WIDE_SHARE = '12 345 %'

type Measure = 'cost' | 'time' | 'tokens'

/**
 * Every word a change cell may say under `measure`, as the messages of `locale` write it: what
 * it says of a figure absent (`absent`) is said only under the measure that names it.
 */
function changeWords(locale: keyof typeof messages, measure: Measure): string[] {
  const leaves = (node: unknown): string[] =>
    typeof node === 'string' ? [node] : Object.values(node as object).flatMap((one) => leaves(one))
  const { absent, ...rest } = messages[locale].analytics.table.moved
  const said = measure in absent ? absent[measure as keyof typeof absent] : {}
  return [...leaves(rest), ...leaves(said)].map((one) => one.replace('{change}', WIDE_SHARE))
}

/**
 * Sets every change cell of the section's table to `words`, lets the table lay itself out again
 * — its headings may take a second line (`useHeadingLines`) — and answers how far the change's
 * heading ends past the frame's visible end, and how many cells were set.
 */
const changeWith = (page: Page, words: string) =>
  page.evaluate(async (said) => {
    const frame = document.querySelector<HTMLElement>('.spending-table [data-region="table-frame"]')
    const table = frame?.querySelector('table')
    if (!frame || !table) throw new Error('no table')
    const cells = [...table.querySelectorAll<HTMLTableCellElement>('td[data-measure="change"]')]
    // A change without a figure is its words alone, with no remark under them.
    for (const cell of cells) cell.textContent = said
    for (let step = 0; step < 3; step += 1) await new Promise((done) => requestAnimationFrame(done))
    frame.scrollLeft = 0
    const column = cells[0]?.cellIndex ?? -1
    const heading = table.querySelectorAll('thead th')[column]
    const end = frame.getBoundingClientRect().left + frame.clientLeft + frame.clientWidth
    return {
      set: cells.length,
      columns: [...table.querySelectorAll('thead th')].map(
        (one) =>
          `${(one.textContent ?? '').trim()} ${Math.round(one.getBoundingClientRect().width)}`,
      ),
      past: Math.round(((heading?.getBoundingClientRect().right ?? Infinity) - end) * 10) / 10,
    }
  }, words)

for (const locale of ['ru', 'en'] as const)
  test.describe(`in ${locale}`, () => {
    test.use({ locale: locale === 'ru' ? 'ru-RU' : 'en-US' })

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await serve(page, PARTLY_PRICED)
    })

    for (const measure of ['time', 'tokens', 'cost'] satisfies Measure[])
      test(`under ${measure}, every word of a change cell keeps the change in the frame`, async ({
        page,
      }, info) => {
        const words = changeWords(locale, measure)
        // The arrows, the same, nothing before, not known before; and three of an absent figure.
        expect(words, 'the words of a change cell').toHaveLength(measure === 'time' ? 5 : 8)
        await openReport(page, WIDTH, pageAt({ by: 'work_item', period: 'today', measure }))
        await page.evaluate(() => document.fonts.ready)
        const seen: Record<string, unknown> = {}
        for (const said of words) {
          const { set, past, columns } = await changeWith(page, said)
          seen[`${said} columns`] = columns
          // Sixteen tasks and the total.
          expect(set, 'the change cells set').toBe(17)
          seen[said] = past
          expect.soft(past, `«${said}»: the change past the frame`).toBeLessThanOrEqual(0.5)
        }
        await record(info, `change words ${locale} ${measure}`, seen)
      })
  })
