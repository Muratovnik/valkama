/**
 * The work production-analytics-no-task.spec.ts serves as usage.
 */
import { noTask, task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const HOUR = 3600

/** A session's own run, which no one launched: the launch class's work with no value. */
export const SESSION_ITSELF = { id: null, unknown: false }

/** A stretch of work at ten on a day of November 2026: its task, project and launch class. */
export function stretch(
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
export const NO_TASK_HOURS = [1.5, 1, 0.5]

/** This week to Wednesday afternoon beside two tasks, and a task the week before. */
export const WORLD: TimedStretch[] = [
  stretch(9, task(1, 'Import the planning documents'), ['alpha', value('build')], 5),
  stretch(10, task(2, 'Write the release notes'), ['beta', value('build')], 2),
  stretch(9, noTask, ['alpha', value('build')], NO_TASK_HOURS[0] ?? 0),
  stretch(10, noTask, ['alpha', SESSION_ITSELF], NO_TASK_HOURS[1] ?? 0),
  stretch(11, noTask, ['beta', value('build')], NO_TASK_HOURS[2] ?? 0),
  stretch(2, task(1, 'Import the planning documents'), ['alpha', value('build')], 3),
]

export const served: Served[] = [...usageServed('served/analyticsNoTask.ts WORLD', WORLD)]
