/**
 * When the open part of a chain closes, if the last few days are any guide.
 *
 * The basis is the answer's `recent` window — seven UTC days, today included —
 * and nothing longer, so the forecast and the counts printed beside it are the
 * same numbers. Over that window the open part shrinks by what closed minus
 * what was added; divided into what is open, that is how many days are left.
 *
 * A pace read off seven days is rough, and the result says how rough. Each day
 * of the window has its own net (closed minus added, zero on a day nothing
 * changed); their spread gives the standard error of the mean pace. When that
 * error is a large share of the pace, the forecast is a range — the days at the
 * pace plus one error to the days at the pace minus one — and when the slow end
 * of it is no pace at all, the range has no end. Everything is rounded outward,
 * to whole days, so no bound is more exact than its basis.
 *
 * The cases the arithmetic has to answer, each with its own result:
 *
 * - Nothing open: there is nothing to forecast (`none`).
 * - History shorter than the window, a chain of a single day included when that
 *   day is recent: every member was added inside the window, so "added faster
 *   than closed" says only that the chain is new (`young`).
 * - Nothing added and nothing closed in the window (`quiet`).
 * - As much added as closed, or more: the open part does not shrink, and the
 *   pace to beat is the pace of new work (`steady`, `growing`). Nothing closed at
 *   all is the plain case of this.
 * - More closed than added (`converging`).
 *
 * An epic's scope is its own children, read the same way: the arithmetic does
 * not change, only the word for new work does, and that is the wording's choice.
 *
 * Pure on purpose: `today` is an argument, so a test can stand on any date.
 */

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'

/** What the arithmetic needs of a chain answer. */
type ForecastInput = Pick<WorkItemChain, 'open' | 'recent' | 'series'>

export type ChainForecast =
  /** More closed than added: done in `low` to `high` days, or `low` and more when `high` is null. */
  | { high: number | null; kind: 'converging'; low: number }
  /** History shorter than the window: `days` of it so far. */
  | { days: number; kind: 'young' }
  /** The open part grows (`growing`) or holds (`steady`) unless more than `needed` close a day. */
  | { kind: 'growing' | 'steady'; needed: number }
  | { kind: 'none' }
  | { kind: 'quiet' }

/**
 * The share of the pace its standard error may reach before a single figure
 * would claim more than seven days can say. At a quarter, the two ends of the
 * range stand about two thirds apart.
 */
const NOISE = 0.25

const DAY_MS = 86_400_000

/** Whole days from one `YYYY-MM-DD` day to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** The day `count` days after `day`, as `YYYY-MM-DD`. */
export function dayAfter(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10)
}

/** Each day of the window's net: what closed that day minus what was added. */
function dailyNets(series: ForecastInput['series'], today: string, window: number): number[] {
  const nets = Array.from({ length: window }, () => 0)
  const first = dayAfter(today, 1 - window)
  for (const day of series) {
    const offset = daysBetween(first, day.day)
    if (offset >= 0 && offset < window) nets[offset] += day.closed - day.created
  }
  return nets
}

/** The standard error of the mean of `values`: their sample spread over the root of their count. */
function standardError(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const square = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  return Math.sqrt(square / (values.length - 1) / values.length)
}

function converging(open: number, pace: number, error: number): ChainForecast {
  if (error / pace <= NOISE) {
    const days = Math.max(1, Math.round(open / pace))
    return { kind: 'converging', low: days, high: days }
  }
  const low = Math.max(1, Math.floor(open / (pace + error)))
  const slow = pace - error
  return { kind: 'converging', low, high: slow > 0 ? Math.ceil(open / slow) : null }
}

/**
 * How many days of history a chain has on `today`, its first day and today
 * included, or null when it has none — which is what decides whether the
 * window holds days before the chain began.
 */
export function historyDays(series: ForecastInput['series'], today: string): number | null {
  const first = series[0]?.day
  return first === undefined ? null : Math.max(1, daysBetween(first, today) + 1)
}

/**
 * The forecast for a chain on `today` (`YYYY-MM-DD`, UTC — the calendar the
 * answer's days are written in).
 */
export function forecastChain(chain: ForecastInput, today: string): ChainForecast {
  const history = historyDays(chain.series, today)
  if (chain.open === 0 || history === null) return { kind: 'none' }
  const window = chain.recent.days
  if (history < window) return { kind: 'young', days: history }
  const { created, closed } = chain.recent
  if (created === 0 && closed === 0) return { kind: 'quiet' }
  if (created >= closed)
    return { kind: created > closed ? 'growing' : 'steady', needed: created / window }
  const error = standardError(dailyNets(chain.series, today, window))
  return converging(chain.open, (closed - created) / window, error)
}

/**
 * A converging forecast said in the unit its size deserves: `low` to `high`
 * units, one figure when they are equal, and `low` and more when `high` is null.
 */
export interface ForecastSpan {
  high: number | null
  low: number
  unit: 'day' | 'month' | 'week'
}

/** Beyond two weeks a day is false precision, and beyond two months a week is. */
const WEEKS_FROM = 14
const MONTHS_FROM = 63
/** Past a year, seven days of pace say nothing worth a number. */
const YEAR = 365
const UNIT_DAYS = { day: 1, week: 7, month: 30 } as const

/** The unit a span of this many days is said in. */
function unitOf(days: number): ForecastSpan['unit'] {
  if (days < WEEKS_FROM) return 'day'
  return days < MONTHS_FROM ? 'week' : 'month'
}

/**
 * Days as days, weeks or months, chosen by the far end. A single figure rounds
 * to the nearest whole unit and a range rounds outward. A far end past a year
 * is no far end; a near end past a year is no forecast, and the answer is null.
 */
export function forecastSpan(low: number, high: number | null): ForecastSpan | null {
  if (low > YEAR) return null
  const far = high === null || high > YEAR ? null : high
  const unit = unitOf(far ?? low)
  const size = UNIT_DAYS[unit]
  if (far === low) {
    const count = Math.max(1, Math.round(low / size))
    return { unit, low: count, high: count }
  }
  const near = Math.max(1, Math.floor(low / size))
  return { unit, low: near, high: far === null ? null : Math.max(near, Math.ceil(far / size)) }
}
