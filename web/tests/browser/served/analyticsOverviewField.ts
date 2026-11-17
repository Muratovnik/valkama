/**
 * The records production-analytics-overview-field.spec.ts serves.
 */
import { noTask, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'
import { ACCOUNT, TASKS, worked } from './overviewPage.ts'

const OTHER_ACCOUNT = value('0d6f1c3a-8b2e-4f5a-9e7d-3c1b2a4f6e8d')

/**
 * A full week: five tasks, models, roles and projects in each card, no task and a sixth task
 * in the chart's legend, under the accounts `accountOf` gives each stretch by its day.
 */
const fullWeek = (accountOf: (day: number, index: number) => typeof ACCOUNT): TimedStretch[] => [
  ...[0, 1, 2, 3, 4, 5].map((index): TimedStretch => {
    const day = [9, 10, 10, 11, 11, 9][index] ?? 9
    const stretch = worked(
      day,
      TASKS[index],
      [`model-${(index % 5) + 1}`, `role-${(index % 5) + 1}`, `project-${(index % 5) + 1}`],
      6 - index,
    )
    return { ...stretch, group: { ...stretch.group, account: accountOf(day, index) } }
  }),
  worked(10, noTask, ['model-1', 'role-1', 'project-1'], 2),
  worked(2, TASKS[0], ['model-1', 'role-1', 'project-1'], 4),
]

/**
 * The accounts of a full week changing none, one or two times: one account all week; the other
 * from Wednesday; one on Monday, both on Tuesday, the other on Wednesday.
 */
export const CHANGES = [
  { changes: 0, world: fullWeek(() => ACCOUNT) },
  { changes: 1, world: fullWeek((day) => (day === 11 ? OTHER_ACCOUNT : ACCOUNT)) },
  {
    changes: 2,
    world: fullWeek((day, index) => (day === 11 || index === 2 ? OTHER_ACCOUNT : ACCOUNT)),
  },
]

export const served: Served[] = CHANGES.flatMap(({ changes, world }) =>
  usageServed(`served/analyticsOverviewField.ts CHANGES (${changes} changes)`, world),
)
