import { expect, it } from 'vitest'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import { validatePlanningWorkItemPayload } from '@/shared/api/platformPlanningPayload.ts'

import { workItemFixture } from './fixtures/workItem.ts'
import { asRoot } from './support/threads.ts'

const at = '2026-11-03T09:00:00Z'

function comments(count: number, body = (index: number) => `Remark ${index + 1}`) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    kind: 'comment' as const,
    ...asRoot,
    author: 'codex',
    body: body(index),
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

/** The card's read as it arrives, envelope and all, which is the path the card takes. */
function cardRead(work_item: unknown) {
  return {
    interface_version: 'valkama-planning-work-item',
    scope: { kind: 'project', project_ref: { project_id: 'example-project' } },
    work_item_ref: {
      space_ref: { data_scope_id: '123e4567-e89b-42d3-a456-426614174000', space_key: 'QA' },
      reference: 'QA-320',
    },
    state: { interface_version: 'valkama-ui-state', status: 'ready', payload: { work_item } },
  }
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

it('opens a card of 600 comments as long as the server takes them, and 1500 events, as it is read', () => {
  const record = {
    ...workItemFixture('Long discussion', 3),
    comments: comments(600, () => 'x'.repeat(8000)),
    events: events(1500),
  }
  const read = validatePlanningWorkItemPayload(cardRead(record))
  expect(read.state.status === 'ready' && read.state.payload.work_item.comments).toHaveLength(600)
})
