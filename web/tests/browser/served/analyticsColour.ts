/**
 * The work production-analytics-colour.spec.ts serves as usage.
 */
import { noTask, task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const HOUR = 3600
export const RANKING = [3, 1, 2, 4]

export const RANKED: TimedStretch[] = [
  ...RANKING.map((number, rank) => ({
    at: new Date(2026, 10, 9 + (rank % 3), 10),
    group: { work_item: task(number, `Task ${number}`) },
    spend: { seconds: (5 - rank) * HOUR, tokens: (5 - rank) * 1000 },
  })),
  {
    at: new Date(2026, 10, 10, 12),
    group: { work_item: noTask },
    spend: { seconds: 8 * HOUR, tokens: 8000 },
  },
]

/**
 * Seven tasks, so two fold into «other», and work on no task larger than any of them: the day
 * chart stacks the five tasks, then no task, then the rest, each part of the stack on its own.
 */
export const FOLDED: TimedStretch[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((number) => ({
    at: new Date(2026, 10, 11, 9),
    group: { work_item: task(number, `Task ${number}`) },
    spend: { seconds: (9 - number) * HOUR, tokens: 1000 },
  })),
  {
    at: new Date(2026, 10, 11, 12),
    group: { work_item: noTask },
    spend: { seconds: 20 * HOUR, tokens: 1000 },
  },
]

export const served: Served[] = [
  ...usageServed('served/analyticsColour.ts RANKED', RANKED),
  ...usageServed('served/analyticsColour.ts FOLDED', FOLDED),
]
