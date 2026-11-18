/**
 * A row whose figure is less than the least its unit shows, in the real app over the browser
 * double. The oracle is the owner's rule: a ranked list draws no row that reads «under a minute»,
 * under any name, while unknown work of a minute or more stays, since it shows a gap in what is
 * placed; the section's table still lists the small row, and the section's total and every share
 * still count it. The figures expected are the fixture's own seconds.
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

test('a row under a minute is left out of the bars, and kept by the table and the total', async ({
  page,
}, info) => {
  await serve(page, SMALL)
  const analytics = await openReport(page, 1440, pageAt({ by: 'model' }))
  const section = analytics.locator('.spending-bars')
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

  // The total counts it: 7180 + 30 + 120 seconds.
  await expect(analytics.locator('.tile-figure[data-measure="time"]')).toHaveText(/^2\sh\s2\smin$/u)

  // The table lists it, under its name, with its figure.
  await section.getByRole('radio', { name: 'Table', exact: true }).click()
  await expect(section).toHaveAttribute('data-shown', 'table')
  const small = section.locator('tbody tr', { hasText: 'model-b' })
  await expect(small).toHaveCount(1)
  await expect(small).toContainText('under a minute')
  await record(info, 'below the unit', { drawn })
})
