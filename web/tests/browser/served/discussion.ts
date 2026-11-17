/**
 * The discussion double, asked as a card's discussion asks it: the card, a remark, a report
 * made current, the summary chosen, the description and the steps changed, the item closed,
 * a reply and a thread settled.
 */
import { installDiscussionBackend } from '../discussionBackend.ts'
import { workItem, workItemRef } from '../planningFixtures.ts'
import { cardRead } from '../servedAnswers.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

const write = (path: string, body: object) => ({
  method: 'POST' as const,
  url: `/api/planning/work-item/${path}`,
  body: { id: workItem.work_item_id, ...body },
})
const remark = workItem.comments.length + 1

export const routes: DrivenRoutes[] = [
  {
    name: 'installDiscussionBackend()',
    install: installDiscussionBackend,
    reads: [
      cardRead(workItemRef.reference),
      write('comment', { body: 'A remark' }),
      write('report', { report: { done: 'Done', next: 'Next' }, make_current: true }),
      write('summary/select', { comment_id: remark + 1 }),
      write('update', { description: 'What the work is now' }),
      write('checklist', { items: ['A step', 'Another step'] }),
      write('transition', { to: 'done' }),
      write('comment', { body: 'A reply', reply_to: remark }),
      write('comment/resolve', { comment_id: remark, resolution: 'Settled' }),
      cardRead(workItemRef.reference),
    ],
  },
]
