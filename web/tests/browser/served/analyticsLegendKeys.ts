/**
 * The work production-analytics-legend-keys.spec.ts serves as usage.
 */
import type { UsageGroupValue } from '@/shared/api/analyticsApi.ts'

import { noTask, task, unknownTask, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const HOUR = 3600

/** A stretch of a task's work under a model, `hours` long, on a day of November. */
export const stretch = (
  day: number,
  workItem: UsageGroupValue,
  model: UsageGroupValue,
  hours: number,
): TimedStretch => ({
  at: new Date(2026, 10, day, 10),
  group: { work_item: workItem, model },
  spend: { seconds: hours * HOUR, tokens: hours * 100_000, cost: hours * 2 },
})

export const UNKNOWN_MODEL: UsageGroupValue = { id: null, unknown: true }

/**
 * This week to Wednesday: three tasks, work on no task and work nobody can place, under two
 * models and one nobody knows, so each section's legend holds keys that act and one that does not.
 */
export const SECTION_WORLD: TimedStretch[] = [
  stretch(9, task(1, 'Import the plans'), value('model-a'), 5),
  stretch(9, noTask, value('model-b'), 3),
  stretch(10, task(2, 'Write the notes'), value('model-b'), 4),
  stretch(10, unknownTask, UNKNOWN_MODEL, 1),
  stretch(11, task(3, 'Sort the crashes'), value('model-a'), 2),
  stretch(11, noTask, value('model-a'), 1.5),
]

export const served: Served[] = [
  ...usageServed('served/analyticsLegendKeys.ts SECTION_WORLD', SECTION_WORLD),
]
