/**
 * «Add to filter» in a value's side panel on the Analytics page, in the real app. The oracle is the
 * requirement (`DESIGN.md`, Analytics): it adds the value to its dimension's filter beside the
 * values already there — model-b and then model-a is both — so the bar names each in a chip; the
 * page stays on its section and the panel closes, a step of the history Back returns from; a
 * value the filter holds already offers it disabled, «Already in filter». Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'

const on = (day: number) => new Date(2026, 10, day, 10)

/** This week: two tasks, one under each of two models. */
const WORLD: TimedStretch[] = [
  {
    at: on(10),
    group: { work_item: task(1, 'Import the documents'), model: value('model-a') },
    spend: { seconds: 7200, tokens: 2_000_000, cost: 20 },
  },
  {
    at: on(10),
    group: { work_item: task(2, 'Write the notes'), model: value('model-b') },
    spend: { seconds: 3600, tokens: 1_000_000, cost: 10 },
  },
]

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** The side panel standing open, at rest after its entrance. */
async function panelNamed(page: Page, name: string) {
  const panel = page.getByRole('dialog', { name })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveCSS('transform', 'none')
  return panel
}

test('«Add to filter» adds the value beside the filter’s values, keeps the section and closes the panel; a value held offers it disabled', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt({ by: 'model' }))
  const bars = page.locator('.spending-bars')
  await drawLined(bars)
  const section = page.locator('.analytics-rail [aria-current="page"]')
  const chips = page.locator('.analytics-bar-chips [data-filter-chip]')
  await expect(chips).toHaveCount(0)

  await bars.getByRole('button', { name: 'Details of model-b' }).click()
  const opened = pageAt({ by: 'model', detail: '{"by":"model","value":"model-b"}' })
  await expect.poll(() => path(page)).toBe(opened)
  const panel = await panelNamed(page, 'Details: model-b')
  await panel.getByRole('button', { name: 'Add to filter' }).click()
  const filtered = pageAt({ by: 'model', filters: '{"model":["model-b"]}' })
  await expect.poll(() => path(page)).toBe(filtered)
  await expect(panel).toBeHidden()
  await expect(section).toHaveText(/^Model/u)
  await expect(chips).toHaveText(['Model: model-b'])

  // A value the filter holds offers nothing to add.
  await bars.getByRole('button', { name: 'Details of model-b' }).click()
  const again = await panelNamed(page, 'Details: model-b')
  await expect(again.getByRole('button', { name: 'Already in filter' })).toBeDisabled()
  await expect(again.getByRole('button', { name: 'Add to filter' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(again).toBeHidden()
  await expect.poll(() => path(page)).toBe(filtered)

  // Another model joins the filter beside it. The filter leaves model-a no bar, so its panel opens
  // by its address, as a link to it does.
  await page.goto(
    pageAt({
      by: 'model',
      filters: '{"model":["model-b"]}',
      detail: '{"by":"model","value":"model-a"}',
    }),
  )
  const other = await panelNamed(page, 'Details: model-a')
  await other.getByRole('button', { name: 'Add to filter' }).click()
  const both = pageAt({ by: 'model', filters: '{"model":["model-a","model-b"]}' })
  await expect.poll(() => path(page)).toBe(both)
  await expect(other).toBeHidden()
  await expect(section).toHaveText(/^Model/u)
  await expect(chips).toHaveText(['Model: model-a', 'Model: model-b'])
  await record(info, 'analytics add to filter', {
    url: path(page),
    chips: await chips.allTextContents(),
  })

  // Back returns to the panel the adding was asked in, over the filter it had.
  await page.goBack()
  await expect(other).toBeVisible()
  await expect(chips).toHaveText(['Model: model-b'])
})
