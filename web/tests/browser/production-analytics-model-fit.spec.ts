/**
 * The Model section's table in the real app over the browser double (`DESIGN.md`, Long titles):
 * a model's id is never cut, its column as wide as the longest id and no wider, and where the
 * frame has room for every column on one line no cell wraps — «No tokens», a cost with no price
 * at all and the remark under the total's cost each stand on one line, every row at the row's
 * pitch. On a phone the id stays whole and the table scrolls in its frame.
 *
 * Taking the rest of the frame, the column of names stood at 303 pixels at 1440 for ids of 125,
 * and the figures' words beside it, wrapped always, took three and four lines. Each run prints
 * what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

const at = new Date(2026, 10, 10, 10)

/** Four models: two priced, one with no price at all, one with agent time and no tokens. */
const MODELS: TimedStretch[] = [
  {
    at,
    group: { model: value('claude-sonnet-5-5') },
    spend: { seconds: 7200, tokens: 2_000_000, cost: 30 },
  },
  {
    at,
    group: { model: value('claude-fable-5-1') },
    spend: { seconds: 3600, tokens: 1_000_000, cost: 12 },
  },
  {
    at,
    group: { model: value('gpt-6.2-sol') },
    spend: { seconds: 600, tokens: 201_300, cost: null, unpriced: 201_300 },
  },
  { at, group: { model: value('gpt-6-astra') }, spend: { seconds: 1800 } },
]

/** The table as laid out: its names' column against its ids, rows, words' lines and frame. */
const laidOut = (page: Page) =>
  page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('.spending-table[data-rows="ids"]')
    const table = section?.querySelector('table')
    const frame = table?.parentElement
    if (!section || !table || !frame) throw new Error('no table of ids')
    const range = document.createRange()
    const box = (node: Node) => {
      range.selectNodeContents(node)
      return [...range.getClientRects()].filter((rect) => rect.width > 0)
    }
    const lines = (node: Node) => new Set(box(node).map((rect) => Math.round(rect.top))).size
    const width = (node: Node) => Math.max(0, ...box(node).map((rect) => rect.width))
    const heading = table.querySelector('thead th')
    if (!heading) throw new Error('no heading')
    const style = getComputedStyle(heading)
    const padding =
      Number.parseFloat(style.paddingInlineStart) + Number.parseFloat(style.paddingInlineEnd)
    // The ids as drawn: the words of the press, not the hint laid over them.
    const ids = [...table.querySelectorAll('tbody th .whole-words')]
    const rows = [...table.querySelectorAll('tbody tr')].map(
      (row) => row.getBoundingClientRect().height,
    )
    // The figures' words: a cost's remark, a cost with no price, and a label, «No tokens».
    const words = [
      ...table.querySelectorAll('.figure-words, .figure-remark'),
      ...[...table.querySelectorAll('td > span:first-child')].filter(
        (figure) => !/\d/u.test(figure.textContent ?? ''),
      ),
    ]
    return {
      column: Math.round(heading.getBoundingClientRect().width * 10) / 10,
      longest: Math.round(Math.max(...ids.map((name) => width(name))) * 10) / 10,
      padding,
      cut: [...table.querySelectorAll<HTMLElement>('tbody th .whole-words')].filter(
        (name) => name.scrollWidth > name.clientWidth + 0.5,
      ).length,
      idLines: ids.map((name) => lines(name)),
      rows: rows.map((height) => Math.round(height * 10) / 10),
      words: words.map((one) => `${(one.textContent ?? '').trim()}: ${lines(one)}`),
      scroll: frame.scrollWidth - frame.clientWidth,
    }
  })

for (const locale of ['en', 'ru'] as const)
  test.describe(`in ${locale}`, () => {
    test.use({ locale: locale === 'ru' ? 'ru-RU' : 'en-US' })

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await serve(page, MODELS)
    })

    test('at 1440 the ids’ column is as wide as the longest id, and no cell wraps', async ({
      page,
    }, info) => {
      await openReport(page, 1440, pageAt({ by: 'model' }))
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('.spending-table[data-rows="ids"] tbody tr')).toHaveCount(4)
      const seen = await laidOut(page)
      await record(info, `model fit ${locale} 1440`, seen)
      expect(seen.cut, 'ids cut').toBe(0)
      expect(
        seen.idLines.every((count) => count === 1),
        'each id on one line',
      ).toBe(true)
      expect(seen.column, 'the column against its longest id').toBeLessThanOrEqual(
        seen.longest + seen.padding + 1,
      )
      expect(seen.words.length, 'the words, the labels and the remark').toBeGreaterThanOrEqual(4)
      for (const said of seen.words) expect(said, 'on one line').toMatch(/: 1$/u)
      const pitch = Math.min(...seen.rows)
      expect(Math.max(...seen.rows), 'every row at the pitch').toBeLessThanOrEqual(pitch + 0.5)
      expect(seen.scroll, 'the frame scrolls').toBe(0)
    })

    test('at 390 each id stays whole and on one line', async ({ page }, info) => {
      await openReport(page, 390, pageAt({ by: 'model', open: 'section' }))
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('.spending-table[data-rows="ids"] tbody tr')).toHaveCount(4)
      const seen = await laidOut(page)
      await record(info, `model fit ${locale} 390`, seen)
      expect(seen.cut, 'ids cut').toBe(0)
      expect(
        seen.idLines.every((count) => count === 1),
        'each id on one line',
      ).toBe(true)
    })
  })
