/**
 * The words the Analytics page holds to one line are whole wherever something beside them can
 * still give way: the figures of the three cells, beside their trends, and the names on the rail,
 * beside their counts. The figures are as long as a month of a busy workstation writes them. The
 * line that counts a section table's rows is whole in every measure, and the heading row over the
 * table stands the same whichever measure is chosen.
 *
 * Each is measured by the width its text takes laid out whole against its box (`shortfalls`):
 * a cut by a third of a pixel costs a figure its last characters to the ellipsis as surely as one
 * by thirty, and `scrollWidth`, in whole pixels, saw none of them.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { LONG_FIGURES, openReport, pageAt, record, serve, shortfalls } from './analyticsPage.ts'
import { test } from './test.ts'

const WIDTHS = [390, 1024, 1280, 1440, 1920]

/** Every period the bar offers, the custom one as a span of days the figures fall in. */
const PERIODS: Record<string, string>[] = [
  { period: 'now' },
  { period: 'today' },
  { period: 'week' },
  { period: 'weeks4' },
  { period: 'custom', from: '2026-11-01', to: '2026-11-11' },
]

for (const locale of ['ru-RU', 'en-US']) {
  test.describe(locale, () => {
    test.use({ locale })

    for (const width of WIDTHS)
      test(`the three figures are whole at ${width}px in every period`, async ({ page }, info) => {
        await serve(page, LONG_FIGURES)
        const seen: Record<string, unknown> = {}
        for (const { period, ...span } of PERIODS) {
          await openReport(page, width, pageAt({ open: 'section', period, ...span }))
          await page.evaluate(() => document.fonts.ready)
          const figures = await shortfalls(page, '.spending-tiles .tile-figure')
          const trends = await page
            .locator('.spending-tiles .tile-trend')
            .evaluateAll((all) => all.map((trend) => trend.getBoundingClientRect().width))
          seen[period] = { figures, trends }
          expect(figures, `the figures in ${period}`).toHaveLength(3)
          for (const figure of figures)
            expect(figure.short, `«${figure.text}» in ${period}`).toBeLessThanOrEqual(0.01)
        }
        await record(info, `whole figures ${locale} ${width}`, seen)
      })

    test('the names on the rail are whole beside their counts, chosen or not', async ({
      page,
    }, info) => {
      await serve(page, LONG_FIGURES)
      const seen: Record<string, unknown> = {}
      for (const width of WIDTHS) {
        for (const by of ['overview', 'launch_class']) {
          // A plain address shows the rail: beside the section, or as the list on a narrow screen.
          await page.setViewportSize({ width, height: 1000 })
          await page.goto(pageAt({ by }))
          await expect(page.locator('.analytics-rail-count').first()).toBeVisible()
          await expect(page.locator(`.analytics-rail-entry[data-section="${by}"]`)).toHaveAttribute(
            'aria-current',
            'page',
          )
          await page.evaluate(() => document.fonts.ready)
          const names = await shortfalls(page, '.analytics-rail-name')
          const counts = await shortfalls(page, '.analytics-rail-count')
          seen[`${width} ${by}`] = { names, counts }
          for (const name of [...names, ...counts])
            expect(name.short, `«${name.text}» at ${width}px`).toBeLessThanOrEqual(0.01)
        }
      }
      await record(info, `whole rail names ${locale}`, seen)
    })
  })
}

/** What the count line says of the hundred tasks and those beside them, measure by measure. */
const COUNTS = {
  'ru-RU': {
    time: '145 задач · 137 вне периода',
    tokens: '100 задач · 45 без токенов · 137 вне периода',
    cost: '100 задач · 45 без цены · 137 вне периода',
  },
  'en-US': {
    time: '145 tasks · 137 outside the period',
    tokens: '100 tasks · 45 with no tokens · 137 outside the period',
    cost: '100 tasks · 45 with no price · 137 outside the period',
  },
} as const

const MEASURES = ['time', 'tokens', 'cost'] as const

/** Whether the sorted column's mark is drawn, and inside the table's frame. */
const sortMark = (page: Page) =>
  page.evaluate(() => {
    const icon = document.querySelector('.table-head .table-sort-icon')
    const frame = document.querySelector('.spending-table-frame')
    if (!icon || !frame) return null
    const mark = icon.getBoundingClientRect()
    const room = frame.getBoundingClientRect()
    const inside =
      mark.left >= room.left &&
      mark.right <= room.right &&
      mark.top >= room.top &&
      mark.bottom <= room.bottom
    return { visible: icon.checkVisibility(), inside }
  })

for (const locale of ['ru-RU', 'en-US'] as const) {
  test.describe(`${locale}, the task section's table`, () => {
    test.use({ locale })

    for (const width of [1024, 1440])
      test(`its count is whole at ${width}px in every measure, and moves nothing`, async ({
        page,
      }, info) => {
        await serve(page, LONG_FIGURES)
        const seen: Partial<Record<(typeof MEASURES)[number], unknown>> = {}
        const heads: string[] = []
        for (const measure of MEASURES) {
          await openReport(page, width, pageAt({ by: 'work_item', measure }))
          await page.evaluate(() => document.fonts.ready)
          const [line] = await shortfalls(page, '.spending-table-summary')
          const head = await page.locator('.spending-table-head').boundingBox()
          const mark = await sortMark(page)
          seen[measure] = { line, head, mark }
          heads.push(JSON.stringify(head))
          expect(line?.text.replaceAll(/\s+/gu, ' ')).toBe(COUNTS[locale][measure])
          expect(line?.short, `the count in ${measure}`).toBeLessThanOrEqual(0.01)
          expect(mark, `the sort mark in ${measure}`).toEqual({ visible: true, inside: true })
        }
        await record(info, `whole count ${locale} ${width}`, seen)
        // The heading row over the table stands the same in every measure.
        expect(new Set(heads).size, 'the heading row across the measures').toBe(1)
      })
  })
}
