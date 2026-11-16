/** HTTP ownership for Planning's space and work-item projections. */

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { requestUnknown, scopeQuery } from '@/shared/api/platformApi.ts'
import { assertScope, canonicalJson, invalid } from '@/shared/api/platformApiGuards.ts'
import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
  validatePlatformPlanningPayload,
} from '@/shared/api/platformPlanningPayload.ts'
import type { WorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import type {
  PlanningWorkItemPayload,
  PlatformPlanningPayload,
} from '@/shared/api/platformPlanningTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'

/** The directory at global scope: every space with its projects, and none of their items. */
export async function fetchPlatformPlanning(): Promise<PlatformPlanningPayload> {
  const scope: OperatingScope = { kind: 'global' }
  const query = scopeQuery(scope)
  query.set('directory_only', 'true')
  const payload = validatePlatformPlanningPayload(
    await requestUnknown(`/api/platform/planning?${query}`),
  )
  assertScope(payload.scope, scope, 'planning.scope')
  return payload
}

/** A work item is read in the scope of its own space, which its reference names. */
function workItemScope(value: WorkItemRef): OperatingScope {
  return { kind: 'space', space_ref: value.space_ref }
}

function workItemQuery(value: WorkItemRef): URLSearchParams {
  const query = scopeQuery(workItemScope(value))
  query.set('reference', value.reference)
  return query
}

function assertWorkItemAnswer(payload: PlanningWorkItemPayload<unknown>, value: WorkItemRef) {
  assertScope(payload.scope, workItemScope(value), 'work_item.scope')
  if (canonicalJson(payload.work_item_ref) !== canonicalJson(value))
    invalid('work_item.work_item_ref', 'response work_item_ref does not match request')
}

export async function fetchPlanningWorkItem(value: WorkItemRef): Promise<PlanningWorkItemPayload> {
  const query = workItemQuery(value)
  const payload = validatePlanningWorkItemPayload(
    await requestUnknown(`/api/modules/planning/work-item?${query}`),
  )
  assertWorkItemAnswer(payload, value)
  return payload
}

/**
 * One item's brief record, what a preview of its reference draws. A refusal
 * keeps its HTTP status, so a caller tells a missing item (404) from a store
 * that went away (409); closing the preview aborts the read.
 */
export async function fetchPlanningWorkItemBrief(
  value: WorkItemRef,
  signal: AbortSignal,
): Promise<PlanningWorkItemPayload<WorkItemBrief>> {
  const query = workItemQuery(value)
  query.set('brief', 'true')
  const answer = await requestUnknown(`/api/modules/planning/work-item?${query}`, { signal })
  signal.throwIfAborted()
  const payload = validatePlanningWorkItemBriefPayload(answer)
  assertWorkItemAnswer(payload, value)
  return payload
}
