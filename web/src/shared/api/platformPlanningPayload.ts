/**
 * The planning read model and one work item, the two shapes Planning reads.
 */

import {
  boundedList,
  boundedText,
  fromValidator,
  parseContract,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { validateWorkItemBrief, validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import {
  BINDING_STATES,
  enumField,
  invalid,
  ISO,
  PROJECT_ID,
} from '@/shared/api/platformApiGuards.ts'
import type { BindingState } from '@/shared/api/platformApiTypes.ts'
import { validateTypedState } from '@/shared/api/platformContextPayload.ts'
import { validatePlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import {
  PLANNING_INTERFACE,
  PLANNING_WORK_ITEM_INTERFACE,
} from '@/shared/api/platformPlanningTypes.ts'
import type {
  PlanningWorkItemPayload,
  PlanningWorkItemReady,
  PlatformPlanningPayload,
  PlatformPlanningReady,
} from '@/shared/api/platformPlanningTypes.ts'
import { validateOperatingScope } from '@/shared/api/platformRoute.ts'

const planningEnvelopeSchema = strictObject({
  interface_version: z.literal(PLANNING_INTERFACE, {
    message: `expected ${PLANNING_INTERFACE}`,
  }),
  scope: fromValidator(validateOperatingScope),
  state: z.unknown(),
})

/**
 * A space's or a project's name as the server keeps it: up to 200 characters,
 * brackets included. It is shown as text, never as markup.
 */
const displayName = () => boundedText(/^[^\u{0}]{1,200}$/u, 200)

const workItemRefSchema = strictObject({
  space_ref: fromValidator(validatePlanningSpaceRef),
  reference: boundedText(/^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u, 18),
})

const workItemSummarySchema = strictObject({
  work_item_ref: workItemRefSchema,
  title: boundedText(/^[^\u{0}]{1,1000}$/u, 1000),
  // The state is the space's own, so its key is text rather than one of six
  // names: a space that renames a state must not fall out of its own read model.
  state_key: boundedText(/^[a-z][a-z0-9_-]{0,39}$/u, 40),
  state_category: enumField([
    'backlog',
    'queued',
    'active',
    'review',
    'completed',
    'blocked',
    'cancelled',
  ] as const),
  priority: enumField(['low', 'medium', 'high', 'urgent'] as const),
  labels: boundedList(boundedText(/^[^\u{0}]{1,160}$/u, 160), 128),
  // An unheld item carries an empty claim, so this is a string and not a
  // bounded identifier.
  claim_ref: z.string(),
  revision: positiveInt(true),
  updated_at: boundedText(ISO, 96),
})

const spaceSummarySchema = strictObject({
  space_ref: fromValidator(validatePlanningSpaceRef),
  title: displayName(),
  work_item_count: positiveInt(true),
})

const spaceViewSchema = strictObject({
  space_ref: fromValidator(validatePlanningSpaceRef),
  title: displayName(),
  work_items: z.array(workItemSummarySchema),
})

const planningProjectSchema = strictObject({
  project_id: boundedText(PROJECT_ID, 160),
  title: displayName(),
  binding_state: z.enum([...BINDING_STATES] as [BindingState, ...BindingState[]], {
    message: 'unknown binding state',
  }),
  planning_spaces: boundedList(spaceSummarySchema, 128),
})

const planningReadySchema = strictObject({
  // The registry counts no projects, and a space holds as many items as it has.
  projects: z.array(planningProjectSchema),
  planning_spaces: z.array(spaceViewSchema),
})

function planningReady(value: unknown, path: string): PlatformPlanningReady {
  return parseContract(planningReadySchema, value, path, invalid)
}

export function validatePlatformPlanningPayload(
  value: unknown,
  path = 'planning',
): PlatformPlanningPayload {
  const record = parseContract(planningEnvelopeSchema, value, path, invalid)
  return {
    interface_version: PLANNING_INTERFACE,
    scope: record.scope,
    state: validateTypedState(record.state, `${path}.state`, planningReady),
  }
}

// The populated work item is Planning's own shape and is validated by Planning's
// own contract; this boundary owns the envelope around it.
const workItemReadySchema = strictObject({
  work_item: z.unknown(),
})

const planningWorkItemPayloadSchema = strictObject({
  interface_version: z.literal(PLANNING_WORK_ITEM_INTERFACE, {
    message: `expected ${PLANNING_WORK_ITEM_INTERFACE}`,
  }),
  scope: fromValidator(validateOperatingScope),
  work_item_ref: workItemRefSchema,
  state: z.unknown(),
})

function workItemPayload<Item>(
  value: unknown,
  path: string,
  validateRecord: (value: unknown, path: string) => Item,
): PlanningWorkItemPayload<Item> {
  const payload = parseContract(planningWorkItemPayloadSchema, value, path, invalid)
  const ready = (state: unknown, at: string): PlanningWorkItemReady<Item> => {
    const record = parseContract(workItemReadySchema, state, at, invalid)
    // The item is deep-cloned away from the caller's payload, so it stays a call.
    return { work_item: validateRecord(structuredClone(record.work_item), `${at}.work_item`) }
  }
  return {
    interface_version: PLANNING_WORK_ITEM_INTERFACE,
    scope: payload.scope,
    work_item_ref: payload.work_item_ref,
    state: validateTypedState(payload.state, `${path}.state`, ready),
  }
}

export function validatePlanningWorkItemPayload(
  value: unknown,
  path = 'planning_work_item',
): PlanningWorkItemPayload {
  return workItemPayload(value, path, validateWorkItemRecord)
}

/** The same read with `brief=true`: the item as its space's list carries it. */
export function validatePlanningWorkItemBriefPayload(
  value: unknown,
  path = 'planning_work_item',
): PlanningWorkItemPayload<WorkItemBrief> {
  return workItemPayload(value, path, validateWorkItemBrief)
}
