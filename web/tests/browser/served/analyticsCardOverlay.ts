/**
 * The work production-analytics-card-overlay.spec.ts serves as usage.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { workItem } from '../planningFixtures.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'
import { worked } from './overviewPage.ts'

/** The task the store holds, worked on this week and the week before, beside another one. */
export const HELD = task(264, workItem.title)
export const WORLD: TimedStretch[] = [
  worked(9, HELD, ['model-a', 'main', 'alpha'], 5),
  worked(10, task(2, 'Write the release notes'), ['model-b', 'subagent', 'beta'], 3),
  worked(11, HELD, ['model-a', 'main', 'alpha'], 1),
  worked(2, HELD, ['model-a', 'main', 'alpha'], 2),
]

export const served: Served[] = [...usageServed('served/analyticsCardOverlay.ts WORLD', WORLD)]
