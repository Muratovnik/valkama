import assert from 'node:assert/strict'

import { test } from 'vitest'

import { validatePlatformPlanningPayload } from '@/shared/api/platformPlanningPayload.ts'

/** The directory at every space: each space with its projects, and none of their items. */
function payload() {
  return {
    interface_version: 'valkama-planning',
    scope: { kind: 'global' },
    state: {
      interface_version: 'valkama-ui-state',
      payload: {
        planning_spaces: [],
        spaces: [
          {
            space_ref: { data_scope_id: '123e4567-e89b-42d3-a456-426614174000', space_key: 'MAIN' },
            title: 'Main',
            work_item_count: 3,
            numbers: { triage: 1, ready: 1, active: 1, waiting_owner: 0 },
            numbers_absent: null,
            default_project: 'main-project',
            projects: [
              { project_id: 'main-project', display_name: 'Main project' },
              { project_id: 'side-project', display_name: 'Side project' },
            ],
          },
        ],
      },
      status: 'ready',
    },
  }
}

type Space = Record<string, unknown>
const firstSpace = (value: ReturnType<typeof payload>) => value.state.payload.spaces[0] as Space

test('the directory names each space with its projects and its default one', () => {
  const read = validatePlatformPlanningPayload(payload()).state
  assert.equal(read.status, 'ready')
  assert.deepEqual(
    read.status === 'ready' && read.payload.spaces[0]?.projects.map((item) => item.project_id),
    ['main-project', 'side-project'],
  )
})

test('a space no project is bound to has no default and no projects', () => {
  const unbound = payload()
  Object.assign(firstSpace(unbound), { default_project: null, projects: [] })
  assert.equal(validatePlatformPlanningPayload(unbound).state.status, 'ready')
})

test('a space without its projects, or with the binding the directory no longer says, is refused', () => {
  const missing = payload()
  delete firstSpace(missing).projects
  assert.throws(() => validatePlatformPlanningPayload(missing), /projects/)

  const legacy = payload()
  firstSpace(legacy).binding_state = 'mapped'
  assert.throws(() => validatePlatformPlanningPayload(legacy), /binding_state/)
})
