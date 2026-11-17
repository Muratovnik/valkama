/**
 * The work production-analytics-one-scroll.spec.ts serves as usage.
 */
import { task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** Forty-four tasks over the three days of the week so far, each its own share of the time. */
export const TASKS: TimedStretch[] = Array.from({ length: 44 }, (_, index) => ({
  at: new Date(2026, 10, 9 + (index % 3), 10),
  group: {
    work_item: task(
      index + 1,
      `Read the planning documents through the board reader, ${index + 1}`,
    ),
    account: value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'),
  },
  spend: { seconds: (45 - index) * 1800, tokens: (45 - index) * 90_000, cost: 45 - index },
}))

export const served: Served[] = [...usageServed('served/analyticsOneScroll.ts TASKS', TASKS)]
