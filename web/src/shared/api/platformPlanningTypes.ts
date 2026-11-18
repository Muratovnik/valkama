/** Planning-owned space/work-item wire types. */

import type { ContainerState, WorkflowState, WorkItem } from '@/shared/api/planningModel.ts'
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
  container_state: ContainerState | null
  labels: string[]
  priority: WorkItem['priority']
  revision: number
  state_category: WorkflowState['category'] | null
  state_key: string | null
  title: string
  updated_at: string
  work_item_ref: WorkItemRef
}

/** Why a space's card has no numbers: an earlier build wrote its store, or it was not read. */
export const PORTFOLIO_NUMBERS_ABSENT = ['old_store', 'unreadable'] as const

/** The four numbers of a space's card, the ones its Volumes page counts. */
type PortfolioNumbers = {
  active: number
  ready: number
  triage: number
  waiting_owner: number
}

type PlanningSpaceSummary = {
  default_project: string | null
  numbers: PortfolioNumbers | null
  numbers_absent: (typeof PORTFOLIO_NUMBERS_ABSENT)[number] | null
  projects: Array<{ display_name: string; project_id: string }>
  space_ref: PlanningSpaceRef
  title: string
  work_item_count: number | null
}

type PlanningSpaceView = {
  space_ref: PlanningSpaceRef
  title: string
  work_items: PlanningWorkItemSummary[]
}

export type PlatformPlanningReady = {
  planning_spaces: PlanningSpaceView[]
  spaces: PlanningSpaceSummary[]
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
