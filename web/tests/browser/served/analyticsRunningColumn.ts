/**
 * The work production-analytics-running-column.spec.ts serves as usage.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const FIX = task(1, 'Fix the import')
export const SHIP = task(2, 'Ship the release')

/** Work in the live hour, earlier today, yesterday and on days of the past four weeks. */
export const WORK: TimedStretch[] = [
  { at: at(13, 40), group: { work_item: FIX }, spend: { seconds: 240 } },
  { at: at(14, 20), group: { work_item: SHIP }, spend: { seconds: 180 } },
  { at: at(9, 0), group: { work_item: FIX }, spend: { seconds: 3600 } },
  { at: new Date(2026, 10, 10, 11), group: { work_item: SHIP }, spend: { seconds: 5400 } },
  { at: new Date(2026, 10, 9, 10), group: { work_item: FIX }, spend: { seconds: 3600 } },
  { at: new Date(2026, 9, 20, 10), group: { work_item: SHIP }, spend: { seconds: 1800 } },
]

export const served: Served[] = [...usageServed('served/analyticsRunningColumn.ts WORK', WORK)]
