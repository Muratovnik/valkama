/** Planning-owned space/work-item wire types. */

import type { WorkflowState, WorkItem } from '@/shared/api/planningModel.ts'
import type { BindingState } from '@/shared/api/platformApiTypes.ts'
import type { PlanningSpaceRef, WorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

export const PLANNING_INTERFACE = 'valkama-planning' as const
export const PLANNING_WORK_ITEM_INTERFACE = 'valkama-planning-work-item' as const

/**
 * One item as the Kernel names it: enough to list, not enough to work on.
 *
 * The Kernel answers with a flat sequence and each item's own state; the Board
 * era answered with items already sorted into six lanes, which is what made
 * Kanban the model rather than one view of it.
 */
type PlanningWorkItemSummary = {
  claim_ref: string
  labels: string[]
  priority: WorkItem['priority']
  revision: number
  state_category: WorkflowState['category']
  state_key: string
  title: string
  updated_at: string
  work_item_ref: WorkItemRef
}

type PlanningSpaceSummary = {
  space_ref: PlanningSpaceRef
  title: string
  work_item_count: number
}

type PlanningSpaceView = {
  space_ref: PlanningSpaceRef
  title: string
  work_items: PlanningWorkItemSummary[]
}

export type PlatformPlanningReady = {
  planning_spaces: PlanningSpaceView[]
  projects: Array<{
    binding_state: BindingState
    planning_spaces: PlanningSpaceSummary[]
    project_id: string
    title: string
  }>
}

export type PlatformPlanningPayload = {
  interface_version: typeof PLANNING_INTERFACE
  scope: OperatingScope
  state: PlatformUiState<PlatformPlanningReady>
}

/** One work item: the full record the card draws, or the brief a preview draws. */
export type PlanningWorkItemReady<Item = WorkItem> = {
  work_item: Item
}

export type PlanningWorkItemPayload<Item = WorkItem> = {
  interface_version: typeof PLANNING_WORK_ITEM_INTERFACE
  scope: OperatingScope
  state: PlatformUiState<PlanningWorkItemReady<Item>>
  work_item_ref: WorkItemRef
}
