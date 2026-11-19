import type { ClosingSummary } from '@/shared/api/planningClosingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

/**
 * The summary a cancel from a card closes the item with, as the server's own cancel of the work
 * under a goal writes one: what it did stays where it says something, nothing comes next, and
 * the reason given is its `why`. A close needs a summary, so a cancel without one would be
 * refused for lacking it.
 */
export function cancelSummary(item: Pick<WorkItem, 'summary'>, why: string): ClosingSummary {
  const done = item.summary?.done.trim()
  return {
    done: done || 'Cancelled by the owner.',
    next: 'Nothing: it was cancelled.',
    ...(why ? { why } : {}),
  }
}
