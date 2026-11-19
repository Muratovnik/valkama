/**
 * The work production-analytics-lines.spec.ts serves as usage.
 */
import { seatValue, task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/**
 * Twelve stretches of this week with a value in every dimension, so every entry has a count: the
 * longest name, «Способ запуска», the longest count of the fixture beside it.
 */
export const EVERY_DIMENSION: TimedStretch[] = Array.from({ length: 12 }, (_, index) => ({
  at: new Date(2026, 10, 9 + (index % 3), 10),
  group: {
    work_item: task(index + 1, `Задача ${index + 1}`),
    seat: seatValue(`organization-${index % 2}/account-${index % 4}`),
    account: value(`organization-${index % 2}`),
    project: value(`project-${index % 3}`),
    executor: value(`executor-${index % 4}`),
    role: value(index % 2 ? 'main' : 'subagent'),
    launch_class: value(`launch-${index}`),
    model: value(`model-${index % 5}`),
    effort: value(`effort-${index % 3}`),
    environment: value(`environment-${index % 2}`),
  },
  spend: { seconds: 3600 * (index + 1), tokens: 1000 * (index + 1), cost: index + 1 },
}))

export const served: Served[] = [
  ...usageServed('served/analyticsLines.ts EVERY_DIMENSION', EVERY_DIMENSION),
]
