/**
 * The work production-analytics-pair-names.spec.ts serves as usage.
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

/** The week so far, five pairs of three models at two efforts, largest first as `PAIRS`. */
export const WORLD: TimedStretch[] = [
  stretch(9, 'claude-opus-5-5', 'high', 4),
  stretch(9, 'claude-sonnet-5-5', 'medium', 1),
  stretch(10, 'claude-opus-5-5', 'high', 2),
  stretch(10, 'claude-opus-5-5', 'medium', 3),
  stretch(11, 'claude-sonnet-5-5', 'high', 2),
  stretch(11, 'claude-haiku-5-5', 'high', 0.5),
]

/** A model whose name is 50 characters, longer than a table's name column at any of the sizes. */
export const LONG_MODEL = 'claude-opus-5-5-with-a-rather-long-synthetic-names'
/**
 * A model whose name is shorter than the least a table's name column keeps, so it stands whole
 * at every size however much room the figures take.
 */
export const SHORT_MODEL = 'claude-5'
export const ONE_LONG: TimedStretch[] = [
  stretch(9, LONG_MODEL, 'high', 4),
  stretch(10, SHORT_MODEL, 'high', 2),
]

export const served: Served[] = [
  ...usageServed('served/analyticsPairNames.ts WORLD', WORLD),
  ...usageServed('served/analyticsPairNames.ts ONE_LONG', ONE_LONG),
]
