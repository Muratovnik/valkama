/**
 * Where the Analytics filter stands, composed as the Work bar composes its own (DESIGN.md, «Facet
 * filter» and the bar's filter): its field on the bar's line takes the room the line leaves, and
 * the chips stand in a row of their own under the line, «Clear filters» at its end.
 *
 * At 1440 and 1920px, beside a week and beside a span of days, in either language: the field is
 * as wide with none to four filters set, and wider than its words need; each filter is a chip,
 * whole, under the line, four short ones on one row; with no filter there is no row, and the row
 * that comes with the first filter is the one thing that makes the bar taller, by its own height
 * and the bar's 8px gap, the panel moving down by as much. On a phone the row stands right under
 * the field's, and the room of the reader's own days, which every period keeps, under it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openPanel, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** The room between the bar's line and the row of its chips, `--space-2` (DESIGN.md). */
const BAR_GAP = 8
/** What the field's words, «Add a filter», need at the least: 11rem at the root's 16px. */
const FIELD_WORDS = 11 * 16

/** Filters of none to four values, each a chip. */
const CHIPS: Record<string, string[]>[] = [
  {},
  { model: ['model-a'] },
  { model: ['model-a', 'model-b'] },
  { project: ['alpha'], model: ['model-a', 'model-b'] },
  { project: ['alpha', 'beta'], model: ['model-a', 'model-b'] },
]
const CUSTOM = { period: 'custom', from: '2026-11-09', to: '2026-11-11' }

const countOf = (filters: Record<string, string[]>) => Object.values(filters).flat().length

/**
 * Opens the page at `width` with its filters and period, the bar's words and room settled. A
 * filter the week holds nothing for leaves the report empty, which the bar does not mind.
 */
async function openWith(
  page: Page,
  width: number,
  filters: Record<string, string[]>,
  period: Record<string, string> = {},
) {
  const address = countOf(filters) ? { ...period, filters: JSON.stringify(filters) } : period
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt(address))
  await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
}

/**
 * The bar's height, where the panel under it starts, the field's box, and the chips: how many, on
 * how many rows, their row's box, and whether each stands whole in the bar, under the field.
 */
const barState = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const bar = box('.analytics-bar')
    const row = box('.analytics-bar-chips')
    const field = box('.analytics-filter-add')
    const chips = [...document.querySelectorAll('.analytics-bar-chips [data-filter-chip]')]
    const tops = chips.map((chip) => chip.getBoundingClientRect().top)
    const names = chips.map((chip) => chip.querySelector('.filter-chip-name'))
    return {
      bar: Math.round(bar?.height ?? 0),
      panel: Math.round(box('.analytics-panel')?.y ?? 0),
      field: Math.round(field?.width ?? 0),
      fieldBottom: field?.bottom ?? Number.NaN,
      chips: chips.length,
      rows: new Set(tops.map((top) => Math.round(top))).size,
      row: Math.round(row?.height ?? 0),
      rowTop: row?.top ?? Number.NaN,
      rowBottom: row?.bottom ?? Number.NaN,
      own: box('.period-bar-own')?.top ?? null,
      placed:
        tops.every((top) => top >= (field?.bottom ?? Number.POSITIVE_INFINITY)) &&
        chips.every((chip) => chip.getBoundingClientRect().right <= (bar?.right ?? 0) + 0.5) &&
        names.every((name) => name !== null && name.scrollWidth <= name.clientWidth),
    }
  })

type BarState = Awaited<ReturnType<typeof barState>>

for (const lang of ['en', 'ru'] as const)
  test.describe(`the filter's row, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1440, 1920])
      test(`the field takes the line's room and the chips a row of their own at ${width}px`, async ({
        page,
      }, info) => {
        await serve(page)
        const seen: Record<string, BarState> = {}
        for (const period of [{} as Record<string, string>, CUSTOM]) {
          const kind = period.period ?? 'week'
          for (const filters of CHIPS) {
            const count = countOf(filters)
            await openWith(page, width, filters, period)
            const now = await barState(page)
            const name = `${kind} ${count}`
            seen[name] = now
            // Each filter is a chip, whole and under the line; four short ones stand on one row.
            expect(now.chips, `the chips, ${name}`).toBe(count)
            expect(now.placed, `a chip cut or beside the line, ${name}`).toBe(true)
            expect(now.rows, `the chips' rows, ${name}`).toBe(count ? 1 : 0)
          }
          const none = seen[`${kind} 0`]
          // With no filter there is no row of chips, and the bar is its line.
          expect(none?.row, `the chips' row, ${kind} 0`).toBe(0)
          expect(none?.field ?? 0, `the field, ${kind}`).toBeGreaterThan(FIELD_WORDS)
          for (const filters of CHIPS.slice(1)) {
            const name = `${kind} ${countOf(filters)}`
            const state = seen[name]
            expect(state?.field, `the field's width, ${name}`).toBe(none?.field)
            // The row of chips is the one thing that makes the bar taller, by itself and the gap.
            const grown = (state?.row ?? Number.NaN) + BAR_GAP
            expect(state?.bar, `the bar's height, ${name}`).toBe((none?.bar ?? 0) + grown)
            expect(state?.panel, `the panel's top, ${name}`).toBe((none?.panel ?? 0) + grown)
          }
        }
        await record(info, `filter-row ${lang} ${width}`, seen)
      })
  })

test('on a phone the chips stand right under the field, the room of the days under them', async ({
  page,
}, info) => {
  await serve(page)
  const filters = { model: ['model-a'] }
  await openWith(page, 390, {})
  const none = await barState(page)
  await openWith(page, 390, filters)
  const week = await barState(page)
  await openWith(page, 390, filters, CUSTOM)
  const own = await barState(page)
  await record(info, 'filter-row 390', { none, week, own })
  expect(none.row, 'no row of chips with no filter').toBe(0)
  for (const [name, state] of Object.entries({ week, own })) {
    expect(state.chips, name).toBe(1)
    expect(state.placed, `${name}: the chip cut or beside the line`).toBe(true)
    // Right under the field, by the gap of the bar's rows.
    expect(state.rowTop - state.fieldBottom, `${name}: the chips under the field`).toBeCloseTo(
      BAR_GAP,
      0,
    )
  }
  // The days stand under the chips, and their room is kept whatever period is chosen.
  expect(own.own ?? Number.NaN, 'the days under the chips').toBeGreaterThanOrEqual(own.rowBottom)
  expect(own.bar, 'the bar beside a span of days').toBe(week.bar)
})
