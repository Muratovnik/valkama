/**
 * A row whose figure is less than the least its unit shows, in the real app over the browser
 * double. The oracle is the owner's rule: no view of a chart names a row that reads «under a
 * minute», under any name — not the ring, its bars nor its table twin — while unknown work of a
 * minute or more stays, since it shows a gap in what is placed; the section's own table, which
 * holds every value in every measure, still lists the small row, its time read as none, «0 min»,
 * as a figure that says nothing of how much is in every view (DESIGN.md, Charts), and the
 * section's total still counts it. The figures expected are the fixture's own seconds.
 */
import { expect } from '@playwright/test'

import { value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

const at = new Date(2026, 10, 10, 10)

/**
 * This week by model: one model of 1 h 59 min 40 s, one of 30 seconds and unknown work of two
 * minutes, 2 h 2 min 10 s in all; without the 30 seconds the total would read 2 h 1 min.
 */
const SMALL: TimedStretch[] = [
  { at, group: { model: value('model-a') }, spend: { seconds: 7180 } },
  { at, group: { model: value('model-b') }, spend: { seconds: 30 } },
  { at, group: { model: { id: null, unknown: true } }, spend: { seconds: 120 } },
]

test('a row under a minute is in no view of the chart, and kept by the section table and the total', async ({
  page,
}, info) => {
  await serve(page, SMALL)
  const analytics = await openReport(page, 1440, pageAt({ by: 'model' }))
  const section = analytics.locator('.spending-bars')

  // The ring opens first: no sector and no line of its legend for the thirty seconds.
  await expect(section).toHaveAttribute('data-shown', 'ring')
  const legend = section.locator('[data-hint-list="legend"] [data-series]')
  await expect(legend).toHaveCount(2)
  await expect(legend.filter({ hasText: 'model-b' })).toHaveCount(0)
  await expect(legend.filter({ hasText: 'model-a' })).toHaveCount(1)
  const sectors = await section
    .locator('[data-sector]')
    .evaluateAll((all) => all.map((one) => (one as SVGElement).dataset.key))
  expect(sectors).toEqual(['v:model-a', 'unknown'])

  await section.getByRole('radio', { name: 'Bars', exact: true }).click()
  await expect(section).toHaveAttribute('data-shown', 'bars')
  const rows = section.locator('.ranked-line')
  const drawn = await rows.evaluateAll((lines) =>
    lines.map((line) => [(line as HTMLElement).dataset.key ?? '', line.textContent?.trim() ?? '']),
  )
  // The model of thirty seconds is no row; unknown work of two minutes is one.
  expect(drawn).toHaveLength(2)
  expect(drawn.map(([key]) => key)).toEqual(['v:model-a', 'unknown'])
  expect(drawn.some(([, text]) => text.includes('model-b'))).toBe(false)

  // The chart's table twin leaves it out too, and keeps the two rows the chart draws.
  await section.getByRole('radio', { name: 'Table', exact: true }).click()
  await expect(section).toHaveAttribute('data-shown', 'table')
  await expect(section.locator('tbody tr')).toHaveCount(2)
  await expect(section.locator('tbody tr', { hasText: 'model-b' })).toHaveCount(0)

  // The total counts it: 7180 + 30 + 120 seconds.
  await expect(analytics.locator('.tile-figure[data-measure="time"]')).toHaveText(/^2\sh\s2\smin$/u)

  // The section's own table lists it, under its name, its time read as none.
  const small = analytics.locator('.spending-table tbody tr', { hasText: 'model-b' })
  await expect(small).toHaveCount(1)
  await expect(small.locator('td[data-measure="time"]')).toHaveText(/^0\smin$/u)
  await expect(small).not.toContainText('under a minute')
  await record(info, 'below the unit', { drawn, sectors })
})
