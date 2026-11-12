/**
 * The words the Analytics page holds to one line are whole wherever something beside them can
 * still give way: the figures of the three cells, beside their trends, and the names on the rail,
 * beside their counts. The figures are as long as a month of a busy workstation writes them.
 *
 * Each is measured by the width its text takes laid out whole against its box (`shortfalls`):
 * a cut by a third of a pixel costs a figure its last characters to the ellipsis as surely as one
 * by thirty, and `scrollWidth`, in whole pixels, saw none of them.
 */
import { expect } from '@playwright/test'

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
