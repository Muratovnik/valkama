/**
 * The work production-analytics-split-by.spec.ts serves as usage.
 */
import { value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const HOUR = 3600
export const at = (day: number) => new Date(2026, 10, day, 10)

/** One stretch of a model at an effort, `hours` long, on a day of November. */
export const stretch = (
  day: number,
  model: string,
  effort: string,
  hours: number,
): TimedStretch => ({
  at: at(day),
  group: { model: value(model), effort: value(effort) },
  spend: { seconds: hours * HOUR },
})

/**
 * The week so far, five pairs in 12 h 30 min: claude-opus-5-5 at high effort 6 h over Monday and
 * Tuesday, at medium 3 h; claude-sonnet-5-5 at high 2 h and at medium 1 h; claude-haiku-5-5 at
 * high half an hour. The Monday before, an hour of claude-opus-5-5 at high, to compare with.
 */
export const WORLD: TimedStretch[] = [
  stretch(9, 'claude-opus-5-5', 'high', 4),
  stretch(9, 'claude-sonnet-5-5', 'medium', 1),
  stretch(10, 'claude-opus-5-5', 'high', 2),
  stretch(10, 'claude-opus-5-5', 'medium', 3),
  stretch(11, 'claude-sonnet-5-5', 'high', 2),
  stretch(11, 'claude-haiku-5-5', 'high', 0.5),
  stretch(2, 'claude-opus-5-5', 'high', 1),
]

export const served: Served[] = [...usageServed('served/analyticsSplitBy.ts WORLD', WORLD)]
