/** System events and attached evidence; human discussion has its own feed. */

import { groupHistory } from '@/widgets/work-item-inspector/utils/historyRecords.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'

type Ref = WorkItem['refs'][number]

export interface ActivityEntry {
  at: string
  author: string
  detail: string
  key: string
  kind: 'event' | 'ref'
  /** Message key naming what happened; the entry never spells its own label. */
  titleKey: string
  action?: string
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
    action: event.action,
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
  return groupHistory([...events, ...refs], (entry) => entry.at).flatMap((group) => group.records)
}

/** Progress over the checklist, which two sections and one tile all ask for. */
export function checklistProgress(item: WorkItem): { done: number; total: number } {
  return {
    done: item.checklist.filter((step) => step.done).length,
    total: item.checklist.length,
  }
}
