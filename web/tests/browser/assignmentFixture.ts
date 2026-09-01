import assert from 'node:assert/strict'

import type { PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'

import { projectId } from './planningFixtures.ts'
import { rebuildRegistryCapabilities } from './platformFixtures.ts'

export type AssignmentSelectionInput = {
  capability_id: string
  expected_revision: number
  operation: 'set' | 'reset'
  scope: { kind: 'project'; project_id: string }
  connection_ids?: string[]
}

type MutableRegistry = Pick<PlatformRegistryReady, 'assignments' | 'capabilities' | 'connections'>

export function applyAssignmentSelection(
  body: AssignmentSelectionInput,
  registry: MutableRegistry,
) {
  assert.deepEqual(body.scope, { kind: 'project', project_id: projectId })
  const currentIndex = registry.assignments.findIndex(
    (assignment) =>
      assignment.capability_id === body.capability_id &&
      assignment.scope.kind === 'project' &&
      assignment.scope.project_id === projectId,
  )
  const current = registry.assignments[currentIndex]
  if ((current?.revision ?? 0) !== body.expected_revision)
    return { status: 409, body: { status: 'unavailable', reason: 'Assignment revision changed' } }
  let changed = null
  if (body.operation === 'reset') {
    if (currentIndex >= 0) registry.assignments.splice(currentIndex, 1)
  } else {
    assert.ok(body.connection_ids?.length)
    changed = {
      assignment_id: `project-${body.capability_id.replace('.', '-')}`,
      capability_id: body.capability_id,
      scope: body.scope,
      connection_ids: body.connection_ids,
      state: 'enabled' as const,
      changed_by: 'playwright',
      revision: (current?.revision ?? 0) + 1,
    }
    if (currentIndex >= 0) registry.assignments[currentIndex] = changed
    else registry.assignments.push(changed)
  }
  rebuildRegistryCapabilities(registry, true)
  const effective = registry.capabilities.find(
    (resolution) => resolution.capability.capability_id === body.capability_id,
  )
  assert.ok(effective)
  return {
    status: 200,
    body: {
      interface_version: 'valkama-assignment-selection',
      operation: body.operation,
      assignment: changed,
      effective,
    },
  }
}
