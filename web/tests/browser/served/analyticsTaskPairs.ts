/**
 * The work production-analytics-task-pairs.spec.ts serves as usage.
 */
import type { UsageGroupValue } from '@/shared/api/analyticsApi.ts'

import { noTask, task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const HOUR = 3600

/** A stretch of a task's work under a model, `hours` long, on a day of November. */
export const stretch = (
  day: number,
  workItem: UsageGroupValue,
  model: string,
  hours: number,
): TimedStretch => ({
  at: new Date(2026, 10, day, 10),
  group: { work_item: workItem, model: value(model) },
  spend: { seconds: hours * HOUR },
})

export const TITLES = [
  'ToolSpec: one Unity-free description of every tool the agents call, its arguments, its answers and the errors each returns',
  'Unsorted crashes of the controller under a long session',
  'A summary of the optional observations of a review',
  'Whether the four executors chase one another',
  'The layers of Bridge rules, their order and their owners',
  'The session manifest counts the launches twice',
  'The lab stands without a session come back on their own',
]

/**
 * The week so far: most of it on no task, then seven tasks, each under one model, in hours and
 * minutes, so the figures are as wide as the review's, «5 h 45 min».
 */
export const WORLD: TimedStretch[] = [
  stretch(9, noTask, 'claude-opus-5-5', 20.25),
  ...TITLES.map((title, index) =>
    stretch(
      9 + (index % 3),
      task(index + 1, title),
      ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'][index % 3] ?? '',
      9.75 - index,
    ),
  ),
]

export const served: Served[] = [...usageServed('served/analyticsTaskPairs.ts WORLD', WORLD)]
