/**
 * The work production-analytics-live.spec.ts serves as usage.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const FIX = task(1, 'Fix the import')
export const READ = task(2, 'Read the planning documents')
export const SHIP = task(3, 'Ship the release')

/**
 * Work in whole minutes inside the live hour, so the chart's figures add up as minutes; work in
 * the hour before it to compare with; and work earlier that day, which no read of «now» counts.
 */
export const HOUR_OF_WORK: TimedStretch[] = [
  { at: at(13, 35, 10), group: { work_item: FIX }, spend: { seconds: 300 } },
  { at: at(13, 50, 30), group: { work_item: READ }, spend: { seconds: 600 } },
  { at: at(14, 5), group: { work_item: FIX }, spend: { seconds: 120 } },
  { at: at(14, 29, 5), group: { work_item: SHIP }, spend: { seconds: 60 } },
  { at: at(12, 45), group: { work_item: FIX }, spend: { seconds: 900 } },
  { at: at(9, 0), group: { work_item: READ }, spend: { seconds: 7200 } },
]

export const served: Served[] = [
  ...usageServed('served/analyticsLive.ts HOUR_OF_WORK', HOUR_OF_WORK),
]
