import assert from 'node:assert/strict'

import { test } from 'vitest'

import { validatePlatformPlanningPayload } from '@/shared/api/platformPlanningPayload.ts'

function payload() {
  return {
    interface_version: 'valkama-planning',
    scope: { kind: 'global' },
    state: {
      interface_version: 'valkama-ui-state',
      payload: {
        planning_spaces: [],
        projects: [
          {
            binding_state: 'unbound',
            planning_spaces: [],
            project_id: 'unbound-project',
            title: 'Unbound Project',
          },
        ],
      },
      status: 'ready',
    },
  }
}

test('Planning binding state is required and legacy presentation prose is rejected', () => {
  assert.equal(validatePlatformPlanningPayload(payload()).state.status, 'ready')

  const missing = payload()
  delete (missing.state.payload.projects[0] as Record<string, unknown>).binding_state
  assert.throws(
    () => validatePlatformPlanningPayload(missing),
    /binding_state.*unknown binding state/,
  )

  const legacy = payload()
  ;(legacy.state.payload.projects[0] as Record<string, unknown>).binding_reason =
    'No owner Planning-space binding'
  assert.throws(() => validatePlatformPlanningPayload(legacy), /binding_reason.*unknown field/)

  const unknown = payload()
  ;(unknown.state.payload.projects[0] as Record<string, unknown>).binding_state = 'blocked'
  assert.throws(() => validatePlatformPlanningPayload(unknown), /unknown binding state/)
})
