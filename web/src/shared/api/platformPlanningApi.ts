/** HTTP ownership for Planning's space and work-item projections. */

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { requestUnknown, scopeQuery } from '@/shared/api/platformApi.ts'
import { assertScope, canonicalJson, invalid } from '@/shared/api/platformApiGuards.ts'
import {
  validatePlanningWorkItemBriefPayload,
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
  if (scope.kind === 'global') query.set('directory_only', 'true')
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

function workItemQuery(scope: OperatingScope, value: WorkItemRef): URLSearchParams {
  if (scope.kind !== 'project') invalid('scope', 'exact work item reads require Project scope')
  const query = scopeQuery(scope)
  query.set('data_scope_id', value.space_ref.data_scope_id)
  query.set('space_key', value.space_ref.space_key)
  query.set('reference', value.reference)
  return query
}

function assertWorkItemAnswer(
  payload: PlanningWorkItemPayload<unknown>,
  scope: OperatingScope,
  value: WorkItemRef,
) {
  assertScope(payload.scope, scope, 'work_item.scope')
  if (canonicalJson(payload.work_item_ref) !== canonicalJson(value))
    invalid('work_item.work_item_ref', 'response work_item_ref does not match request')
}

export async function fetchPlanningWorkItem(
  scope: OperatingScope,
  value: WorkItemRef,
): Promise<PlanningWorkItemPayload> {
  const query = workItemQuery(scope, value)
  const payload = validatePlanningWorkItemPayload(
    await requestUnknown(`/api/modules/planning/work-item?${query}`),
  )
  assertWorkItemAnswer(payload, scope, value)
  return payload
}

/**
 * One item's brief record, what a preview of its reference draws. A refusal
 * keeps its HTTP status, so a caller tells a missing item (404) from a store
 * that went away (409); closing the preview aborts the read.
 */
export async function fetchPlanningWorkItemBrief(
  scope: OperatingScope,
  value: WorkItemRef,
  signal: AbortSignal,
): Promise<PlanningWorkItemPayload<WorkItemBrief>> {
  const query = workItemQuery(scope, value)
  query.set('brief', 'true')
  const answer = await requestUnknown(`/api/modules/planning/work-item?${query}`, { signal })
  signal.throwIfAborted()
  const payload = validatePlanningWorkItemBriefPayload(answer)
  assertWorkItemAnswer(payload, scope, value)
  return payload
}
