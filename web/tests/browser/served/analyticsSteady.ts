/**
 * The work production-analytics-steady.spec.ts serves as usage.
 */
import { noTask, seatValue, task, unknownTask } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** Monday, Tuesday and Wednesday of the week the double's clock stands in. */
export const on = (day: number) => new Date(2026, 10, 9 + day, 10)

/** Two accounts of one organization. */
export const FIRST = seatValue(
  '0c0c0c0c-1111-4222-8333-444455556666/3f9a1b2c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
)
export const SECOND = seatValue(
  '0c0c0c0c-1111-4222-8333-444455556666/77de0a1c-1111-4222-8333-444455556666',
)

export const LONG =
  'Rework the import of very long planning documents into the board so that nothing is lost'

export const STEADY: TimedStretch[] = [
  // Monday: one task with a short title, under one account.
  { at: on(0), group: { work_item: task(1, 'Fix'), seat: FIRST }, spend: { seconds: 3600 } },
  // Tuesday: six tasks with long titles, under the other account, beside work on no task.
  ...Array.from({ length: 6 }, (_, index) => ({
    at: on(1),
    group: { work_item: task(index + 2, `${LONG}, part ${index + 1}`), seat: SECOND },
    spend: { seconds: (7 - index) * 3600 },
  })),
  { at: on(1), group: { work_item: noTask, seat: SECOND }, spend: { seconds: 5 * 3600 } },
  // Wednesday: two tasks under both accounts, unknown work, and more tasks for «other».
  { at: on(2), group: { work_item: task(1, 'Fix'), seat: FIRST }, spend: { seconds: 7200 } },
  {
    at: on(2),
    group: { work_item: task(2, `${LONG}, part 1`), seat: SECOND },
    spend: { seconds: 1800 },
  },
  { at: on(2), group: { work_item: unknownTask }, spend: { seconds: 4 * 3600 } },
  ...Array.from({ length: 10 }, (_, index) => ({
    at: on(2),
    group: { work_item: task(index + 20, `Small task ${index + 1}`), seat: FIRST },
    spend: { seconds: 600 },
  })),
]

export const served: Served[] = [...usageServed('served/analyticsSteady.ts STEADY', STEADY)]
