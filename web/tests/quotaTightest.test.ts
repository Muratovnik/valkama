/**
 * Which window of a section the quota's tile names, held to DESIGN.md § Analytics rather than to
 * the code: of the windows still standing, the one nearest its limit by its forecast — first one
 * whose forecast runs out before its reset, the earliest run-out first; then the one whose forecast
 * ends highest at the reset; then the one most spent. A window with no forecast ranks by its share
 * after every window that has one. The share alone once chose, and named an account at 72 % whose
 * week ended at 81 % over one at 6 % that ran out before its reset.
 *
 * Every id and figure is made up. A week's run-out is its slower pace's: from its share at the
 * answer's moment to the low end of its range at the reset, 100 % that share of the way along.
 */
import { describe, expect, it } from 'vitest'

import { runOut, tightest } from '@/pages/analytics/utils/quotaFigures.ts'

import type { Quota, QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { share } from './fixtures/quota.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 10, 19, 10)
const OFFSET = 180

/** A week at `used` % read five minutes ago, its reset `left` ms on, with its range or none. */
const week = (used: number, left: number, range: [low: number, high: number] | null) =>
  share(NOW, OFFSET, {
    kind: 'week',
    left,
    source: 'poll',
    readings: [[5 * MINUTE, used]],
    forecast: range && { low_percent: range[0], high_percent: range[1] },
  })

/** Five hours at `used` % read five minutes ago, resetting two hours on, that run out `in` ms on. */
const fiveHours = (used: number, runsOutIn: number | null): QuotaShareWindow =>
  share(NOW, OFFSET, {
    kind: 'five_hour',
    left: 2 * HOUR,
    source: 'poll',
    readings: [[5 * MINUTE, used]],
    forecast:
      runsOutIn === null
        ? { outcome: 'lasts', runs_out_at: null, at_reset_percent: used + 10, basis: 'window' }
        : {
            outcome: 'runs_out',
            runs_out_at: new Date(NOW + runsOutIn).toISOString(),
            at_reset_percent: null,
            basis: 'recent',
          },
  })

/** An account by `name`, made-up ids from it, holding `windows`. */
function account(name: string, windows: QuotaShareWindow[]): QuotaAccount {
  const organization = `${name}-org`
  return {
    organization,
    account_uuid: `${name}-id`,
    account: `${organization}/${name}-id`,
    weekly_reset: null,
    shared: false,
    plan: null,
    name,
    organization_name: null,
    no_source: false,
    windows,
  }
}

const quota = (...accounts: QuotaAccount[]): Quota => ({
  now: new Date(NOW).toISOString(),
  utc_offset: OFFSET,
  fresh_for_seconds: 900,
  retained_from: new Date(NOW - 365 * DAY).toISOString(),
  accounts,
})

/** The name of the account whose week the week's tile names. */
const weekTile = (...accounts: QuotaAccount[]) =>
  tightest(quota(...accounts), 'quota_week', NOW)?.account.name

describe('the window a quota tile names', () => {
  it('is one that runs out before its reset over one more spent that lasts', () => {
    // 6 % now, 120 % to 140 % by a reset three days on: its slower pace spends it before then.
    const early = account('Early', [week(6, 3 * DAY, [120, 140])])
    // 72 % now, 78 % to 81 % by a reset half a day on: it lasts.
    const spent = account('Spent', [week(72, 12 * HOUR, [78, 81])])
    expect(weekTile(spent, early)).toBe('Early')
    expect(weekTile(early, spent)).toBe('Early')
  })

  it('is the earlier run-out of two that both run out', () => {
    // From 50 % to 150 % by a reset 40 h on, 100 % halfway: 20 h on.
    const later = account('Later', [week(50, 40 * HOUR, [150, 160])])
    // From 10 % to 190 % by a reset 36 h on, 100 % at half the way: 18 h on, though less spent.
    const sooner = account('Sooner', [week(10, 36 * HOUR, [190, 200])])
    expect(runOut(sooner.windows[0] as QuotaShareWindow, NOW)).toBe(NOW + 18 * HOUR)
    expect(runOut(later.windows[0] as QuotaShareWindow, NOW)).toBe(NOW + 20 * HOUR)
    expect(weekTile(later, sooner)).toBe('Sooner')
    expect(weekTile(sooner, later)).toBe('Sooner')

    // Five hours that run out forty minutes on stand before ones that run out in an hour.
    const five = (name: string, used: number, runsOutIn: number) =>
      account(name, [fiveHours(used, runsOutIn)])
    const pick = (...accounts: QuotaAccount[]) =>
      tightest(quota(...accounts), 'quota_five_hour', NOW)?.account.name
    expect(pick(five('Hour', 80, HOUR), five('Forty', 40, 40 * MINUTE))).toBe('Forty')
  })

  it('is the higher forecast end of two that last, whatever each has spent', () => {
    const higher = account('Higher', [week(30, 3 * DAY, [70, 95])])
    const lower = account('Lower', [week(60, DAY, [70, 80])])
    expect(weekTile(lower, higher)).toBe('Higher')
    expect(weekTile(higher, lower)).toBe('Higher')
  })

  it('is the more spent of two with no forecast, after any with one', () => {
    const more = account('More', [week(40, 3 * DAY, null)])
    const less = account('Less', [week(20, 3 * DAY, null)])
    expect(weekTile(less, more)).toBe('More')
    expect(weekTile(more, less)).toBe('More')
    // A window with a forecast outranks both, though it has spent less than either.
    const forecast = account('Forecast', [week(5, 3 * DAY, [10, 12])])
    expect(weekTile(more, less, forecast)).toBe('Forecast')
  })

  it('is never a window past its reset, whatever its forecast said', () => {
    const ended = account('Ended', [week(6, -HOUR, [120, 140])])
    const standing = account('Standing', [week(30, DAY, [40, 50])])
    expect(weekTile(ended, standing)).toBe('Standing')
    expect(weekTile(ended)).toBeUndefined()
  })
})
