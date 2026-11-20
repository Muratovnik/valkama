/**
 * The span a quota window's step line runs over (`QuotaWindow`): the page's period, never less than
 * the current window. The line holds every window of its kind and account the period overlaps, the
 * windows before the current one the answer gives with it (`earlier`), each whole from its start to
 * its reset, then the current one at the right end, so its span runs from the first of them to the
 * current window's reset. A period that ends before now changes nothing of that: the line still
 * ends at the current window, the one the card's figures over it say, and only reaches further back.
 *
 * The lines of a section share one time scale (`sectionLength`): each runs over as long a time as
 * the longest of them, the same time to a pixel in every card, and ends where it ended before, at
 * its own current window's reset. So the two windows of an account that reset together, a pair of
 * cards side by side, stand moment for moment one over the other's place, and a line whose own
 * windows cover less of the time is empty before its first. Accounts whose resets differ stand
 * apart by that difference, as their windows always did: a scale from the earliest start to the
 * latest reset would align them too, but it would also shrink every line inside the plot at a
 * period no longer than a window, where each card showed its one window across the whole plot.
 */
import { sectionWindows } from '@/pages/analytics/utils/quotaFigures.ts'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import type { StepSpan } from '@/shared/ui/windowGeometry.ts'

/**
 * A window's own span, in ms: its start to its reset. A window that has named neither runs from its
 * first reading to the answer's moment `today`.
 */
export function windowSpan(window: QuotaShareWindow, today: string): StepSpan {
  const from = Date.parse(window.started_at ?? window.readings[0]?.at ?? today)
  return { from, to: Math.max(Date.parse(window.resets_at ?? today), from + 1) }
}

/** The span of a window's line: from the start of the first window it holds to the window's reset. */
export function lineSpan(window: QuotaShareWindow, today: string): StepSpan {
  const own = windowSpan(window, today)
  const first = window.earlier?.[0]
  return first ? { from: Math.min(own.from, Date.parse(first.started_at)), to: own.to } : own
}

/**
 * The one time scale of a section's lines, in ms: the span of the longest line of its windows.
 * Null where the section has no window.
 */
export function sectionLength(
  accounts: readonly QuotaAccount[],
  section: QuotaSection,
  today: string,
): number | null {
  const lengths = accounts
    .flatMap((account) => sectionWindows(account, section))
    .map((window) => {
      const span = lineSpan(window, today)
      return span.to - span.from
    })
  return lengths.length ? Math.max(...lengths) : null
}

/** The span a window's line runs over at the section's scale `length`: that long, to its reset. */
export function scaledSpan(window: QuotaShareWindow, today: string, length: number | null) {
  const held = lineSpan(window, today)
  return length === null ? held : { from: Math.min(held.from, held.to - length), to: held.to }
}

/**
 * How far apart two resets of one window may be read, in ms: the server's slack (`RESET_SLACK` in
 * `server/quota/forecast.py`), within which two readings name one window.
 */
const RESET_SLACK = 10 * 60_000

/** Whether a window's line holds the window before it, so no line under it names that window. */
export function holdsPrevious(window: QuotaShareWindow) {
  const ended = Date.parse(window.previous?.resets_at ?? '')
  return (
    !Number.isNaN(ended) &&
    (window.earlier ?? []).some(
      (before) => Math.abs(Date.parse(before.resets_at) - ended) <= RESET_SLACK,
    )
  )
}
