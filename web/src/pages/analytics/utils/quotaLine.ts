/**
 * The line each quota window card draws under its figures (`QuotaWindow`), decided for a whole
 * section at once (`sectionLines`), since the lines of a section share one time scale.
 *
 * How far back from the answer's moment the page's period starts decides what a line holds. Where
 * it starts no further back than the card's own window lasts — «Now», «Today» and «This week» for a
 * week — the line is that one window, whole across the plot, and the line under the card names the
 * window before it. Where it starts further back, the line holds every window of its kind and
 * account the period overlaps, the windows before the current one the answer gives with it
 * (`earlier`), each whole from its start to its reset, then the current one at the right end. It is
 * the period's distance from now and not its own length that decides: a custom range of a day weeks
 * ago is reached all the same, while «This week», never more than a week back, overlaps the week
 * before by a few days after a mid-week reset and drew two windows there, the earlier one muted in
 * the left half, where the owner asked for one. The answer holds every window that resets after the
 * period's start (`earlier`); this decides what of it a line draws, and every reader of the line —
 * its readings, its restarts, its words, its table and the line under the card — takes `earlier`
 * from here.
 *
 * The two windows of one account stand on one time axis, the owner's decision: an account's weekly
 * windows reset together. Over the period, every line of an account ends at one moment, the latest
 * reset among the account's windows in the section, and each of its windows stands at its real
 * time; a window with nothing read since its last reset stops there, and the line is empty from it
 * to that end (`quietSince`). At a period no longer than a window, a card whose window ended with
 * nothing read since, beside a live window of its account, shows the account's current window, the
 * live one's span, empty (`empty`), its last window a press away under it; a model's week the
 * source no longer reads stood a week before its neighbour, the same reset 85 px apart. An account
 * none of whose windows in the section has a reading since its reset keeps its last window whole.
 *
 * The lines of a section share one length: each runs over as long a time as the longest of them,
 * the same time to a pixel in every card, to its account's end. Accounts whose resets differ stand
 * apart by that difference, as their windows always did: a scale from the earliest start to the
 * latest reset would align them too, but it would also shrink every line inside the plot at a
 * period no longer than a window, where each card shows its one window across the whole plot.
 */
import {
  accountKey,
  sectionWindows,
  stands,
  windowKey,
} from '@/pages/analytics/utils/quotaFigures.ts'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type {
  QuotaAccount,
  QuotaEarlierWindow,
  QuotaShareWindow,
} from '@/shared/api/analyticsApi.ts'
import type { StepSpan } from '@/shared/ui/windowGeometry.ts'

/** What a window card's step line draws, in ms since the epoch. */
export interface QuotaLine {
  /** The line's current window, its start to its reset: the pace and now stand on it alone. */
  current: StepSpan
  /** The windows before the current one the line draws, oldest first; none at a short period. */
  earlier: readonly QuotaEarlierWindow[]
  /**
   * Whether the line is its account's current window with none of the card's readings: the card's
   * own window ended with nothing read since, beside a live window of the account.
   */
  empty: boolean
  /**
   * What the axis names: the first window's start, and the current window's reset or, past a reset
   * with nothing read since, the line's end.
   */
  holds: StepSpan
  /**
   * The card's own last reset where nothing was read since and the line runs on past it, as the
   * answer writes it: the stretch from there is empty, and the words say so. Null elsewhere.
   */
  quietSince: string | null
  /** The moment the axis's reset word names, as the answer writes it; null where none is named. */
  reset: string | null
  /** The span the plot runs over: the section's one length, to the account's end. */
  span: StepSpan
  /** The moment the axis's start word names, as the answer writes it; null where none is named. */
  start: string | null
}

/**
 * A window's own span, in ms: its start to its reset. A window that has named neither runs from its
 * first reading to the answer's moment `today`.
 */
export function windowSpan(window: QuotaShareWindow, today: string): StepSpan {
  const from = Date.parse(window.started_at ?? window.readings[0]?.at ?? today)
  return { from, to: Math.max(Date.parse(window.resets_at ?? today), from + 1) }
}

/**
 * Whether a window's line holds the period: it starts at `from` (ms), further back from the
 * answer's moment `today` than the window lasts. No period holds nothing more.
 */
function holdsPeriod(window: QuotaShareWindow, today: string, from: number | null) {
  if (from === null) return false
  const own = windowSpan(window, today)
  return Date.parse(today) - from > own.to - own.from
}

/** The key a card finds its line by among a section's: its account and its window. */
export const lineKey = (account: QuotaAccount, window: QuotaShareWindow) =>
  `${accountKey(account)} ${windowKey(window)}`

/** A window's line as it stands alone, on no period and no shared scale. */
export function ownLine(window: QuotaShareWindow, today: string): QuotaLine {
  const own = windowSpan(window, today)
  return {
    current: own,
    earlier: [],
    empty: false,
    holds: own,
    quietSince: null,
    reset: window.resets_at,
    span: own,
    start: window.started_at,
  }
}

/** What a line is decided from besides its window: its account's end and live window, the period. */
interface LineGround {
  /** The latest reset among the account's windows in the section, in ms. */
  end: number
  /** The account's window in the section that stands, the latest to reset; null where none does. */
  live: QuotaShareWindow | null
  /** Where the period starts, in ms; null for none. */
  since: number | null
  today: string
}

/** A window's line before the section's length is laid on it (`sectionLines`). */
function lineOf(window: QuotaShareWindow, { end, live, since, today }: LineGround): QuotaLine {
  const own = windowSpan(window, today)
  const quiet = !stands(window, Date.parse(today))
  if (holdsPeriod(window, today, since)) {
    const earlier = window.earlier ?? []
    const first = earlier[0]
    const from = first ? Math.min(own.from, Date.parse(first.started_at)) : own.from
    const past = quiet && end > own.to
    return {
      current: own,
      earlier,
      empty: false,
      holds: { from, to: past ? end : own.to },
      quietSince: past ? window.resets_at : null,
      reset: window.resets_at,
      span: { from, to: Math.max(end, own.to) },
      start: first?.started_at ?? window.started_at,
    }
  }
  if (quiet && live) {
    const current = windowSpan(live, today)
    return {
      current,
      earlier: [],
      empty: true,
      holds: current,
      quietSince: window.resets_at,
      reset: live.resets_at,
      span: current,
      start: live.started_at,
    }
  }
  return ownLine(window, today)
}

/**
 * The line of every window of a section, by `lineKey`, over the period that starts at `from` (a
 * time with its offset, null for none) as of the answer's moment `today`: each holds its one window
 * or the period, an account's lines end together, and all run over one length.
 */
export function sectionLines(
  accounts: readonly QuotaAccount[],
  section: QuotaSection,
  today: string,
  from: string | null,
): Map<string, QuotaLine> {
  const since = from === null ? null : Date.parse(from)
  const moment = Date.parse(today)
  const lines = accounts.flatMap((account) => {
    const windows = sectionWindows(account, section)
    const spans = windows.map((window) => windowSpan(window, today))
    const end = Math.max(...spans.map((span) => span.to))
    const live =
      windows
        .filter((window) => stands(window, moment))
        .sort((one, other) => windowSpan(other, today).to - windowSpan(one, today).to)[0] ?? null
    return windows.map((window) => ({
      key: lineKey(account, window),
      line: lineOf(window, { end, live, since, today }),
    }))
  })
  const length = Math.max(0, ...lines.map(({ line }) => line.span.to - line.span.from))
  return new Map(
    lines.map(({ key, line }) => [
      key,
      {
        ...line,
        span: { from: Math.min(line.span.from, line.span.to - length), to: line.span.to },
      },
    ]),
  )
}

/**
 * The window whose predecessor the line under a card names: the card's own, or, where its line is
 * the account's current window with none of its readings (`empty`), that window, which started
 * for this card at its last reset and whose predecessor is the card's last window.
 */
export function namedAfter(window: QuotaShareWindow, line: QuotaLine): QuotaShareWindow {
  if (!line.empty || window.resets_at === null) return window
  return {
    ...window,
    started_at: window.resets_at,
    previous: {
      started_at: window.started_at ?? window.latest.at,
      resets_at: window.resets_at,
      latest: window.latest,
      ran_out: window.readings.some((one) => one.used_percent >= 100),
    },
  }
}

/**
 * How far apart two resets of one window may be read, in ms: the server's slack (`RESET_SLACK` in
 * `server/quota/forecast.py`), within which two readings name one window.
 */
const RESET_SLACK = 10 * 60_000

/** Whether a window's line holds the window before it, so no line under it names that window. */
export function holdsPrevious(window: QuotaShareWindow, line: QuotaLine) {
  const ended = Date.parse(window.previous?.resets_at ?? '')
  return (
    !Number.isNaN(ended) &&
    line.earlier.some((before) => Math.abs(Date.parse(before.resets_at) - ended) <= RESET_SLACK)
  )
}
