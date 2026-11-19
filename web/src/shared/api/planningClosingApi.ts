/**
 * The writes that close work or put it off from a card: put off until a day or a card's close,
 * cancel with a reason, cancel a goal or a stage with the list of what it closes, and confirm the
 * close of one that awaits confirmation.
 *
 * Each answers with nothing a card reads: the card reads its item again after any of them, and
 * their answers carry fields of a write (`cancelled`, `released` as a list, `returned` as a list)
 * that the record's own read does not. A refusal comes as the planning boundary throws it, a
 * cancel whose list is not confirmed as `CancelListError` with that list.
 */

import { write } from '@/shared/api/planningApi.ts'

/**
 * Put work off until `until`, a day such as `2026-12-01` or the reference of the open card whose
 * close it waits on, saying why: the server takes neither without the other.
 */
export async function deferWorkItem(input: {
  id: string
  reason: string
  until: string
}): Promise<void> {
  await write('/api/planning/work-item/defer', { ...input })
}

/** What a closing write leaves as the item's report: what was done, why, and what comes next. */
export interface ClosingSummary {
  done: string
  next: string
  why?: string
}

/**
 * Move work to a cancelled state, `state` the workflow's key, with the summary a close needs and
 * the reason the move records, in one write. A goal or stage with open work under it is refused
 * with its list until `cancels` names that list's token; the refused write keeps nothing.
 */
export async function cancelWorkItem(input: {
  id: string
  state: string
  summary: ClosingSummary
  cancels?: string
  reason?: string
}): Promise<void> {
  const { id, summary, ...transition } = input
  await write('/api/planning/work-item/apply', { id, summary, transition })
}

/**
 * Confirm the close of a goal or stage that awaits confirmation: tick the steps still open as
 * the person's, write the summary when it has none, and complete it, in one write.
 */
export async function confirmWorkItemClose(input: {
  id: string
  /** The workflow's key of the completed state it closes into. */
  state: string
  /** The steps to tick now, by id. */
  ticks: readonly string[]
  summary?: ClosingSummary
}): Promise<void> {
  await write('/api/planning/work-item/apply', {
    id: input.id,
    ...(input.ticks.length
      ? { checklist_ticks: input.ticks.map((item_id) => ({ item_id, done: true })) }
      : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    transition: { state: input.state },
  })
}
