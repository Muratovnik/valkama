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
 * The lines of a section share one time scale: each runs over as long a time as the longest of
 * them, the same time to a pixel in every card, and ends where it ended before, at its own current
 * window's reset. Accounts whose resets differ stand apart by that difference, as their windows
 * always did: a scale from the earliest start to the latest reset would align them too, but it
 * would also shrink every line inside the plot at a period no longer than a window, where each card
 * shows its one window across the whole plot.
 */
import { accountKey, sectionWindows, windowKey } from '@/pages/analytics/utils/quotaFigures.ts'

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
  /** What the line's windows cover, the first one's start to the current one's reset, which the axis names. */
  holds: StepSpan
  /** The span the plot runs over: the section's one length, to the line's end. */
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
  return { span: own, current: own, holds: own, earlier: [], start: window.started_at }
}

/**
 * The line of every window of a section, by `lineKey`, over the period that starts at `from` (a
 * time with its offset, null for none) as of the answer's moment `today`: each holds its one window
 * or the period, and all run over one length, each to its own reset.
 */
export function sectionLines(
  accounts: readonly QuotaAccount[],
  section: QuotaSection,
  today: string,
  from: string | null,
): Map<string, QuotaLine> {
  const since = from === null ? null : Date.parse(from)
  const held = accounts.flatMap((account) =>
    sectionWindows(account, section).map((window) => {
      const own = windowSpan(window, today)
      const earlier = holdsPeriod(window, today, since) ? (window.earlier ?? []) : []
      const first = earlier[0]
      const start = first ? Math.min(own.from, Date.parse(first.started_at)) : own.from
      return {
        key: lineKey(account, window),
        line: {
          span: { from: start, to: own.to },
          current: own,
          holds: { from: start, to: own.to },
          earlier,
          start: first?.started_at ?? window.started_at,
        },
      }
    }),
  )
  const length = Math.max(0, ...held.map(({ line }) => line.holds.to - line.holds.from))
  return new Map(
    held.map(({ key, line }) => [
      key,
      {
        ...line,
        span: { from: Math.min(line.holds.from, line.span.to - length), to: line.span.to },
      },
    ]),
  )
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
