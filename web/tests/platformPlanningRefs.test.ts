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

test('a present Planning entity must decode and belong to the space the scope names', () => {
  const matching = planningWorkItemEntity({ space_ref: spaceRef, reference: 'MAIN-42' })
  assert.deepEqual(resolvePlanningRouteSelection(matching, spaceRef), {
    status: 'ready',
    space_ref: spaceRef,
    work_item_ref: { space_ref: spaceRef, reference: 'MAIN-42' },
  })
  assert.deepEqual(resolvePlanningRouteSelection(planningSpaceEntity(otherSpaceRef), spaceRef), {
    status: 'unavailable',
    reason: 'other-space',
  })
  assert.deepEqual(
    resolvePlanningRouteSelection({ kind: 'planning-space', resource_id: 'opaque' }, spaceRef),
    { status: 'unavailable', reason: 'invalid-planning-entity' },
  )
  assert.deepEqual(
    resolvePlanningRouteSelection(
      { kind: 'session', client_family: 'codex', session_id: 'session-1' },
      spaceRef,
    ),
    { status: 'unavailable', reason: 'invalid-planning-entity' },
  )
})

test('a space without an entity opens the space itself, and every space opens any card', () => {
  assert.deepEqual(resolvePlanningRouteSelection(undefined, spaceRef), {
    status: 'ready',
    space_ref: spaceRef,
  })
  assert.deepEqual(resolvePlanningRouteSelection(undefined), { status: 'ready' })
  assert.equal(
    resolvePlanningRouteSelection(
      planningWorkItemEntity({ space_ref: otherSpaceRef, reference: 'OTHER-1' }),
    ).status,
    'ready',
  )
  assert.equal(
    resolvePlanningRouteSelection({ kind: 'planning-space', resource_id: 'opaque' }).status,
    'unavailable',
  )
})
