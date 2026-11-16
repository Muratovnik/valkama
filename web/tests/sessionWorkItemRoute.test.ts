import assert from 'node:assert/strict'

import { test } from 'vitest'

import { resolveSessionWorkItemRoute } from '@/features/session-open/sessionWorkItemRoute.ts'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import {
  planningSpaceEntity,
  planningSpaceRef,
  planningWorkItemEntity,
} from '@/shared/api/platformPlanningRefs.ts'
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
const listed = (space: { data_scope_id: string; space_key: string }) => ({
  ...space,
  name: 'Unrelated presentation title',
  default_project: null,
  projects: [],
  other_space_projects: [],
})
const context: PlatformContextReady = {
  primary: { data_scope_id: exactSpace.data_scope_id, is_writable: true },
  spaces: [listed(exactSpace)],
  ui_prefs: null,
}

test('session work-item navigation opens the card in the exact space that holds it', () => {
  assert.deepEqual(
    resolveSessionWorkItemRoute(exactResource, 'MAIN-42', context, moduleRegistrations()),
    {
      module_id: 'planning',
      scope: { kind: 'space', space_ref: exactSpace },
      entity: planningWorkItemEntity({ space_ref: exactSpace, reference: 'MAIN-42' }),
    },
  )
})

test('session work-item navigation refuses an unlisted space and malformed exact identities', () => {
  // A space of the same key in another store is not the space the session names.
  const elsewhere: PlatformContextReady = {
    ...context,
    spaces: [listed(planningSpaceRef(sameKeyDifferentStore) ?? exactSpace)],
  }
  assert.equal(
    resolveSessionWorkItemRoute(exactResource, 'MAIN-42', elsewhere, moduleRegistrations()),
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
