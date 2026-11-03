import { expect, it } from 'vitest'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'

import { workItemFixture } from './fixtures/workItem.ts'
import { asRoot } from './support/threads.ts'

const at = '2026-11-03T09:00:00Z'

function comments(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    kind: 'comment' as const,
    ...asRoot,
    author: 'codex',
    body: `Remark ${index + 1}`,
    at,
    report: null,
    checklist_item_id: null,
    checklist_item_text: null,
  }))
}

function events(count: number) {
  return Array.from({ length: count }, () => ({
    action: 'checklist_completed' as const,
    detail: 'a step',
    author: 'codex',
    at,
    identity: {
      state: 'confirmed' as const,
      source: 'codex-meta',
      session_id: 's',
      agent_id: null,
    },
  }))
}

// The card's read has no ceiling on either list (connection contract, "Reading
// one work item"), so the card must open whatever length the server sends.
it('opens a card with 600 comments', () => {
  const record = { ...workItemFixture('Long discussion', 3), comments: comments(600) }
  expect(validateWorkItemRecord(record).comments).toHaveLength(600)
})

it('opens a card with 1500 history events', () => {
  const record = { ...workItemFixture('Long history', 3), events: events(1500) }
  expect(validateWorkItemRecord(record).events).toHaveLength(1500)
})
