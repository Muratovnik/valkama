/**
 * Work with no task on the Analytics page, in the real app. The oracle is the requirement: its row
 * on the overview's card of tasks opens its side panel, which has no card to offer, and the
 * panel's «Narrow the page to it» breaks the view down by where that work came from — each pair of
 * a project and a launch class — each a new place in the history. The breakdown sums to the figure
 * the row showed, the bar names the filter in words and takes it out, and Back returns through the
 * panel to the overview. The figure expected is the fixture's own hours.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { NO_TASK_HOURS, WORLD } from './served/analyticsNoTask.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

test('work with no task on the card of tasks breaks down by project and launch class from its panel', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  // The fixture's hours on no task, as the page writes a whole number of hours.
  const hours = `${NO_TASK_HOURS.reduce((sum, one) => sum + one, 0)}\u{A0}h`
  const row = page
    .locator('[data-card="work_item"]')
    .getByRole('button', { name: 'Details of No task' })
  await expect(row.locator('.ranked-label')).toHaveText('No task')
  await expect(row.locator('.ranked-value')).toHaveText(hours)

  await row.click()
  const opened = pageAt({ detail: '{"by":"work_item","value":null}' })
  await expect.poll(() => path(page)).toBe(opened)
  const details = page.getByRole('dialog', { name: 'Details: No task' })
  // No card to offer, where a task's panel offers one (`production-analytics-value-panel.spec.ts`).
  await expect(details.getByRole('link', { name: 'Open the card' })).toHaveCount(0)
  const narrow = details.getByRole('button', { name: 'Narrow the page to it' })
  await expect(narrow).toHaveAccessibleDescription(
    'Break down the work with no task by project and launch class',
  )
  await narrow.click()
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ by: 'project', filters: '{"work_item":[null]}', across: 'launch_class' }))
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Project/u)
  const table = page.locator('.spending-table')
  await expect(table.locator('h3')).toHaveText('Spending by project and by launch class')
  // One row per pair, the project first, largest first: the fixture's 1.5, 1 and 0.5 hours.
  await expect(table.locator('tbody th')).toHaveText([
    'alpha · build',
    'alpha · The session itself',
    'beta · build',
  ])
  const headings = await table.locator('thead th').allTextContents()
  await record(info, 'analytics no task breakdown', { url: path(page), headings })
  await page.screenshot(shot(info, 'analytics-no-task-breakdown-1440x900.png'))
  // The breakdown sums to the figure the row showed: in the period's figure and the table's total.
  await expect(page.locator('.spending-tiles .tile-figure[data-measure="time"]')).toHaveText(hours)
  await expect(table.locator('tfoot td[data-measure="time"]')).toHaveText(hours)

  // The bar names the filter in words, and it can be taken out.
  const chip = page.locator('.analytics-bar-filters .combo-chip')
  await expect(chip).toHaveText(['Task: No task'])
  await page.getByRole('button', { name: 'Remove Task: No task' }).click()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'project', across: 'launch_class' }))

  // Back returns to the panel the narrowing was asked in, and then to the overview.
  await page.goBack()
  await expect.poll(() => path(page)).toBe(opened)
  await expect(details).toBeVisible()
  await page.goBack()
  await expect.poll(() => path(page)).toBe(pageAt())
  await expect(details).toBeHidden()
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Overview/u)
})
