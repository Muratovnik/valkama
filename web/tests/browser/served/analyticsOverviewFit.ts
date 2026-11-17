/**
 * The work production-analytics-overview-fit.spec.ts serves as usage.
 */
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'
import { TASKS, worked, WORLD } from './overviewPage.ts'

/** The overview's week, and work in the live hour, so every period has a chart. */
export const WEEK_AND_HOUR: TimedStretch[] = [
  ...WORLD,
  { ...worked(11, TASKS[0], ['model-a', 'main', 'alpha'], 0.5), at: at(13, 50) },
  { ...worked(11, TASKS[1], ['model-b', 'subagent', 'alpha'], 0.25), at: at(14, 20) },
]

export const served: Served[] = [
  ...usageServed('served/analyticsOverviewFit.ts WEEK_AND_HOUR', WEEK_AND_HOUR),
]
