/**
 * The work production-analytics-days.spec.ts serves as usage.
 */
import { noTask, task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** An hour of work on each of the sixty days that end on Wednesday 11 November 2026. */
export const SIXTY_DAYS: TimedStretch[] = Array.from({ length: 60 }, (_, back) => ({
  at: new Date(2026, 10, 11 - back, 10),
  group: { work_item: task(1, 'Import the planning documents') },
  spend: { seconds: 3600, tokens: 1_250_000 },
}))

export const HOUR = 3600

/**
 * This week at 9 hours against 21 the same days of the week before, −57 %: two hours on a task
 * and one on no task each day, against seven hours a day a week before.
 */
export const LOWER: TimedStretch[] = [
  ...[9, 10, 11].flatMap((day) => [
    {
      at: new Date(2026, 10, day, 10),
      group: { work_item: task(1, 'Import the planning documents') },
      spend: { seconds: 2 * HOUR },
    },
    { at: new Date(2026, 10, day, 11), group: { work_item: noTask }, spend: { seconds: HOUR } },
  ]),
  ...[2, 3, 4].map((day) => ({
    at: new Date(2026, 10, day, 10),
    group: { work_item: task(1, 'Import the planning documents') },
    spend: { seconds: 7 * HOUR },
  })),
]

export const served: Served[] = [
  ...usageServed('served/analyticsDays.ts SIXTY_DAYS', SIXTY_DAYS),
  ...usageServed('served/analyticsDays.ts LOWER', LOWER),
]
