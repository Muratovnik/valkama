/**
 * Work with no task on the Analytics page, in the real app. The oracle is the requirement: it has
 * no card to open, so its row on the overview's card of tasks breaks the view down by where that
 * work came from — the project crossed with the launch class — in one press, as a new place in the
 * history. The breakdown sums to the figure the row showed, the bar names the filter in words and
 * takes it out, and Back returns to the overview. The figure expected is the fixture's own hours.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { noTask, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

const HOUR = 3600

/** A session's own run, which no one launched: the launch class's work with no value. */
const SESSION_ITSELF = { id: null, unknown: false }

/** A stretch of work at ten on a day of November 2026: its task, project and launch class. */
function stretch(
  day: number,
  workItem: TimedStretch['group']['work_item'],
  [project, launchClass]: [string, TimedStretch['group']['launch_class']],
  hours: number,
): TimedStretch {
  return {
    at: new Date(2026, 10, day, 10),
    group: {
      work_item: workItem,
      project: value(project),
      launch_class: launchClass,
      model: value('model-a'),
      role: value('main'),
    },
    spend: { seconds: hours * HOUR, tokens: hours * 100_000, cost: hours * 2 },
  }
}

/** This week's hours on no task: from two projects, under two launch classes. */
const NO_TASK_HOURS = [1.5, 1, 0.5]

/** This week to Wednesday afternoon beside two tasks, and a task the week before. */
const WORLD: TimedStretch[] = [
  stretch(9, task(1, 'Import the planning documents'), ['alpha', value('bero')], 5),
  stretch(10, task(2, 'Write the release notes'), ['beta', value('bero')], 2),
  stretch(9, noTask, ['alpha', value('bero')], NO_TASK_HOURS[0] ?? 0),
  stretch(10, noTask, ['alpha', SESSION_ITSELF], NO_TASK_HOURS[1] ?? 0),
  stretch(11, noTask, ['beta', value('bero')], NO_TASK_HOURS[2] ?? 0),
  stretch(2, task(1, 'Import the planning documents'), ['alpha', value('bero')], 3),
]

test('work with no task on the card of tasks breaks down by project and launch class in one press', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  // The fixture's hours on no task, as the page writes a whole number of hours.
  const hours = `${NO_TASK_HOURS.reduce((sum, one) => sum + one, 0)}\u{A0}h`
  const row = page
    .locator('[data-card="work_item"]')
    .getByRole('button', { name: 'Break down the work with no task by project and launch class' })
  await expect(row.locator('.ranked-label')).toHaveText('No task')
  await expect(row.locator('.ranked-value')).toHaveText(hours)

  await row.click()
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ by: 'project', filters: '{"work_item":[null]}', across: 'launch_class' }))
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Project/u)
  const table = page.locator('.spending-table')
  await expect(table.locator('h3')).toHaveText('Agent time by project and by launch class')
  await expect(table.locator('tbody th')).toHaveText(['alpha', 'beta'])
  const headings = await table.locator('thead th').allTextContents()
  await record(info, 'analytics no task breakdown', { url: path(page), headings })
  await page.screenshot(shot(info, 'analytics-no-task-breakdown-1440x900.png'))
  const columns = headings.map((one) => one.trim())
  expect([columns[0], columns.at(-1)]).toEqual(['Project', 'Total'])
  expect(columns.slice(1, -1).toSorted()).toEqual(['The session itself', 'bero'].toSorted())
  // The breakdown sums to the figure the row showed: in the period's figure and the table's total.
  await expect(page.locator('.spending-tiles .tile-figure[data-measure="time"]')).toHaveText(hours)
  await expect(table.locator('tfoot td').last()).toHaveText(hours)

  // The bar names the filter in words, and it can be taken out.
  const chip = page.locator('.analytics-bar-filters .combo-chip')
  await expect(chip).toHaveText(['Task: No task'])
  await page.getByRole('button', { name: 'Remove Task: No task' }).click()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'project', across: 'launch_class' }))

  // Back returns to the overview the row was pressed in.
  await page.goBack()
  await expect.poll(() => path(page)).toBe(pageAt())
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Overview/u)
})
