/**
 * The quota read's answer that holds every row of the decision table for a window card's step line
 * over the page's period (DESIGN.md, Analytics, the quota's panel), as of a moment on a Wednesday
 * afternoon. «A week» is seven days, and the weeks reset in the middle of a week. Every id, name and
 * number is made up.
 *
 * - «Alpha»: five hours at 62 %, started three hours before now, with three windows before it, two
 *   of them today; a live week that started a day before now and resets in six, so «This week»,
 *   from Monday's midnight, starts in the week before it, with the five weeks before it back to
 *   back, the count of the fourth back restarted inside it; and a model's week with no reading since its last reset, which is the live week's start:
 *   its last window and the two before that, each with readings.
 * - «Beta»: a live week on another reset, started five days and three hours before now, with four
 *   weeks before it, the first of them ending at 0 %, so its reset falls from 0 % to 0 %.
 * - «Gamma»: a week with no reading since its reset two days before now, and two weeks before it;
 *   no window of the account has a reading since its reset.
 *
 * Each window holds as `earlier` every window the store kept before it; the quota read gives only
 * those that reset after the period's start (`servedOver`).
 */
import type { Quota, QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { momentAt } from './analytics.ts'
import { share } from './quota.ts'
import { earlierWindows } from './quotaHistory.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The moments of the table, so many ms from now, independent of the page. */
export const TABLE = {
  /** «Alpha»'s live week: its start and its reset. */
  alphaStart: -DAY,
  alphaReset: 6 * DAY,
  /** «Alpha»'s model week: its last window's reset, the live week's start. */
  modelReset: -DAY,
  /** «Beta»'s live week: its start and its reset. */
  betaStart: -(5 * DAY + 3 * HOUR),
  betaReset: 2 * DAY - 3 * HOUR,
  /** «Gamma»'s week: its last reset. */
  gammaReset: -2 * DAY,
  /** «Alpha»'s five hours: their start and their reset. */
  fiveStart: -3 * HOUR,
  fiveReset: 2 * HOUR,
} as const

/** An earlier week: its readings as (days after its start, percent) and its restarts in days. */
const week = (readings: [number, number][], restarts: number[] = []) => ({
  readings: readings.map(([days, percent]): [number, number] => [days * DAY, percent]),
  restarts: restarts.map((days) => days * DAY),
})

/** A window with its earlier windows and how the last of them ended (`previous`). */
function withEarlier(
  window: QuotaShareWindow,
  offset: number,
  earlier: ReturnType<typeof week>[],
): QuotaShareWindow {
  const before = earlierWindows(
    Date.parse(window.started_at ?? ''),
    offset,
    { kind: window.kind, source: window.latest.source },
    earlier,
  )
  const last = before.at(-1)
  return {
    ...window,
    earlier: before,
    previous: last
      ? {
          started_at: last.started_at,
          resets_at: last.resets_at,
          latest: last.readings.at(-1) ?? window.latest,
          ran_out: last.readings.some((one) => one.used_percent >= 100),
        }
      : null,
  }
}

/** A window past its reset by now: nothing paces it and nothing forecasts it. */
const ended = (window: QuotaShareWindow): QuotaShareWindow => ({
  ...window,
  even_percent: null,
  forecast: null,
})

/** An account of the table by its name and made-up ids. */
function account(
  name: string,
  ids: { account_uuid: string; organization: string },
  weekly: string,
  windows: QuotaShareWindow[],
): QuotaAccount {
  return {
    ...ids,
    account: `${ids.organization}/${ids.account_uuid}`,
    weekly_reset: weekly,
    shared: false,
    plan: 'Max',
    name,
    organization_name: null,
    no_source: false,
    windows,
  }
}

/** The table's three accounts as of `now`, every time written at `offset` minutes east of UTC. */
export function quotaTable(now: Date | number, offset = -new Date(now).getTimezoneOffset()): Quota {
  const moment = new Date(now).getTime()
  const at = (ms: number) => momentAt(ms, offset)
  const window = (shape: Parameters<typeof share>[2]) => share(moment, offset, shape)
  const five = window({
    kind: 'five_hour',
    left: TABLE.fiveReset,
    source: 'poll',
    readings: [
      [2.5 * HOUR, 10],
      [HOUR, 35],
      [2 * MINUTE, 62],
    ],
    forecast: {
      outcome: 'runs_out',
      runs_out_at: at(moment + 70 * MINUTE),
      at_reset_percent: null,
      basis: 'blend',
    },
  })
  // Five hours are not back to back: one starts at the first use after the last reset. The two
  // before the current one reset 4 and 11 hours before now, today; the one before that yesterday.
  const fiveBefore = [
    { started: -35 * HOUR, readings: [[HOUR, 20] as [number, number], [4 * HOUR, 48]] },
    { started: -16 * HOUR, readings: [[30 * MINUTE, 12] as [number, number], [3 * HOUR, 64]] },
    { started: -9 * HOUR, readings: [[2 * HOUR, 30] as [number, number], [4.5 * HOUR, 81]] },
  ].map(({ started, readings }) => ({
    started_at: at(moment + started),
    resets_at: at(moment + started + 5 * HOUR),
    readings: readings.map(([after, percent]) => ({
      at: at(moment + started + after),
      used_percent: percent,
      source: 'poll' as const,
    })),
    restarts: [],
  }))
  const lastFive = fiveBefore.at(-1)
  const fiveHours: QuotaShareWindow = {
    ...five,
    earlier: fiveBefore,
    previous: lastFive
      ? {
          started_at: lastFive.started_at,
          resets_at: lastFive.resets_at,
          latest: lastFive.readings.at(-1) ?? five.latest,
          ran_out: false,
        }
      : null,
  }
  const alphaWeek = withEarlier(
    window({
      kind: 'week',
      left: TABLE.alphaReset,
      source: 'poll',
      readings: [
        [20 * HOUR, 5],
        [6 * HOUR, 12],
        [2 * MINUTE, 18],
      ],
      forecast: { low_percent: 70, high_percent: 84 },
    }),
    offset,
    [
      week([
        [1, 4],
        [5, 22],
      ]),
      week(
        [
          [2, 40],
          [4, 12],
          [6, 30],
        ],
        [4],
      ),
      week([
        [1, 9],
        [4, 33],
        [6.5, 51],
      ]),
      week([
        [0.5, 6],
        [3, 27],
      ]),
      week([
        [2, 30],
        [5, 72],
        [6, 100],
      ]),
    ],
  )
  const model = withEarlier(
    ended(
      window({
        kind: 'week_model',
        model: 'model-a',
        left: TABLE.modelReset,
        source: 'poll',
        readings: [
          [5 * DAY, 7],
          [2 * DAY, 15],
        ],
        forecast: null,
      }),
    ),
    offset,
    [
      week([
        [1, 3],
        [4, 11],
      ]),
      week([[2, 8]]),
    ],
  )
  const beta = withEarlier(
    window({
      kind: 'week',
      left: TABLE.betaReset,
      source: 'statusline',
      readings: [
        [4 * DAY, 10],
        [DAY, 31],
        [5 * MINUTE, 46],
      ],
      forecast: { low_percent: 60, high_percent: 66 },
    }),
    offset,
    [week([[3, 0]]), week([[2, 41]]), week([[5, 64]]), week([[1, 12]])],
  )
  const gamma = withEarlier(
    ended(
      window({
        kind: 'week',
        left: TABLE.gammaReset,
        source: 'poll',
        readings: [
          [6 * DAY, 14],
          [3 * DAY, 38],
        ],
        forecast: null,
      }),
    ),
    offset,
    [week([[2, 25]]), week([[4, 57]])],
  )
  const accounts = [
    account(
      'Alpha',
      {
        organization: '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        account_uuid: '1f2e3d4c-5b6a-4798-8a9b-0c1d2e3f4a5b',
      },
      '2T11:30Z',
      [fiveHours, alphaWeek, model],
    ),
    account(
      'Beta',
      {
        organization: '7b2e3d4c-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
        account_uuid: '2a3f4e5d-6c7b-48a9-9b0c-1d2e3f4a5b6c',
      },
      '5T08:30Z',
      [beta],
    ),
    account(
      'Gamma',
      {
        organization: '8c3f4e5d-6a7b-4c8d-ae9f-1a2b3c4d5e6f',
        account_uuid: '3b4a5f6e-7d8c-49ba-8c1d-2e3f4a5b6c7d',
      },
      '1T11:30Z',
      [gamma],
    ),
  ]
  return {
    now: at(moment),
    utc_offset: offset,
    fresh_for_seconds: 900,
    retained_from: at(moment - 365 * DAY),
    accounts,
  }
}
