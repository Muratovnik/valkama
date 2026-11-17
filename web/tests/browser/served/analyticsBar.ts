/**
 * The work production-analytics-bar.spec.ts serves as usage.
 */
import { task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** Two stretches of work in the live hour. */
export const HOUR: TimedStretch[] = [
  { at: at(13, 50), group: { work_item: task(1, 'Fix') }, spend: { seconds: 600 } },
  { at: at(14, 20), group: { work_item: task(2, 'Read') }, spend: { seconds: 300 } },
]

/** An hour's work this morning and some in the hour running; yesterday, before and after now. */
export const TODAY: TimedStretch[] = [
  { at: at(9, 10), group: { work_item: task(1, 'Fix') }, spend: { seconds: 1800 } },
  { at: at(14, 10), group: { work_item: task(2, 'Read') }, spend: { seconds: 600 } },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'Fix') },
    spend: { seconds: 900 },
  },
  {
    at: new Date(2026, 10, 10, 20),
    group: { work_item: task(1, 'Fix') },
    spend: { seconds: 7200 },
  },
]

/** Two days of work under two models in two projects. */
export const DAYS: TimedStretch[] = [
  {
    at: new Date(2026, 10, 9, 10),
    group: { work_item: task(1, 'One'), model: value('model-a'), project: value('alpha') },
    spend: { seconds: 3600 },
  },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(2, 'Two'), model: value('model-b'), project: value('beta') },
    spend: { seconds: 3600 },
  },
]

export const served: Served[] = [
  ...usageServed('served/analyticsBar.ts HOUR', HOUR),
  ...usageServed('served/analyticsBar.ts TODAY', TODAY),
  ...usageServed('served/analyticsBar.ts DAYS', DAYS),
]
