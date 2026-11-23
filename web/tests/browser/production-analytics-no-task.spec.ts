/**
 * Work with no task on the Analytics page, in the real app. The oracle is the requirement: its row
 * on the overview's card of tasks opens its side panel, which has no card to offer, and the
 * panel's «Add to filter» adds work with no task to the page's filter with the overview kept, a
 * new place in the history. The period's figure is then the figure the row showed, the section of
 * projects breaks it down by where that work came from and sums to it, the bar names the filter in
 * words and takes it out, and Back returns through the filtered overview and the panel to the
 * overview. The figure expected is the fixture's own hours.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { NO_TASK_HOURS, WORLD } from './served/analyticsNoTask.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

test('work with no task on the card of tasks is added to the filter from its panel and broken down by project', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  // The fixture's hours on no task, as the page writes a whole number of hours; the row adds their
  // share of the week's ten: the tasks' seven and these three.
  const hours = `${NO_TASK_HOURS.reduce((sum, one) => sum + one, 0)}\u{A0}h`
  const row = page
    .locator('[data-card="work_item"]')
    .getByRole('button', { name: 'Details of No task' })
  await expect(row.locator('.ranked-label')).toHaveText('No task')
  await expect(row.locator('.ranked-value')).toHaveText(`${hours} · 30%`)

  await row.click()
  const opened = pageAt({ detail: '{"by":"work_item","value":null}' })
  await expect.poll(() => path(page)).toBe(opened)
  const details = page.getByRole('dialog', { name: 'Details: No task' })
  // No card to offer, where a task's panel offers one (`production-analytics-value-panel.spec.ts`).
  await expect(details.getByRole('link', { name: 'Open the card' })).toHaveCount(0)
  await details.getByRole('button', { name: 'Add to filter' }).click()
  const filtered = pageAt({ filters: '{"work_item":[null]}' })
  await expect.poll(() => path(page)).toBe(filtered)
  await expect(details).toBeHidden()
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Overview/u)
  // The period's figure is the figure the row showed.
  await expect(page.locator('.spending-tiles .tile-figure[data-measure="time"]')).toHaveText(hours)

  // The section of projects breaks it down by where it came from, and sums to it.
  await page.locator('.analytics-rail [data-section="project"]').click()
  const byProject = pageAt({ by: 'project', filters: '{"work_item":[null]}' })
  await expect.poll(() => path(page)).toBe(byProject)
  const table = page.locator('.spending-table')
  // The fixture's 2.5 hours under alpha and 0.5 under beta, largest first.
  await expect(table.locator('tbody th')).toHaveText(['alpha', 'beta'])
  await expect(table.locator('tfoot td[data-measure="time"]')).toHaveText(hours)
  const headings = await table.locator('thead th').allTextContents()
  await record(info, 'analytics no task breakdown', { url: path(page), headings })
  await page.screenshot(shot(info, 'analytics-no-task-breakdown-1440x900.png'))

  // The bar names the filter in words, and it can be taken out.
  const chip = page.locator('.analytics-bar-chips [data-filter-chip]')
  await expect(chip).toHaveText(['Task: No task'])
  await page.getByRole('button', { name: 'Remove Task: No task' }).click()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'project' }))

  // Back returns to the filtered overview, to the panel the adding was asked in, then to the
  // overview.
  await page.goBack()
  await expect.poll(() => path(page)).toBe(filtered)
  await page.goBack()
  await expect.poll(() => path(page)).toBe(opened)
  await expect(details).toBeVisible()
  await page.goBack()
  await expect.poll(() => path(page)).toBe(pageAt())
  await expect(details).toBeHidden()
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Overview/u)
})
