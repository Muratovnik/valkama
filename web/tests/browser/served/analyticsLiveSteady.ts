/**
 * The records production-analytics-live-steady.spec.ts serves.
 */
import { task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

const ONE = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')
const TWO = value('d4e8a1f0-7c2b-4e5d-8f36-a1b2c3d4e5f6')

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
      account: index < 15 ? ONE : TWO,
    },
    spend: { seconds: ((index % 4) + 1) * 60 * times },
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    at: at(12, 40 + index * 2),
    group: { work_item: task(index + 1, `Task number ${index + 1}`), account: ONE },
    spend: { seconds: 120 * times },
  })),
]

export const served: Served[] = [
  ...usageServed('served/analyticsLiveSteady.ts busyHour(1)', busyHour(1)),
  ...usageServed('served/analyticsLiveSteady.ts busyHour(2)', busyHour(2)),
]
