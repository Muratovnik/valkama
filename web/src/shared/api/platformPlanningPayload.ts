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
import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { invalid } from '@/shared/api/platformActionRef.ts'
import { BINDING_STATES, enumField, ISO, PROJECT_ID } from '@/shared/api/platformApiGuards.ts'
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
import { validatePlatformRelationsPayload } from '@/shared/api/platformRelations.ts'
import { validateOperatingScope } from '@/shared/api/platformRoute.ts'

const planningEnvelopeSchema = strictObject({
  interface_version: z.literal(PLANNING_INTERFACE, {
    message: `expected ${PLANNING_INTERFACE}`,
  }),
  scope: fromValidator(validateOperatingScope),
  state: z.unknown(),
})

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
  title: boundedText(/^[^<>\u{0}-\u{1F}]{1,160}$/u, 160),
  work_item_count: positiveInt(true),
})

const spaceViewSchema = strictObject({
  space_ref: fromValidator(validatePlanningSpaceRef),
  title: boundedText(/^[^<>\u{0}-\u{1F}]{1,160}$/u, 160),
  work_items: boundedList(workItemSummarySchema, 20_000),
})

const planningProjectSchema = strictObject({
  project_id: boundedText(PROJECT_ID, 160),
  title: boundedText(/^[^<>\u{0}-\u{1F}]{1,160}$/u, 160),
  binding_state: z.enum([...BINDING_STATES] as [BindingState, ...BindingState[]], {
    message: 'unknown binding state',
  }),
  planning_spaces: boundedList(spaceSummarySchema, 128),
})

const planningReadySchema = strictObject({
  projects: boundedList(planningProjectSchema, 256),
  planning_spaces: boundedList(spaceViewSchema, 1024),
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
// own contract; this boundary owns the envelope around it and the Kernel
// relations beside it.
const workItemReadySchema = strictObject({
  work_item: z.unknown(),
  relations: fromValidator(validatePlatformRelationsPayload),
})

function workItem(value: unknown, path: string): WorkItem {
  return validateWorkItemRecord(structuredClone(value), path)
}

function planningWorkItemReady(value: unknown, path: string): PlanningWorkItemReady {
  const record = parseContract(workItemReadySchema, value, path, invalid)
  // The item is deep-cloned away from the caller's payload, so it stays a call.
  return { relations: record.relations, work_item: workItem(record.work_item, `${path}.work_item`) }
}

const planningWorkItemPayloadSchema = strictObject({
  interface_version: z.literal(PLANNING_WORK_ITEM_INTERFACE, {
    message: `expected ${PLANNING_WORK_ITEM_INTERFACE}`,
  }),
  scope: fromValidator(validateOperatingScope),
  work_item_ref: workItemRefSchema,
  state: z.unknown(),
})

export function validatePlanningWorkItemPayload(
  value: unknown,
  path = 'planning_work_item',
): PlanningWorkItemPayload {
  const record = parseContract(planningWorkItemPayloadSchema, value, path, invalid)
  return {
    interface_version: PLANNING_WORK_ITEM_INTERFACE,
    scope: record.scope,
    work_item_ref: record.work_item_ref,
    state: validateTypedState(record.state, `${path}.state`, planningWorkItemReady),
  }
}
