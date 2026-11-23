/**
 * A quota read over four weeks whose readings stand on every pixel of a step line: «Work» of
 * `quotaAt`, its five hours and its week read every few minutes, with what the store kept before
 * each. Every id, name and number is made up.
 *
 * - Its five hours: eight windows before the current one, scattered over the four weeks, the last
 *   two back to back, each read every quarter of an hour from a minute after its start to a minute
 *   before its reset, so each reset stands beside a reading; one of them, and the current one,
 *   restarted their count at a reading. The current window is read every five minutes, the latest
 *   a minute before now, so «now» stands on the latest reading, and its forecast runs out 70
 *   minutes on, inside a mark's reach of «now» on a line of four weeks.
 * - Its week: the four weeks before the current one, back to back, each read every two hours from
 *   a minute after its start to a minute before its reset, one restarted at a reading; the current
 *   week read every hour, the latest a minute before now, restarted at a reading two days ago.
 */
import type { Quota, QuotaEarlierWindow, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { momentAt } from './analytics.ts'
import { quotaAt, share } from './quota.ts'
import { earlierWindows } from './quotaHistory.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const FIVE_HOURS = 5 * HOUR
const WEEK = 7 * DAY

/** Who read a window. */
type Source = QuotaShareWindow['latest']['source']

/**
 * How far into a window each of its readings is: every `every` ms from a minute after its start,
 * and a minute before its end.
 */
function readingTimes(length: number, every: number) {
  const times: number[] = []
  for (let after = MINUTE; after < length - MINUTE; after += every) times.push(after)
  return [...times, length - MINUTE]
}

/**
 * A window's shares at `times`, rising evenly to `top`; from `restartAt`, the order of a reading,
 * the count starts again from nothing.
 */
function rising(times: readonly number[], top: number, restartAt?: number) {
  return times.map((_, index) => {
    const from = restartAt !== undefined && index >= restartAt ? restartAt : 0
    const span = Math.max(1, times.length - 1 - from)
    return Math.round(((index - from) / span) * top * 10) / 10
  })
}

/** Where each window of five hours before the current one starts, so many ms before now. */
const FIVE_HOUR_STARTS = [
  25.5 * DAY,
  21.2 * DAY,
  18.4 * DAY,
  14.3 * DAY,
  10.6 * DAY,
  7.2 * DAY,
  3.4 * DAY,
  3.4 * DAY - FIVE_HOURS,
]

/** The windows of five hours before the current one, each read every quarter of an hour. */
function fiveHoursBefore(now: number, offset: number, source: Source): QuotaEarlierWindow[] {
  const at = (ms: number) => momentAt(ms, offset)
  const times = readingTimes(FIVE_HOURS, 15 * MINUTE)
  return FIVE_HOUR_STARTS.map((ago, index) => {
    const started = now - ago
    const restartAt = index === 3 ? 10 : undefined
    const shares = rising(times, 40 + index * 7, restartAt)
    return {
      started_at: at(started),
      resets_at: at(started + FIVE_HOURS),
      readings: times.map((after, order) => ({
        at: at(started + after),
        used_percent: shares[order] ?? 0,
        source,
      })),
      restarts: restartAt === undefined ? [] : [at(started + (times[restartAt] ?? 0))],
    }
  })
}

/** Readings `ago` ms before now, oldest first, with their shares. */
const readingsAgo = (ages: readonly number[], shares: readonly number[]): [number, number][] =>
  ages.map((ago, index) => [ago, shares[index] ?? 0])

/** The four accounts of `quotaAt` as of `now`, «Work»'s five hours and week read densely. */
export function quotaDense(now: Date | number, offset = -new Date(now).getTimezoneOffset()): Quota {
  const moment = new Date(now).getTime()
  const quota = quotaAt(now, offset)
  const [work] = quota.accounts
  const windows = work?.windows ?? []
  const fiveAt = windows.findIndex((window) => window.kind === 'five_hour')
  const weekAt = windows.findIndex((window) => window.kind === 'week')
  const five = windows[fiveAt] as QuotaShareWindow | undefined
  const week = windows[weekAt] as QuotaShareWindow | undefined
  if (!work || !five || !week) throw new Error('«Work» reads its five hours and its week')

  // The current five hours started three hours ago: read every five minutes, the latest a minute
  // before now, the count restarted an hour and a half ago.
  const fiveAges = readingTimes(3 * HOUR, 5 * MINUTE).map((after) => 3 * HOUR - after)
  const fiveRestart = fiveAges.findIndex((ago) => ago <= 90 * MINUTE)
  const currentFive = share(moment, offset, {
    kind: 'five_hour',
    left: 2 * HOUR,
    source: five.latest.source,
    readings: readingsAgo(fiveAges, rising(fiveAges, 62, fiveRestart)),
    restarts: [fiveAges[fiveRestart] ?? 0],
    forecast: five.forecast,
  })
  currentFive.earlier = fiveHoursBefore(moment, offset, five.latest.source)

  // The current week started four days ago: read every hour, the latest a minute before now, the
  // count restarted two days ago.
  const weekAges = readingTimes(4 * DAY, HOUR).map((after) => 4 * DAY - after)
  const weekRestart = weekAges.findIndex((ago) => ago <= 2 * DAY)
  const currentWeek = share(moment, offset, {
    kind: 'week',
    left: 3 * DAY,
    source: week.latest.source,
    readings: readingsAgo(weekAges, rising(weekAges, 41, weekRestart)),
    restarts: [weekAges[weekRestart] ?? 0],
    forecast: week.forecast,
  })
  const weekTimes = readingTimes(WEEK, 2 * HOUR)
  currentWeek.earlier = earlierWindows(
    Date.parse(currentWeek.started_at ?? ''),
    offset,
    { kind: 'week', source: week.latest.source },
    [55, 71, 63, 88].map((top, index) => {
      const restartAt = index === 1 ? 40 : undefined
      const shares = rising(weekTimes, top, restartAt)
      return {
        readings: weekTimes.map((after, order): [number, number] => [after, shares[order] ?? 0]),
        restarts: restartAt === undefined ? [] : [weekTimes[restartAt] ?? 0],
      }
    }),
  )
  work.windows = windows.map((window, index) => {
    if (index === fiveAt) return currentFive
    return index === weekAt ? currentWeek : window
  })
  return quota
}
