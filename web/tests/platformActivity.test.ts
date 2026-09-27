import assert from 'node:assert/strict'

import { test } from 'vitest'

import { resolveActivityRoute } from '@/app/composables/usePlatformLiveFeed.ts'

import { validatePlatformActivityPayload } from '@/shared/api/platformActivity.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'

import { moduleRegistrations } from './support/moduleRegistrations.ts'

const spaceRef = { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', space_key: 'MAIN' }
const projectRef = { project_id: 'project-alpha' }
const wireRow = {
  event_id: 1,
  work_item_id: '739c3384-7bd5-4e4b-bf2d-30952ba76991',
  reference: 'MAIN-42',
  title: 'Bounded work',
  action: 'claimed',
  detail: 'Assigned',
  state_category: null,
  author: 'codex',
  at: '2026-08-21T12:00:00Z',
}
const context = {
  primary: { data_scope_id: spaceRef.data_scope_id, is_writable: true },
  projects: [
    {
      binding_state: 'mapped',
      project_id: projectRef.project_id,
      resources: [{ resource_ref: planningSpaceEntity(spaceRef), state: 'mapped' }],
      title: 'Alpha',
    },
  ],
  ui_prefs: null,
} as PlatformContextReady

test('an activity row is a reference and a presentation, never a stored identity', () => {
  assert.deepEqual(validatePlatformActivityPayload([wireRow]), [
    {
      activity_id: 1,
      actor: 'codex',
      observed_at: '2026-08-21T12:00:00Z',
      reference: 'MAIN-42',
      state_category: null,
      status: 'claimed',
      summary: 'Assigned',
      title: 'Bounded work',
    },
  ])
})

test('a row with an unexpected field is refused rather than partly read', () => {
  assert.throws(
    () => validatePlatformActivityPayload([{ ...wireRow, entity_ref: {} }]),
    /unknown field/,
  )
  const withoutReference: Record<string, unknown> = { ...wireRow }
  delete withoutReference.reference
  assert.throws(() => validatePlatformActivityPayload([withoutReference]), /missing field/)
})

test('navigation resolves through the one bound project answering to that space', () => {
  const [activity] = validatePlatformActivityPayload([wireRow])
  assert.deepEqual(resolveActivityRoute(activity, context, moduleRegistrations()), {
    module_id: 'planning',
    scope: { kind: 'project', project_ref: projectRef },
    entity: planningWorkItemEntity({ space_ref: spaceRef, reference: 'MAIN-42' }),
  })
})

test('an unmapped space and a key two projects answer to are both unbound', () => {
  const [elsewhere] = validatePlatformActivityPayload([{ ...wireRow, reference: 'OTHER-42' }])
  assert.equal(resolveActivityRoute(elsewhere, context, moduleRegistrations()), null)

  // Two stores may each keep a space keyed MAIN. Answering anyway would open
  // whichever project happened to be listed first.
  const ambiguous = {
    ...context,
    projects: [
      ...context.projects,
      {
        binding_state: 'mapped',
        project_id: 'project-beta',
        resources: [
          {
            resource_ref: planningSpaceEntity({
              data_scope_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              space_key: 'MAIN',
            }),
            state: 'mapped',
          },
        ],
        title: 'Beta',
      },
    ],
  } as PlatformContextReady
  const [activity] = validatePlatformActivityPayload([wireRow])
  assert.equal(resolveActivityRoute(activity, ambiguous, moduleRegistrations()), null)
})
