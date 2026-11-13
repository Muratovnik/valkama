/**
 * What used a quota window, as the usage read answers it: the work Valkama recorded on one
 * account from the window's start to the answer's moment, by its API price estimate, broken down
 * by task, project or model. The estimate is the read's own (`cost_basis`); no figure here is a
 * share of the quota, because no verified weights turn tokens into quota points, and nothing here
 * adds two accounts.
 *
 * One read answers a window: the account's organization, the account's seat and work of that
 * organization whose seat no sample names, grouped by the breakdown and the seat. The account's
 * own rows are its breakdown, each line's share a share of the account's estimate; the rest is
 * work its organization did with no account known, which is said apart and never counted to it.
 */
import { momentAtOffset } from '@/pages/analytics/utils/readMoments.ts'
import {
  addSpent,
  rankedLines,
  spentAnything,
  spentOf,
} from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'

import type {
  Quota,
  QuotaAccount,
  QuotaShareWindow,
  Usage,
  UsageQuery,
  UsageRow,
} from '@/shared/api/analyticsApi.ts'

/** The breakdowns a window's spend is read by, the first the one it opens on. */
export const SPEND_BREAKDOWNS = ['work_item', 'project', 'model'] as const
export type SpendBy = (typeof SPEND_BREAKDOWNS)[number]

/** How many items the breakdown names before it folds the rest into one line. */
const LISTED = 5

/**
 * How far apart the ends of a window's spend are read: the answer's moment held to the last
 * five minutes, so a panel read again every interval reads what used each window again every
 * five minutes, and every read inside one such step is the same read.
 */
export const SPEND_STEP = 5 * 60_000

/**
 * The value the usage read gives the account's work under `seat`: its organization, a slash and
 * its account's UUID, or its provisional seat's key; null for an organization no source read,
 * which has no account to read by.
 */
export function seatOf(account: QuotaAccount): string | null {
  const held = account.account_uuid ?? account.seat
  return held === null ? null : `${account.organization}/${held}`
}

/**
 * The span what used a window is read over: from its start to the answer's moment, held to the
 * step (`SPEND_STEP`), or to its reset where that has passed. Its end is written at the answer's
 * offset, as its other times are. Null for a window that names no start, or none yet behind it.
 */
function spendSpan(window: QuotaShareWindow, quota: Pick<Quota, 'now' | 'utc_offset'>) {
  if (window.started_at === null) return null
  const from = Date.parse(window.started_at)
  const now = Date.parse(quota.now)
  let end = Math.floor(now / SPEND_STEP) * SPEND_STEP
  if (end <= from) end = now
  if (window.resets_at !== null) end = Math.min(end, Date.parse(window.resets_at))
  const to = momentAtOffset(end, quota.utc_offset)
  return Date.parse(to) > from ? { from: window.started_at, to } : null
}

/** The read of what used `window` of `account` by `by`; null where the window has no span. */
export function spendQuery(
  account: QuotaAccount,
  window: QuotaShareWindow,
  quota: Pick<Quota, 'now' | 'utc_offset'>,
  by: SpendBy,
): UsageQuery | null {
  const seat = seatOf(account)
  const span = spendSpan(window, quota)
  if (seat === null || span === null) return null
  return {
    ...span,
    utcOffset: quota.utc_offset,
    step: 'day',
    compare: false,
    groupBy: [by, 'seat'],
    // The account's seat, and its organization's work no sample places on an account.
    filters: { account: [account.organization], seat: [seat, null] },
  }
}

/** What a window's read says of its account. */
export interface WindowSpent {
  /** The account's work by the breakdown, the costliest first, the rest folded into one line. */
  lines: SpendingLine[]
  /** All of the account's work in the span: what each line's share is a share of. */
  total: Spent
  /** Its organization's work with no account known, never counted to it; null for none. */
  unplaced: Spent | null
}

const NOTHING: Spent = { seconds: 0, tokens: null, cost: null, unpriced: 0 }

function sum(rows: readonly UsageRow[]) {
  let held = NOTHING
  for (const row of rows) held = addSpent(held, spentOf(row))
  return held
}

/** The account's breakdown and its organization's unplaced work, from one window's read. */
export function windowSpent(usage: Usage, seat: string, by: SpendBy): WindowSpent {
  const own = usage.rows.filter((row) => row.group.seat?.id === seat)
  const apart = sum(usage.rows.filter((row) => row.group.seat?.unknown === true))
  return {
    lines: rankedLines(own, by, 'cost', LISTED),
    total: sum(own),
    unplaced: spentAnything(apart) ? apart : null,
  }
}

/** A line's share of the account's estimate, or null where either has no price. */
export function shareOf(line: SpendingLine, total: Spent): number | null {
  return line.spent.cost === null || !total.cost ? null : line.spent.cost / total.cost
}
