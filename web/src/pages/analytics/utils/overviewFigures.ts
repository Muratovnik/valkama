/**
 * The figures the overview of the Analytics page adds to the rest of the page, kept apart from
 * the words so a test can hold every number: when a rise is too steep for a share to mean
 * anything, which values moved most from the period before, and which period before the chart
 * outlines column by column.
 */
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { named } from '@/pages/analytics/utils/readMoments.ts'
import { figureOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { ComparedLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'

/**
 * A rise to this many times its base or more is said from the base it rose from, «from 2 min»,
 * and not as a share: a thousand percent says less than the two minutes it grew out of.
 */
const LITTLE_BASE = 10

/** Whether a figure rose from a base too little for a share: something before, and ten times it now. */
export function risenFromLittle(measure: Measure, now: Spent, before: Spent): boolean {
  const at = figureOf(measure, now)
  const was = figureOf(measure, before)
  return at !== null && was !== null && was > 0 && at >= LITTLE_BASE * was
}

/** A value that moved, and by how much, in the measure's own units: up above zero, down under. */
export interface MovedLine {
  by: number
  line: ComparedLine
}

/** How many values each way the overview names: the few that explain most of a change. */
const MOST_MOVED = 3

/**
 * The values that moved most from the period before, by the amount in the measure's own units
 * and not by share, so a large task that grew a little outranks a small one that doubled: up to
 * three that rose, the largest rise first, and up to three that fell, the largest fall first. A
 * value with no figure on either side, or one that stayed the same by the tiles' own rule, moved
 * by nothing anybody can say. None moves when the period before was not read.
 */
export function mostMoved(
  lines: readonly ComparedLine[],
  measure: Measure,
): { down: MovedLine[]; up: MovedLine[] } {
  const moved = lines.flatMap((line): MovedLine[] => {
    if (!line.before || !line.change) return []
    const { direction } = line.change
    if (direction === 'absent' || direction === 'same') return []
    const at = figureOf(measure, line.now) ?? 0
    const was = figureOf(measure, line.before) ?? 0
    return at === was ? [] : [{ line, by: at - was }]
  })
  const order = (left: MovedLine, right: MovedLine) =>
    Math.abs(right.by) - Math.abs(left.by) || (left.line.key < right.line.key ? -1 : 1)
  return {
    up: moved
      .filter((one) => one.by > 0)
      .sort(order)
      .slice(0, MOST_MOVED),
    down: moved
      .filter((one) => one.by < 0)
      .sort(order)
      .slice(0, MOST_MOVED),
  }
}

const DAY = 86_400_000
const OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/u

/** A moment of the read moved back by whole days on its own offset's calendar, as the read writes it. */
function daysBack(moment: string, days: number) {
  const offset = OFFSET.exec(moment)?.[0] ?? 'Z'
  const wall = new Date(named(moment).getTime() - days * DAY).toISOString().slice(0, 19)
  return `${wall}${offset}`
}

/**
 * The period the chart outlines behind an answer, step for step on the same offset, so each of its
 * steps stands behind the step it is compared with: the hours of the day before a single day, the
 * same days of the week before this week, and for any other period the as many days right before
 * it. Its end is the answer's end moved back as far, so a period still running is held against
 * the same part of its own, and its last step is no fall.
 */
export function periodBefore(usage: Usage, weekly: boolean): PeriodBounds {
  const { period } = usage
  let days = usage.series.length
  if (weekly) days = 7
  else if (period.step === 'hour') days = 1
  return {
    from: daysBack(period.from, days),
    to: daysBack(period.to, days),
    utcOffset: period.utc_offset,
  }
}
