/**
 * The work overviewPage.ts serves as usage.
 */
import { noTask, task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { WORK_GROUP } from '../../fixtures/quotaSpent.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** Ten in the morning of a day of November 2026, in the browser's own time. */
export const on = (day: number, hour = 10) => new Date(2026, 10, day, hour)
export const HOUR = 3600

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

export const served: Served[] = [...usageServed('served/overviewPage.ts WORLD', WORLD)]
