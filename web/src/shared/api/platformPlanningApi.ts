/** HTTP ownership for Planning's space and work-item projections. */

import { invalid } from '@/shared/api/platformActionRef.ts'
import { requestUnknown, scopeQuery } from '@/shared/api/platformApi.ts'
import { assertScope, canonicalJson } from '@/shared/api/platformApiGuards.ts'
import {
  validatePlanningWorkItemPayload,
  validatePlatformPlanningPayload,
} from '@/shared/api/platformPlanningPayload.ts'
import type { PlanningSpaceRef, WorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import type {
  PlanningWorkItemPayload,
  PlatformPlanningPayload,
} from '@/shared/api/platformPlanningTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'

export async function fetchPlatformPlanning(
  scope: OperatingScope,
  space?: PlanningSpaceRef,
): Promise<PlatformPlanningPayload> {
  if (scope.kind === 'project' && space === undefined)
    invalid('space_ref', 'Project planning requires an exact space binding')
  const query = scopeQuery(scope)
  if (space !== undefined) {
    query.set('data_scope_id', space.data_scope_id)
    query.set('space_key', space.space_key)
  }
  const payload = validatePlatformPlanningPayload(
    await requestUnknown(`/api/platform/planning?${query}`),
  )
  assertScope(payload.scope, scope, 'planning.scope')
  return payload
}

export async function fetchPlanningWorkItem(
  scope: OperatingScope,
  value: WorkItemRef,
): Promise<PlanningWorkItemPayload> {
  if (scope.kind !== 'project') invalid('scope', 'exact work item reads require Project scope')
  const query = scopeQuery(scope)
  query.set('data_scope_id', value.space_ref.data_scope_id)
  query.set('space_key', value.space_ref.space_key)
  query.set('reference', value.reference)
  const payload = validatePlanningWorkItemPayload(
    await requestUnknown(`/api/modules/planning/work-item?${query}`),
  )
  assertScope(payload.scope, scope, 'work_item.scope')
  if (canonicalJson(payload.work_item_ref) !== canonicalJson(value))
    invalid('work_item.work_item_ref', 'response work_item_ref does not match request')
  return payload
}
