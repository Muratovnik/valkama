/**
 * The work production-analytics-overview.spec.ts serves as usage.
 */
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'
import { TASKS, worked } from './overviewPage.ts'

/**
 * Three models this week: two of hours, named as clients name them, and one of seconds, whose
 * figure is the longest words of the card.
 */
export const MODELS: TimedStretch[] = [
  worked(9, TASKS[0], ['claude-sonnet-5-5', 'main', 'alpha'], 3),
  worked(10, TASKS[1], ['claude-opus-5-5', 'main', 'alpha'], 2),
  { ...worked(11, TASKS[2], ['gpt-6.1-sol', 'main', 'alpha'], 0), spend: { seconds: 30 } },
  worked(2, TASKS[0], ['claude-sonnet-5-5', 'main', 'alpha'], 1),
]

export const served: Served[] = [...usageServed('served/analyticsOverview.ts MODELS', MODELS)]
