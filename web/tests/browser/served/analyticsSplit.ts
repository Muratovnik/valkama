/**
 * The work production-analytics-split.spec.ts serves as usage.
 */
import { task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** Thirty tasks over the three days of the week so far, each with a title a row has to fold. */
export const THIRTY_TASKS: TimedStretch[] = Array.from({ length: 30 }, (_, index) => ({
  at: new Date(2026, 10, 9 + (index % 3), 10),
  group: {
    work_item: task(
      index + 1,
      `Move the import of long planning documents onto the new board reader, step ${index + 1}`,
    ),
    account: value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'),
  },
  spend: { seconds: (31 - index) * 3600, tokens: (31 - index) * 900_000, cost: (31 - index) * 4 },
}))

export const served: Served[] = [
  ...usageServed('served/analyticsSplit.ts THIRTY_TASKS', THIRTY_TASKS),
]
