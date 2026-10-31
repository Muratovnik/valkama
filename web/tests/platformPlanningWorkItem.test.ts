import assert from 'node:assert/strict'

import { expect, test } from 'vitest'

import { validatePlanningWorkItemPayload } from '@/shared/api/platformPlanningPayload.ts'

function planningWorkItemPayload() {
  const spaceRef = {
    data_scope_id: '123e4567-e89b-42d3-a456-426614174000',
    space_key: 'MAIN',
  }
  const payload = {
    interface_version: 'valkama-planning-work-item',
    scope: { kind: 'project', project_ref: { project_id: 'example-project' } },
    work_item_ref: { space_ref: spaceRef, reference: 'MAIN-264' },
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        work_item: {
          work_item_id: '739c3384-7bd5-4e4b-bf2d-30952ba76991',
          planning_space_id: '1bb894c1-220f-4173-91cf-dcd4b3a2259c',
          reference: 'MAIN-264',
          number: 264,
          title: 'Platform route /api/platform/<module>',
          kind: 'task',
          priority: 'high',
          state: {
            state_id: 'afd0b33d-830d-4ad2-83ea-800f6ae10720',
            key: 'dev',
            name: 'Dev',
            category: 'active',
            is_terminal: false,
          },
          claim_ref: 'codex',
          parent_id: null,
          labels: ['platform'],
          source: '',
          checklist: [],
          container: false,
          ready: false,
          revision: 4,
          created_at: '2026-08-13T08:00:00Z',
          updated_at: '2026-08-13T09:00:00Z',
          description: '',
          summary: null,
          summary_comment_id: null,
          links: [],
          refs: [],
          comments: [
            {
              id: 1,
              kind: 'comment',
              report: null,
              author: 'codex',
              body: 'Use /api/platform/<module> as inert text.',
              at: '2026-08-13T09:00:00Z',
            },
          ],
          events: [
            {
              action: 'created',
              detail: 'backlog',
              author: 'codex',
              at: '2026-08-13T08:00:00Z',
              identity: {
                state: 'confirmed',
                source: 'codex-meta',
                session_id: '019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e',
                agent_id: null,
              },
            } as Record<string, unknown>,
          ],
        },
      },
    },
  }
  return payload
}

test('Planning work-item payload accepts the populated shape without compatibility fields', () => {
  const result = validatePlanningWorkItemPayload(planningWorkItemPayload())
  assert.equal(result.state.status, 'ready')
  assert.equal(result.work_item_ref.reference, 'MAIN-264')
})

test('an event written before identity reads as unconfirmed and naming nobody', () => {
  const payload = planningWorkItemPayload()
  const event = payload.state.payload.work_item.events[0]
  if (event === undefined) throw new Error('Expected event fixture')
  event.identity = { state: 'unconfirmed', source: null, session_id: null, agent_id: null }
  const result = validatePlanningWorkItemPayload(payload)
  assert.equal(result.state.status, 'ready')
})

test.each([
  ['no identity at all', undefined],
  ['a state outside the two', { state: 'live', source: null, session_id: null, agent_id: null }],
  [
    'a field the contract does not name',
    { state: 'confirmed', source: 'browser', session_id: null, agent_id: null, tool: 'x' },
  ],
  ['a missing id field', { state: 'confirmed', source: 'browser', session_id: null }],
])('rejects an event identity with %s', (_label, identity) => {
  const payload = planningWorkItemPayload()
  const event = payload.state.payload.work_item.events[0]
  if (event === undefined) throw new Error('Expected event fixture')
  if (identity === undefined) delete event.identity
  else event.identity = identity
  expect(() => validatePlanningWorkItemPayload(payload)).toThrow()
})

test.each([
  { kind: 'report', report: null, body: '', at: null },
  {
    kind: 'comment',
    report: { done: 'Result', next: 'Next' },
    body: 'Text',
    at: '2026-08-13T09:00:00Z',
  },
  { kind: 'comment', report: null, body: '', at: '2026-08-13T09:00:00Z' },
  { kind: 'comment', report: null, body: 'Text', at: null },
])('rejects a malformed typed discussion entry: %o', (invalidEntry) => {
  const payload = planningWorkItemPayload()
  const entry = payload.state.payload.work_item.comments[0]
  if (entry === undefined) throw new Error('Expected discussion fixture')
  Object.assign(entry, invalidEntry)
  expect(() => validatePlanningWorkItemPayload(payload)).toThrow()
})

test('accepts an imported report with unknown time and rejects extra fields', () => {
  const payload = planningWorkItemPayload()
  const entry = payload.state.payload.work_item.comments[0]
  if (entry === undefined) throw new Error('Expected discussion fixture')
  Object.assign(entry, {
    kind: 'report',
    report: { done: 'Historical result', next: 'Review' },
    body: '',
    at: null,
  })
  expect(() => validatePlanningWorkItemPayload(payload)).not.toThrow()
  Object.assign(entry, { arbitrary: true })
  expect(() => validatePlanningWorkItemPayload(payload)).toThrow()
})
