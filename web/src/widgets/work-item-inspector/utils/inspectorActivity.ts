/**
 * One chronological record per work item, out of the three streams that are
 * stored separately: lifecycle events, evidence refs, and human comments.
 *
 * They are merged rather than shown as three lists because a reader asking what
 * happened to an item does not care which table an entry came from — the Board
 * era proved that by shipping three panels and having operators read them in
 * parallel to reconstruct one order.
 */

import type { WorkItem } from '@/shared/api/planningModel.ts'

type Ref = WorkItem['refs'][number]

export interface ActivityEntry {
  at: string
  author: string
  detail: string
  key: string
  kind: 'comment' | 'event' | 'ref'
  /** Message key naming what happened; the entry never spells its own label. */
  titleKey: string
  reference?: Ref
}

const REF_TITLE_KEYS: Record<Ref['kind'], string> = {
  commit: 'reference.commit',
  memory: 'reference.memory',
  session: 'reference.session',
  url: 'reference.url',
}

export function buildActivity(item: WorkItem): ActivityEntry[] {
  const events = item.events.map((event, index): ActivityEntry => ({
    key: `event-${index}-${event.at}`,
    kind: 'event',
    at: event.at,
    author: event.author,
    titleKey: `activity.${event.action}`,
    detail: event.detail,
  }))
  const refs = item.refs.map((reference, index): ActivityEntry => ({
    key: `ref-${index}-${reference.at}`,
    kind: 'ref',
    at: reference.at,
    author: reference.author,
    titleKey: REF_TITLE_KEYS[reference.kind],
    detail: reference.label,
    reference,
  }))
  const comments = item.comments.map((comment, index): ActivityEntry => ({
    key: `comment-${index}-${comment.at}`,
    kind: 'comment',
    at: comment.at,
    author: comment.author,
    titleKey: 'activity.comment',
    detail: comment.body,
  }))
  return [...events, ...refs, ...comments].sort(
    (left, right) => Date.parse(right.at) - Date.parse(left.at),
  )
}

/** Progress over the checklist, which two sections and one tile all ask for. */
export function checklistProgress(item: WorkItem): { done: number; total: number } {
  return {
    done: item.checklist.filter((step) => step.done).length,
    total: item.checklist.length,
  }
}
