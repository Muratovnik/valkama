import type { WorkItem } from '@/shared/api/planningModel.ts'

import { asRoot } from '../support/threads.ts'

type Row = WorkItem['comments'][number]

const row = {
  kind: 'comment',
  report: null,
  checklist_item_id: null,
  checklist_item_text: null,
  ...asRoot,
} as const

export const reply = (id: number, parent: number, body: string, change: Partial<Row> = {}): Row =>
  ({
    ...row,
    id,
    reply_to: parent,
    author: 'kolo (session 019a2b3c-4d5e)',
    by_person: false,
    at: `2026-08-13T10:${String(id).padStart(2, '0')}:00Z`,
    body,
    ...change,
  }) as Row

export const root = (id: number, body: string, change: Partial<Row> = {}): Row =>
  ({
    ...row,
    id,
    author: 'elko (session 019a2b3c-4d5e)',
    by_person: false,
    at: `2026-08-13T09:${String(id).padStart(2, '0')}:00Z`,
    body,
    ...change,
  }) as Row

export const SETTLED = 'Moved to MAIN-14 with the step claims it needs'

/** A card a few agents have talked on: one thread each of what a thread can be. */
export function talkedOn(): Row[] {
  return [
    root(1, 'The export leaves out **step claims**. Reading the code it looks deliberate.', {
      resolution: {
        at: '2026-08-13T11:00:00Z',
        by: 'user',
        by_person: true,
        text: SETTLED,
      },
    }),
    reply(2, 1, 'Only the claims, the steps are there.'),
    root(3, 'Should the second report replace the first or stand beside it?'),
    reply(4, 3, 'Beside it, the first holds the numbers.', { by_person: true, author: 'user' }),
    root(5, 'Four replies below, the first two held back until asked.'),
    reply(6, 5, 'First reply, written long before the rest.'),
    reply(7, 5, 'Second reply, also older.'),
    reply(8, 5, 'Third reply, the first one shown.'),
    reply(9, 5, 'Fourth reply, the last one shown.'),
    {
      ...root(10, ''),
      kind: 'report',
      report: { done: 'Shipped the export.', next: 'Review it.' },
    } as Row,
  ]
}
