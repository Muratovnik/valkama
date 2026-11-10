/**
 * How often each analytics surface is opened, counted by the server on this machine.
 *
 * A report is worth nothing to the person who opened the surface, so it never stands in
 * their way: it returns at once and is never awaited, and a write that fails is dropped
 * without a word or a retry. The server keeps the day and the kind and nothing else
 * (connection contract, "How often each analytics surface is opened").
 */

import { secureFetch } from '@/shared/api/secureFetch.ts'

/** What was opened: the page, a panel or a miniature, or a task from one of them. */
export type AnalyticsUseKind = 'page_open' | 'panel_open' | 'mini_open' | 'task_open'

/** A report is worth nothing late, and must not hold a connection while it waits. */
const REPORT_DEADLINE_MS = 5000

/** Count one use of `kind` on this person's day; never throws, never waits. */
export function reportAnalyticsUse(kind: AnalyticsUseKind): void {
  try {
    secureFetch('/api/analytics/uses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `getTimezoneOffset` counts west of UTC as positive; the server counts east.
      body: JSON.stringify({ kind, utc_offset: -new Date().getTimezoneOffset() }),
      signal: AbortSignal.timeout(REPORT_DEADLINE_MS),
    }).catch(() => {})
  } catch {
    // A report that could not even be started is a count not made, and nothing more.
  }
}
