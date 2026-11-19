/**
 * What the quota's tiles and panel take from the quota read: each section's windows of an
 * account, the tightest of them across accounts, and what a window's forecast draws.
 *
 * A section of the quota is its five hours, or its week with each model's week beside it. A
 * window counts toward the tightest only while it stands: its reset is still ahead, or it has
 * named none. Of those the tightest is the one nearest its limit by its forecast (`tightest`):
 * one that runs out before its reset first, the earliest run-out first (`runOut`); then the one
 * whose forecast ends highest at the reset; then the one most spent, and a window with no forecast
 * ranks by its share after those with one. At the same share a fresh one stands before a silent
 * one, judged at the panel's moment (`stateAt`), then the first in the answer's order. Its figure
 * is one account's share of one window, said as it is: nothing here adds two windows or two
 * accounts.
 *
 * A forecast is drawn from one mapping (`forecastCourses`), so the bar's tail, the tile's, the
 * step line's corridor and their words never disagree: two edges from the share spent at the
 * answer's moment to the reset, a week's slower and faster pace, the five hours' one outcome as
 * both: to the share it spends by the reset where it lasts, to 100 % where it runs out. Neither passes 100 %, which a quota cannot: an edge that would runs on flat from where it
 * reaches it, as the words say a range that reaches 100 % (`useQuotaWords`).
 */
import { momentAtOffset } from '@/pages/analytics/utils/readMoments.ts'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import { isShareWindow } from '@/shared/api/analyticsApi.ts'
import type {
  Quota,
  QuotaAccount,
  QuotaShareWindow,
  QuotaWindow,
} from '@/shared/api/analyticsApi.ts'

/** The windows a section of the quota shows. */
const SECTION_KINDS: Record<QuotaSection, readonly QuotaShareWindow['kind'][]> = {
  quota_five_hour: ['five_hour'],
  quota_week: ['week', 'week_model'],
}

/** An account's windows of a section, in the answer's order: the week, then each model's. */
export const sectionWindows = (account: QuotaAccount, section: QuotaSection) =>
  account.windows
    .filter(isShareWindow)
    .filter((window) => SECTION_KINDS[section].includes(window.kind))

/** An account's windows of money spent past a limit, which carry a state and no figure. */
export const spendWindows = (account: QuotaAccount) =>
  account.windows.filter((window) => !isShareWindow(window))

/** Whether a window still stands at `now` (ms): its reset ahead, or none named. */
export const stands = (window: QuotaWindow, now: number) =>
  window.resets_at === null || Date.parse(window.resets_at) > now

/**
 * A window's state at `now` (ms): fresh while its latest reading is at most `freshFor` seconds
 * old, silent once it is older. The threshold is the answer's own, `fresh_for_seconds`, the rule
 * the server judged `state` by; that `state` is true at the moment the server answered, so a
 * panel left open past the threshold would go on calling a reading fresh. Judged by the panel's
 * moment, as a reset that has passed is (`stands`).
 */
export const stateAt = (
  window: QuotaWindow,
  now: number,
  freshFor: number,
): QuotaWindow['state'] =>
  now - Date.parse(window.latest.at) <= freshFor * 1000 ? 'fresh' : 'silent'

/**
 * When a week's slower pace spends the window, in ms: the range's low end is what that pace
 * spends by the reset, from the window's share at the answer's moment `now`, so it reaches 100 %
 * that share of the way along. Null where it names no time: no reset ahead of `now`, or a low end
 * no higher than what is spent already.
 */
export function runsOutAt(window: QuotaShareWindow, low: number, now: number): number | null {
  const used = window.latest.used_percent
  if (window.resets_at === null || low <= used) return null
  const left = Date.parse(window.resets_at) - now
  return left > 0 ? now + ((100 - used) / (low - used)) * left : null
}

/**
 * Where five hours that last to the reset stand by then: the share their answer says the pace
 * spends (`at_reset_percent`), never below the share spent already, as the drawing and the words
 * both take it.
 */
export function lastingEnd(window: QuotaShareWindow): number {
  const used = window.latest.used_percent
  const found = window.forecast
  const named = found && 'at_reset_percent' in found ? found.at_reset_percent : null
  return Math.max(used, named ?? used)
}

/** An edge of a forecast: the share at each moment it turns, from the answer's moment to the reset. */
type ForecastCourse = { at: number; value: number }[]

/**
 * A window's forecast as two edges from its share at the answer's moment `now` (ms) to its reset:
 * a week's slower pace (`low`) and faster (`high`), each from the range's end it reaches by the
 * reset and, past 100 %, flat from when its pace spends the window (`runsOutAt`); the five hours'
 * one outcome as both: lasting, straight to the share it spends by the reset
 * (`at_reset_percent`), running out, to 100 % at its `runs_out_at` and flat on; a window spent,
 * or read past 100 %, flat where it stands. Null where nothing is drawn: no forecast, or no reset
 * ahead of `now`.
 */
export function forecastCourses(
  window: QuotaShareWindow,
  now: number,
): { high: ForecastCourse; low: ForecastCourse } | null {
  const found = window.forecast
  if (!found || window.resets_at === null) return null
  const reset = Date.parse(window.resets_at)
  if (reset <= now) return null
  const used = window.latest.used_percent
  const flat = (value: number) => [
    { at: now, value },
    { at: reset, value },
  ]
  /** From the share spent straight to `value` at the reset, or, at 100 % or past it, to 100 % at `at` and flat on. */
  const toward = (value: number, at: number | null) =>
    at === null || value < 100
      ? [
          { at: now, value: used },
          { at: reset, value: Math.min(100, value) },
        ]
      : [{ at: now, value: used }, { at, value: 100 }, ...flat(100).slice(1)]
  if (used >= 100) return { high: flat(used), low: flat(used) }
  if ('low_percent' in found) {
    const edge = (end: number) => toward(Math.max(used, end), runsOutAt(window, end, now))
    return { high: edge(found.high_percent), low: edge(found.low_percent) }
  }
  if (found.outcome === 'spent') return { high: flat(100), low: flat(100) }
  if (found.outcome === 'lasts') {
    const course = toward(lastingEnd(window), null)
    return { high: course, low: course }
  }
  if (found.runs_out_at === null) return null
  const course = toward(100, Math.min(reset, Math.max(now, Date.parse(found.runs_out_at))))
  return { high: course, low: course }
}

/** Where a forecast's edges leave the window at its reset: the hatched tail of its bar. */
export const forecastEnds = (courses: ReturnType<typeof forecastCourses>) =>
  courses ? { low: courses.low.at(-1)?.value ?? 0, high: courses.high.at(-1)?.value ?? 0 } : null

/**
 * The answer's moment at its own offset, as its other moments are written: the words say every
 * time at the offset of the moment they are given as the answer's and date it against that
 * moment's day (`useQuotaWords`). The answer's `now` is held in UTC (`analyticsApi`), so given as
 * it is, a run-out would be said on UTC's clock and every time dated against UTC's day.
 */
export const answerMoment = (quota: Quota) =>
  momentAtOffset(Date.parse(quota.now), quota.utc_offset)

/** One window of one account. */
export interface QuotaPick {
  account: QuotaAccount
  window: QuotaShareWindow
}

/**
 * When a window's forecast says it runs out before its reset, in ms, from the answer's moment
 * `at`, as its words say it (`useQuotaWords`): five hours at their `runs_out_at`; a week whose
 * range's low end reaches 100 % when its slower pace spends it (`runsOutAt`), or at its reset where
 * that pace names no time; a window spent already, or read at 100 % or past it, at `at`. Null where
 * the forecast says it lasts to the reset, and where there is no forecast.
 */
export function runOut(window: QuotaShareWindow, at: number): number | null {
  const found = window.forecast
  if (!found) return null
  if (window.latest.used_percent >= 100) return at
  if ('low_percent' in found) {
    if (found.low_percent < 100) return null
    const reset =
      window.resets_at === null ? Number.POSITIVE_INFINITY : Date.parse(window.resets_at)
    return runsOutAt(window, found.low_percent, at) ?? reset
  }
  if (found.outcome === 'spent') return at
  return found.runs_out_at === null ? null : Date.parse(found.runs_out_at)
}

/** Where a window's forecast leaves it at the reset: a week's high end, five hours that last. */
function forecastTop(window: QuotaShareWindow): number {
  const found = window.forecast
  const used = window.latest.used_percent
  if (!found) return used
  if ('low_percent' in found) return Math.max(used, found.high_percent)
  return found.outcome === 'lasts' ? lastingEnd(window) : 100
}

/**
 * Whether window `one` stands nearer its limit than `other`, its forecast taken at the answer's
 * moment `at`: one with a forecast before one with none; of those with one, one that runs out
 * before its reset before one that lasts, the earlier run-out first, then the higher end at the
 * reset; then the higher share, and at the same share a fresh one (`fresh`) before a silent one.
 * Neither, where they are alike.
 */
function nearer(
  one: QuotaShareWindow,
  other: QuotaShareWindow,
  at: number,
  fresh: (window: QuotaWindow) => boolean,
): boolean {
  const forecast = one.forecast !== null
  if (forecast !== (other.forecast !== null)) return forecast
  if (forecast) {
    const [oneOut, otherOut] = [runOut(one, at), runOut(other, at)]
    if ((oneOut === null) !== (otherOut === null)) return oneOut !== null
    if (oneOut !== null && otherOut !== null && oneOut !== otherOut) return oneOut < otherOut
    const [oneTop, otherTop] = [forecastTop(one), forecastTop(other)]
    if (oneTop !== otherTop) return oneTop > otherTop
  }
  const [oneUsed, otherUsed] = [one.latest.used_percent, other.latest.used_percent]
  return oneUsed === otherUsed ? fresh(one) && !fresh(other) : oneUsed > otherUsed
}

/**
 * The window of a section nearest its limit across accounts (`nearer`), its forecast taken at the
 * answer's moment, and whether it stands and is fresh at the panel's `now` (ms); null where none
 * stands.
 */
export function tightest(quota: Quota, section: QuotaSection, now: number): QuotaPick | null {
  const fresh = (one: QuotaWindow) => stateAt(one, now, quota.fresh_for_seconds) === 'fresh'
  const answered = Date.parse(quota.now)
  let found: QuotaPick | null = null
  for (const account of quota.accounts)
    for (const window of sectionWindows(account, section)) {
      if (!stands(window, now)) continue
      if (!found || nearer(window, found.window, answered, fresh)) found = { account, window }
    }
  return found
}

/**
 * The account in use where it reports no five-hour window: no account's five hours stand at `now`
 * (ms), and the account of the answer's newest reading, of any window, has a week standing whose
 * latest reading is inside it and no five-hour reading since that week started. A source sends a
 * five-hour window only for a plan that has one, so the five hours of the other accounts reset and
 * read as a failure of the read. Null otherwise, and where the newest account's own five hours
 * reset inside its week: that window says it reset.
 */
export function withoutFiveHours(quota: Quota, now: number): QuotaAccount | null {
  const standing = quota.accounts.some((account) =>
    sectionWindows(account, 'quota_five_hour').some((window) => stands(window, now)),
  )
  if (standing) return null
  let newest: { account: QuotaAccount; at: number } | null = null
  for (const account of quota.accounts)
    for (const window of account.windows) {
      const at = Date.parse(window.latest.at)
      if (!newest || at > newest.at) newest = { account, at }
    }
  if (!newest) return null
  const { account } = newest
  const week = account.windows
    .filter(isShareWindow)
    .find((window) => window.kind === 'week' && stands(window, now))
  if (!week) return null
  const start = week.started_at === null ? Number.NEGATIVE_INFINITY : Date.parse(week.started_at)
  if (Date.parse(week.latest.at) < start) return null
  const fiveHours = sectionWindows(account, 'quota_five_hour').some(
    (window) => Date.parse(window.latest.at) >= start,
  )
  return fiveHours ? null : account
}

/** A window's key among an account's: its kind, and a model's week by its model. */
export const windowKey = (window: QuotaWindow) =>
  window.model === null ? window.kind : `${window.kind}:${window.model}`

/** An account's key among the answer's: its id, as the `seat` dimension gives it. */
export const accountKey = (account: QuotaAccount) => account.account
