/**
 * The overview of the Analytics page as its specs open it: a week of work to Wednesday
 * afternoon beside the same days of the week before, and the opener that waits for every read
 * of the overview to land. Every id, name and number is made up.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { noTask, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { WORK_GROUP } from '../fixtures/quotaSpent.ts'
import { pageAt } from './analyticsPage.ts'

/** Ten in the morning of a day of November 2026, in the browser's own time. */
const on = (day: number, hour = 10) => new Date(2026, 10, day, hour)
const HOUR = 3600

/** A stretch of work on a day: its task, model, role and project, and its hours. */
export function worked(
  day: number,
  workItem: TimedStretch['group']['work_item'],
  [model, role, project]: [string, string, string],
  hours: number,
): TimedStretch {
  return {
    at: on(day),
    group: {
      work_item: workItem,
      model: value(model),
      role: value(role),
      project: value(project),
      ...WORK_GROUP,
    },
    spend: { seconds: hours * HOUR, tokens: hours * 100_000, cost: hours * 2 },
  }
}

export const TASKS = Array.from({ length: 6 }, (_, index) =>
  task(index + 1, `Rework the import of planning documents, part ${index + 1}`),
)

/**
 * This week to Wednesday afternoon, and the same days of the week before. From the week before:
 * MAIN-1 and work on no task fall by four hours each; MAIN-2 rises from a quarter of an hour,
 * MAIN-3 by two hours, MAIN-5 from nothing.
 */
export const WORLD: TimedStretch[] = [
  worked(9, TASKS[0], ['model-a', 'main', 'alpha'], 5),
  worked(9, TASKS[1], ['model-b', 'subagent', 'alpha'], 3),
  worked(10, TASKS[2], ['model-a', 'main', 'beta'], 4),
  worked(10, TASKS[3], ['model-c', 'advisor', 'beta'], 1),
  worked(10, noTask, ['model-a', 'main', 'alpha'], 2),
  worked(11, TASKS[4], ['model-b', 'main', 'gamma'], 2),
  worked(11, TASKS[5], ['model-a', 'subagent', 'gamma'], 1),
  worked(11, TASKS[0], ['model-a', 'main', 'alpha'], 1),
  worked(2, TASKS[0], ['model-a', 'main', 'alpha'], 10),
  worked(2, TASKS[2], ['model-a', 'main', 'beta'], 2),
  worked(3, noTask, ['model-a', 'main', 'alpha'], 6),
  worked(4, TASKS[1], ['model-b', 'subagent', 'alpha'], 0.25),
]

/** Opens the page at an address and waits until the overview's reads have all landed. */
export async function openOverview(page: Page, width: number, height: number, address = pageAt()) {
  await page.setViewportSize({ width, height })
  await page.goto(address)
  const panel = page.locator('.analytics-panel')
  await expect(panel.locator('.overview-panel')).toBeVisible()
  await expect(panel.locator('.overview-top')).not.toHaveCount(0)
  for (const card of await panel.locator('.overview-top').all())
    await expect(card.locator('.ranked-row').first()).toBeVisible()
  await expect(panel.locator('.period-before').first()).toBeAttached()
  return panel
}
