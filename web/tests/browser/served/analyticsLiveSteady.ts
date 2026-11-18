/**
 * The records production-analytics-live-steady.spec.ts serves.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { NIGHT_GROUP as NIGHT, WORK_GROUP as WORK } from '../../fixtures/quotaSpent.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/**
 * Thirty tasks in the live hour, each one or a few whole minutes, enough for the table to scroll,
 * the first half under one account and the rest under another, and ten of them in the hour before
 * it; `times` scales every one of them, which keeps their order.
 */
export const busyHour = (times: number): TimedStretch[] => [
  ...Array.from({ length: 30 }, (_, index) => ({
    at: at(13, 32 + index, 10),
    group: {
      work_item: task(index + 1, `Task number ${index + 1}`),
      ...(index < 15 ? WORK : NIGHT),
    },
    spend: { seconds: ((index % 4) + 1) * 60 * times },
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    at: at(12, 40 + index * 2),
    group: { work_item: task(index + 1, `Task number ${index + 1}`), ...WORK },
    spend: { seconds: 120 * times },
  })),
]

export const served: Served[] = [
  ...usageServed('served/analyticsLiveSteady.ts busyHour(1)', busyHour(1)),
  ...usageServed('served/analyticsLiveSteady.ts busyHour(2)', busyHour(2)),
]
