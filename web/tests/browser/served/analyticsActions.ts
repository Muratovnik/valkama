/**
 * The work production-analytics-actions.spec.ts serves as usage.
 */
import { task, unknownTask, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const on = (day: number) => new Date(2026, 10, day, 10)

/**
 * Three days of work: another task under model-b on Monday, the task the backend holds under
 * model-a on Tuesday, and work nobody can place on Wednesday; the task again a week before.
 */
export const IMPORT = task(264, 'Import the planning documents')
export const WORLD: TimedStretch[] = [
  {
    at: on(10),
    group: { work_item: IMPORT, model: value('model-a') },
    spend: { seconds: 7200, tokens: 2_000_000, cost: 20 },
  },
  {
    at: on(9),
    group: { work_item: task(2, 'Write the release notes'), model: value('model-b') },
    spend: { seconds: 3600, tokens: 1_000_000, cost: 10 },
  },
  {
    at: on(11),
    group: { work_item: unknownTask, model: { id: null, unknown: true } },
    spend: { seconds: 1800, tokens: 10_000, cost: 1 },
  },
  {
    at: on(2),
    group: { work_item: IMPORT, model: value('model-a') },
    spend: { seconds: 3600, tokens: 500_000, cost: 5 },
  },
]

export const served: Served[] = [...usageServed('served/analyticsActions.ts WORLD', WORLD)]
