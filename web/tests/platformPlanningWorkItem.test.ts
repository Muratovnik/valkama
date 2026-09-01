import assert from 'node:assert/strict'

import { test } from 'vitest'

import { validatePlanningWorkItemPayload } from '@/shared/api/platformPlanningPayload.ts'

test('Planning work-item payload accepts the populated shape without compatibility fields', () => {
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
          links: [],
          refs: [],
          comments: [
            {
              author: 'codex',
              body: 'Use /api/platform/<module> as inert text.',
              at: '2026-08-13T09:00:00Z',
            },
          ],
          events: [
            { action: 'created', detail: 'backlog', author: 'codex', at: '2026-08-13T08:00:00Z' },
          ],
        },
        relations: { interface_version: 'valkama-relations', relations: [] },
      },
    },
  }
  const result = validatePlanningWorkItemPayload(payload)
  assert.equal(result.state.status, 'ready')
  assert.equal(result.work_item_ref.reference, 'MAIN-264')
})
