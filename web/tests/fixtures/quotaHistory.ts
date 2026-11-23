/**
 * What the quota read answers over a period: the windows the store kept before each current one
 * (`earlier`), as the server gives them over the period's start. Every id, name and number is made
 * up, those of the four accounts of `quotaAt`.
 */
import type { Quota, QuotaEarlierWindow, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { momentAt } from './analytics.ts'
import { quotaAt } from './quota.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const FIVE_HOURS = 5 * HOUR
const WEEK = 7 * DAY

/** A window before a current one: its readings and restarts, each so many ms after its start. */
interface Before {
  readings: [after: number, percent: number][]
  restarts?: number[]
}

/**
 * The windows before a current one that started at `start`, back to back and oldest first, as the
 * answer's `earlier` gives them: each whole from its start to its reset, its readings read by
 * `source`, the last of them reset where the current one starts.
 */
export function earlierWindows(
  start: number,
  offset: number,
  {
    kind,
    source,
  }: Pick<QuotaShareWindow, 'kind'> & { source: QuotaShareWindow['latest']['source'] },
  windows: Before[],
): QuotaEarlierWindow[] {
  const at = (ms: number) => momentAt(ms, offset)
  const length = kind === 'five_hour' ? FIVE_HOURS : WEEK
  return windows.map(({ readings, restarts = [] }, index) => {
    const started = start - (windows.length - index) * length
    return {
      started_at: at(started),
      resets_at: at(started + length),
      readings: readings.map(([after, percent]) => ({
        at: at(started + after),
        used_percent: percent,
        source,
      })),
      restarts: restarts.map((after) => at(started + after)),
    }
  })
}

/**
 * The four accounts as of `now`, with what the store kept of the weeks before it: «Work»'s week
 * holds the four weeks before the current one, the last of them run out and its count restarted
 * once in the one before, and says how the last ended (`previous`); its five hours hold three
 * windows before the current one, the last ending where the current one starts. Its model's week
 * keeps nothing before the current one. The answer's `earlier` is every one of them; the quota read
 * gives only those that reset after the period's start (`servedOver`).
 */
export function quotaWithHistory(
  now: Date | number,
  offset = -new Date(now).getTimezoneOffset(),
): Quota {
  const quota = quotaAt(now, offset)
  const [work] = quota.accounts
  const [five, week] = (work?.windows ?? []).filter(isShare)
  if (!five || !week) throw new Error('«Work» reads its five hours and its week')
  week.earlier = earlierWindows(
    Date.parse(week.started_at ?? ''),
    offset,
    { kind: week.kind, source: week.latest.source },
    [
      {
        readings: [
          [DAY, 6],
          [3 * DAY, 18],
          [6 * DAY, 27],
        ],
      },
      {
        readings: [
          [12 * HOUR, 9],
          [2 * DAY, 30],
          [4 * DAY, 12],
          [6 * DAY, 44],
        ],
        restarts: [4 * DAY],
      },
      {
        readings: [
          [2 * DAY, 20],
          [5 * DAY, 63],
          [6.5 * DAY, 71],
        ],
      },
      {
        readings: [
          [HOUR, 15],
          [3 * DAY, 58],
          [5 * DAY, 100],
        ],
      },
    ],
  )
  const last = week.earlier.at(-1)
  week.previous = last
    ? {
        started_at: last.started_at,
        resets_at: last.resets_at,
        latest: last.readings.at(-1) ?? week.latest,
        ran_out: true,
      }
    : null
  five.earlier = earlierWindows(
    Date.parse(five.started_at ?? ''),
    offset,
    { kind: five.kind, source: five.latest.source },
    [
      {
        readings: [
          [HOUR, 20],
          [4 * HOUR, 48],
        ],
      },
      {
        readings: [
          [30 * MINUTE, 12],
          [3 * HOUR, 64],
        ],
      },
      {
        readings: [
          [2 * HOUR, 30],
          [4.5 * HOUR, 81],
        ],
      },
    ],
  )
  return quota
}

const isShare = (
  window: Quota['accounts'][number]['windows'][number],
): window is QuotaShareWindow => 'readings' in window

/**
 * The answer the quota read at `address` gives, over the period that starts at its `from`, as the
 * server reads it: each window keeps the windows before it that reset after `from`; with no
 * period, none.
 */
export function servedOver(quota: Quota, address: string): Quota {
  const from = new URL(address).searchParams.get('from')
  const since = from === null ? null : Date.parse(from)
  return {
    ...quota,
    accounts: quota.accounts.map((account) => ({
      ...account,
      windows: account.windows.map((window) => {
        if (!isShare(window) || window.earlier === undefined) return window
        const { earlier, ...rest } = window
        return since === null
          ? rest
          : { ...rest, earlier: earlier.filter((one) => Date.parse(one.resets_at) > since) }
      }),
    })),
  }
}
