import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  planningSpaceEntity,
  planningSpaceRef,
  planningWorkItemEntity,
  planningWorkItemRef,
  resolvePlanningRouteSelection,
} from '@/shared/api/platformPlanningRefs.ts'

const spaceRef = { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', space_key: 'MAIN' }
const otherSpaceRef = {
  data_scope_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  space_key: 'OTHER',
}

test('Planning refs alone own canonical storage conversion', () => {
  const space = planningSpaceEntity(spaceRef)
  const workItem = planningWorkItemEntity({ space_ref: spaceRef, reference: 'MAIN-42' })
  assert.deepEqual(planningSpaceRef(space), spaceRef)
  assert.deepEqual(planningWorkItemRef(workItem), { space_ref: spaceRef, reference: 'MAIN-42' })
})

test('a present Planning entity must decode and belong to the selected project', () => {
  const resources = [planningSpaceEntity(spaceRef)]
  const matching = planningWorkItemEntity({ space_ref: spaceRef, reference: 'MAIN-42' })
  assert.equal(resolvePlanningRouteSelection(matching, resources, true).status, 'ready')
  assert.deepEqual(
    resolvePlanningRouteSelection(planningSpaceEntity(otherSpaceRef), resources, true),
    { status: 'unavailable', reason: 'resource-not-mapped' },
  )
  assert.deepEqual(
    resolvePlanningRouteSelection(
      { kind: 'planning-space', resource_id: 'opaque' },
      resources,
      true,
    ),
    { status: 'unavailable', reason: 'invalid-planning-entity' },
  )
  assert.deepEqual(
    resolvePlanningRouteSelection(
      { kind: 'session', client_family: 'codex', session_id: 'session-1' },
      resources,
      true,
    ),
    { status: 'unavailable', reason: 'invalid-planning-entity' },
  )
})

test('only an absent entity may use the exact sole mapped Planning resource', () => {
  const resources = [planningSpaceEntity(spaceRef)]
  assert.deepEqual(resolvePlanningRouteSelection(undefined, resources, true), {
    status: 'ready',
    space_ref: spaceRef,
  })
  assert.equal(
    resolvePlanningRouteSelection(
      { kind: 'planning-space', resource_id: 'opaque' },
      resources,
      true,
    ).status,
    'unavailable',
  )
})
