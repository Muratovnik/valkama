/**
 * The work production-analytics-moment-span.spec.ts serves as usage.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/**
 * Work today inside the span, from 10:00 to 13:00, beside work earlier and later, and some in
 * the three hours right before it, which the span is compared with.
 */
export const TODAY: TimedStretch[] = [
  { at: at(7, 30), group: { work_item: task(1, 'Fix') }, spend: { seconds: 900 } },
  { at: at(6, 40), group: { work_item: task(1, 'Fix') }, spend: { seconds: 3600 } },
  { at: at(10, 20), group: { work_item: task(1, 'Fix') }, spend: { seconds: 1800 } },
  { at: at(12, 40), group: { work_item: task(2, 'Read') }, spend: { seconds: 600 } },
  { at: at(13, 30), group: { work_item: task(2, 'Read') }, spend: { seconds: 3600 } },
]

export const served: Served[] = [...usageServed('served/analyticsMomentSpan.ts TODAY', TODAY)]
