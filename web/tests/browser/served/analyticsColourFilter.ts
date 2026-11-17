/**
 * The work production-analytics-colour-filter.spec.ts serves as usage.
 */
import { value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const HOUR = 3600
export const at = (day: number) => new Date(2026, 10, day, 10)

export const OPUS = 'claude-opus-5-5'
export const SONNET = 'claude-sonnet-5-5'
export const HAIKU = 'claude-haiku-5-5'
export const MINI = 'claude-mini-5-5'

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
 * The week so far: claude-opus-5-5 6 h, all at high effort; claude-sonnet-5-5 5 h, 3 h of it at
 * medium; claude-haiku-5-5 2 h 30 min, 1 h 30 min at medium; claude-mini-5-5 half an hour at
 * medium. By the pair, six pairs, the smallest claude-mini-5-5 · medium.
 */
export const WORLD: TimedStretch[] = [
  stretch(9, OPUS, 'high', 4),
  stretch(10, OPUS, 'high', 2),
  stretch(9, SONNET, 'medium', 2),
  stretch(11, SONNET, 'medium', 1),
  stretch(10, SONNET, 'high', 2),
  stretch(10, HAIKU, 'medium', 1.5),
  stretch(11, HAIKU, 'high', 1),
  stretch(11, MINI, 'medium', 0.5),
]

export const served: Served[] = [...usageServed('served/analyticsColourFilter.ts WORLD', WORLD)]
