/**
 * How many tasks the period has, said in three places of the task section, in the real app over
 * the browser double: the rail's tile, «All N» under the ranked list, and the heading row of the
 * full table that line opens in the side panel. The oracle is the requirement: the three say one
 * number, the values with agent time in the period; work with no task, work nobody can place and
 * a task that spent tokens and no agent time are rows of the full table and no part of it. The
 * expected count is the fixture's own: twelve tasks of agent time.
 */
import { expect } from '@playwright/test'

import { noTask, task, unknownTask, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** The tasks of the week with agent time: more than the list names, so «All N» is offered. */
const TIMED_TASKS = 12

const at = (day: number) => new Date(2026, 10, day, 10)
const WORK = { project: value('alpha'), model: value('model-a') }

/**
 * Twelve tasks of an hour or more, work with no task and work nobody can place beside them, and a
 * task that only spent tokens, which has no agent time to count.
 */
const WEEK: TimedStretch[] = [
  ...Array.from({ length: TIMED_TASKS }, (_, index) => ({
    at: at(9 + (index % 3)),
    group: { work_item: task(index + 1, `Task ${index + 1}`), ...WORK },
    spend: { seconds: 3600 * (index + 1), tokens: 1000, cost: 1 },
  })),
  { at: at(9), group: { work_item: noTask, ...WORK }, spend: { seconds: 7200, tokens: 500 } },
  { at: at(10), group: { work_item: unknownTask, ...WORK }, spend: { seconds: 1800, tokens: 50 } },
  {
    at: at(10),
    group: { work_item: task(40, 'Adviser notes'), ...WORK },
    spend: { seconds: 0, tokens: 2000, cost: 0.5 },
  },
]

test('the rail’s tile, «All N» and the full table count the period’s tasks alike, beside work with no task', async ({
  page,
}) => {
  await serve(page, WEEK)
  const analytics = await openReport(page, 1440)
  const tile = analytics.locator('.analytics-rail-entry[data-section="work_item"]')
  await expect(tile.locator('.analytics-rail-count')).toHaveText(`${TIMED_TASKS} values`)
  const all = analytics.locator('.spending-bars [data-all]')
  await expect(all).toHaveText(`All ${TIMED_TASKS}`)

  await all.click()
  const every = page.getByRole('dialog', { name: 'Details: Task: every value' })
  // Every row of the week: the twelve tasks, the one with tokens alone, and the two rows apart.
  await expect(every.locator('tbody').getByRole('row')).toHaveCount(TIMED_TASKS + 3)
  await expect(every.locator('.spending-table-summary')).toHaveText(
    `${TIMED_TASKS} tasks · 1 with no agent time`,
  )
})
