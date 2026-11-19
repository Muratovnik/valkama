/**
 * The work production-analytics-overview.spec.ts serves as usage.
 */
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'
import { TASKS, worked } from './overviewPage.ts'

/**
 * Three models this week, named as clients name them: two of whole hours and one of an hour and
 * fifty-nine minutes, whose figure is the longest words of the card. A model of seconds would read
 * «under a minute», which a card does not draw.
 */
export const MODELS: TimedStretch[] = [
  worked(9, TASKS[0], ['claude-sonnet-5-5', 'main', 'alpha'], 3),
  worked(10, TASKS[1], ['claude-opus-5-5', 'main', 'alpha'], 2),
  { ...worked(11, TASKS[2], ['gpt-6.1-sol', 'main', 'alpha'], 0), spend: { seconds: 7140 } },
  worked(2, TASKS[0], ['claude-sonnet-5-5', 'main', 'alpha'], 1),
]

export const served: Served[] = [...usageServed('served/analyticsOverview.ts MODELS', MODELS)]
