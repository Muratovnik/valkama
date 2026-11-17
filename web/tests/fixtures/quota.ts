/**
 * What the quota read answers, as of a moment: four accounts that between them hold every state a
 * window has. Every id, name and number is made up.
 *
 * - «Work», named by the owner and read by the poll: five hours at 62 % and fresh, the week at
 *   41 % and fresh, a model's week at 12.5 % and silent, and its usage credits.
 * - An account with no name, read by the status line: five hours at a fresh 0 %, the week at
 *   88 % and silent, the tightest week.
 * - An organization that worked and that no source read.
 * - A provisional seat, known for its week alone: five hours at 74 % and fresh, the tightest five
 *   hours, and its week at 20 %.
 *
 * The tightest window of each kind is therefore never the first account, so a tile that named the
 * first account rather than the tightest would say the wrong one.
 */
import type { Quota, QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { momentAt } from './analytics.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const FIVE_HOURS = 5 * HOUR
const WEEK = 7 * DAY

const WORK = {
  organization: '5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f',
  account_uuid: '0b7d4e19-1c2d-4e3f-8a4b-5c6d7e8f9a0b',
}
export const NIGHT = {
  organization: 'd4e8a1f0-7c2b-4e5d-8f36-a1b2c3d4e5f6',
  account_uuid: '7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928',
}
export const UNREAD = { organization: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a' }
const SEATED = { organization: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }

type Reading = [ago: number, percent: number]

/**
 * A window that is a share of a limit: its readings so many ms before `now`, the last of them
 * the latest, its reset `left` ms after `now`, and its state by the age of the latest.
 */
function share(
  now: number,
  offset: number,
  window: {
    forecast: QuotaShareWindow['forecast']
    kind: QuotaShareWindow['kind']
    left: number
    readings: Reading[]
    source: QuotaShareWindow['latest']['source']
    model?: string
  },
): QuotaShareWindow {
  const at = (ms: number) => momentAt(ms, offset)
  const length = window.kind === 'five_hour' ? FIVE_HOURS : WEEK
  const resets = now + window.left
  const started = resets - length
  const readings = window.readings.map(([ago, percent]) => ({
    at: at(now - ago),
    used_percent: percent,
    source: window.source,
  }))
  const latest = readings.at(-1)
  if (!latest) throw new Error('a window has a latest reading')
  const [lastAgo = 0] = window.readings.at(-1) ?? []
  return {
    kind: window.kind,
    model: window.model ?? null,
    state: lastAgo <= 15 * MINUTE ? 'fresh' : 'silent',
    resets_at: at(resets),
    latest,
    started_at: at(started),
    even_percent: Math.round(((now - started) / length) * 10_000) / 100,
    readings,
    forecast: window.forecast,
  }
}

/** The four accounts as of `now`, every time written at `offset` minutes east of UTC. */
export function quotaAt(now: Date | number, offset = -new Date(now).getTimezoneOffset()): Quota {
  const moment = new Date(now).getTime()
  const at = (ms: number) => momentAt(ms, offset)
  const window = (shape: Parameters<typeof share>[2]) => share(moment, offset, shape)
  const accounts: QuotaAccount[] = [
    {
      ...WORK,
      seat: null,
      plan: 'Max',
      name: 'Work',
      no_source: false,
      windows: [
        window({
          kind: 'five_hour',
          left: 2 * HOUR,
          source: 'poll',
          readings: [
            [2.5 * HOUR, 10],
            [HOUR, 35],
            [2 * MINUTE, 62],
          ],
          forecast: { outcome: 'runs_out', runs_out_at: at(moment + 70 * MINUTE), basis: 'blend' },
        }),
        window({
          kind: 'week',
          left: 3 * DAY,
          source: 'poll',
          readings: [
            [3.5 * DAY, 8],
            [2 * DAY, 22],
            [DAY, 30],
            [2 * MINUTE, 41],
          ],
          forecast: { low_percent: 56.93, high_percent: 61.2 },
        }),
        window({
          kind: 'week_model',
          model: 'model-a',
          left: 3 * DAY,
          source: 'poll',
          readings: [[5 * HOUR, 12.5]],
          forecast: null,
        }),
        {
          kind: 'extra_usage',
          model: null,
          state: 'silent',
          resets_at: null,
          latest: { at: at(moment - 2 * DAY), source: 'poll' },
        },
      ],
    },
    {
      ...NIGHT,
      seat: null,
      plan: null,
      name: null,
      no_source: false,
      windows: [
        window({
          kind: 'five_hour',
          left: 4 * HOUR,
          source: 'statusline',
          readings: [[3 * MINUTE, 0]],
          forecast: { outcome: 'lasts', runs_out_at: null, basis: 'window' },
        }),
        window({
          kind: 'week',
          left: DAY,
          source: 'statusline',
          readings: [
            [4 * DAY, 30],
            [DAY, 70],
            [3 * HOUR, 88],
          ],
          forecast: { low_percent: 97.5, high_percent: 104.2 },
        }),
      ],
    },
    {
      ...UNREAD,
      account_uuid: null,
      seat: null,
      plan: null,
      name: null,
      no_source: true,
      windows: [],
    },
    {
      ...SEATED,
      account_uuid: null,
      seat: 'week:2026-11-15T09:00Z',
      plan: null,
      name: null,
      no_source: false,
      windows: [
        window({
          kind: 'five_hour',
          left: 90 * MINUTE,
          source: 'mod',
          readings: [
            [3 * HOUR, 30],
            [5 * MINUTE, 74],
          ],
          forecast: { outcome: 'runs_out', runs_out_at: at(moment + 40 * MINUTE), basis: 'recent' },
        }),
        window({
          kind: 'week',
          left: 4 * DAY,
          source: 'mod',
          readings: [[5 * MINUTE, 20]],
          forecast: null,
        }),
      ],
    },
  ]
  return { now: at(moment), utc_offset: offset, fresh_for_seconds: 900, accounts }
}

/** The answer as the server sends it. */
export const quotaAnswer = (quota: Quota) => ({ interface_version: 'valkama-analytics-api', quota })

/** Two more accounts like «Work», each a week and a model's week, by these names and ids. */
const MORE = [
  {
    name: 'Studio',
    organization: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
    account_uuid: '6f5e4d3c-2b1a-4098-8f7e-6d5c4b3a2918',
  },
  {
    name: 'Lab',
    organization: '8e9f0a1b-2c3d-4e5f-9a6b-7c8d9e0f1a2b',
    account_uuid: '2a3b4c5d-6e7f-4809-9a1b-2c3d4e5f6a7b',
  },
]

/**
 * Six accounts as of `now`: the four, then two more like «Work» under names of their own, as a
 * workstation that holds six accounts reads them.
 */
export function quotaOfSix(now: Date | number, offset = -new Date(now).getTimezoneOffset()): Quota {
  const quota = quotaAt(now, offset)
  const [work] = quota.accounts
  if (!work) throw new Error('the four accounts start with «Work»')
  const more = MORE.map((account) => ({ ...work, ...account }))
  return { ...quota, accounts: [...quota.accounts, ...more] }
}

/** An account at the edges a forecast is drawn at, by this name and ids. */
const EDGE = {
  name: 'Edge',
  organization: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a',
  account_uuid: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
}

/**
 * The four accounts as of `now`, and a fifth, «Edge», at the edges a forecast is drawn at: five
 * hours spent, a week read past 100 %, and a model's week at a fresh 0 % with a range ahead.
 */
export function quotaOfEdges(
  now: Date | number,
  offset = -new Date(now).getTimezoneOffset(),
): Quota {
  const quota = quotaAt(now, offset)
  const moment = new Date(now).getTime()
  const window = (shape: Parameters<typeof share>[2]) => share(moment, offset, shape)
  const edge: QuotaAccount = {
    ...EDGE,
    seat: null,
    plan: 'Max',
    no_source: false,
    windows: [
      window({
        kind: 'five_hour',
        left: HOUR,
        source: 'poll',
        readings: [
          [2 * HOUR, 60],
          [10 * MINUTE, 100],
        ],
        forecast: { outcome: 'spent', runs_out_at: null, basis: 'recent' },
      }),
      window({
        kind: 'week',
        left: DAY,
        source: 'poll',
        readings: [
          [2 * DAY, 80],
          [5 * MINUTE, 104],
        ],
        forecast: { low_percent: 104, high_percent: 110 },
      }),
      window({
        kind: 'week_model',
        model: 'model-b',
        left: 3 * DAY,
        source: 'poll',
        readings: [[5 * MINUTE, 0]],
        forecast: { low_percent: 4, high_percent: 9 },
      }),
    ],
  }
  return { ...quota, accounts: [...quota.accounts, edge] }
}
