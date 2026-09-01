import assert from 'node:assert/strict'

import { test } from 'vitest'

import { resolveSessionWorkItemRoute } from '@/features/session-open/sessionWorkItemRoute.ts'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

import { moduleRegistrations } from './support/moduleRegistrations.ts'

const exactSpace = {
  data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  space_key: 'MAIN',
}
const exactResource = planningSpaceEntity(exactSpace) as PlanningSpaceEntityRef
const sameKeyDifferentStore = planningSpaceEntity({
  data_scope_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  space_key: 'MAIN',
})
const context = {
  primary: { data_scope_id: exactSpace.data_scope_id, is_writable: true },
  projects: [
    {
      binding_state: 'mapped',
      project_id: 'project-alpha',
      resources: [{ resource_ref: exactResource, state: 'mapped' }],
      source_hash: 'a'.repeat(64),
      title: 'Unrelated presentation title',
    },
    {
      binding_state: 'mapped',
      project_id: 'project-beta',
      resources: [{ resource_ref: sameKeyDifferentStore, state: 'mapped' }],
      source_hash: 'b'.repeat(64),
      title: 'MAIN',
    },
  ],
  ui_prefs: null,
} as PlatformContextReady

test('session work-item navigation resolves only the exact canonical resource binding', () => {
  assert.deepEqual(
    resolveSessionWorkItemRoute(exactResource, 'MAIN-42', context, moduleRegistrations()),
    {
      module_id: 'planning',
      scope: { kind: 'project', project_ref: { project_id: 'project-alpha' } },
      entity: planningWorkItemEntity({ space_ref: exactSpace, reference: 'MAIN-42' }),
    },
  )
})

test('session work-item navigation refuses missing, duplicate, and malformed exact identities', () => {
  const duplicate = {
    ...context,
    projects: [
      ...context.projects,
      {
        binding_state: 'mapped',
        project_id: 'project-duplicate',
        resources: [{ resource_ref: exactResource, state: 'mapped' }],
        source_hash: 'c'.repeat(64),
        title: 'Duplicate',
      },
    ],
  } as PlatformContextReady
  assert.equal(
    resolveSessionWorkItemRoute(exactResource, 'MAIN-42', duplicate, moduleRegistrations()),
    null,
  )
  assert.equal(
    resolveSessionWorkItemRoute(
      { kind: 'planning-space', resource_id: 'opaque' },
      'MAIN-42',
      context,
      moduleRegistrations(),
    ),
    null,
  )
  assert.equal(
    resolveSessionWorkItemRoute(exactResource, 'MAIN-42', null, moduleRegistrations()),
    null,
  )
  assert.equal(
    resolveSessionWorkItemRoute(exactResource, 'OTHER-42', context, moduleRegistrations()),
    null,
  )
})
