/**
 * The work production-analytics-read.spec.ts serves as usage.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'
import { LONG_TAIL } from './analyticsWorld.ts'

/**
 * Twenty-five tasks of an hour each this week, and a long day three weeks back that the past four
 * weeks hold and this week does not, so the two periods say different figures.
 */
export const WORLD: TimedStretch[] = [
  ...LONG_TAIL,
  {
    at: new Date(2026, 9, 20, 10),
    group: { work_item: task(1, 'Task 1') },
    spend: { seconds: 36_000, tokens: 5000, cost: 4 },
  },
]

/** One minute of work in the live hour, so its summary says a figure. */
export const LIVE_WORK: TimedStretch[] = [
  { at: at(14, 5), group: { work_item: task(1, 'Fix the import') }, spend: { seconds: 300 } },
  { at: at(13, 50), group: { work_item: task(2, 'Ship it') }, spend: { seconds: 600 } },
]

export const served: Served[] = [
  ...usageServed('served/analyticsRead.ts WORLD', WORLD),
  ...usageServed('served/analyticsRead.ts LIVE_WORK', LIVE_WORK),
]
