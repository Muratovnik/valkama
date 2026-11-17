/**
 * The work production-analytics-bar-states.spec.ts serves as usage.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** Two days of work this week, and some in the live hour. */
export const DAYS: TimedStretch[] = [
  { at: at(13, 50), group: { work_item: task(1, 'One') }, spend: { seconds: 600 } },
  { at: new Date(2026, 10, 9, 10), group: { work_item: task(1, 'One') }, spend: { seconds: 3600 } },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(2, 'Two') },
    spend: { seconds: 3600 },
  },
]

export const served: Served[] = [...usageServed('served/analyticsBarStates.ts DAYS', DAYS)]
