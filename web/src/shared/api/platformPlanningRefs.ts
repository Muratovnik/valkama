/** Planning storage refs and their explicit adapter into neutral Kernel entities. */

import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import {
  exactKeys,
  invalid,
  plainObject,
  requiredString,
  UUID_LOWERCASE,
} from '@/shared/api/platformRelationGuards.ts'

/** The shape of a planning space key: short, uppercase, and stable. */
const SPACE_KEY = /^[A-Z][A-Z0-9]{1,7}$/u
/** The shape of a work item reference, which is a space key and a number. */
const WORK_ITEM_REFERENCE = /^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u

/**
 * A persisted Planning space identity.
 *
 * The Board era identified a space by the text a person typed above a column
 * wall, so renaming it broke every binding, route and stored relation pointing
 * at it. The key is what persists; the name above it is free to change.
 */
export type PlanningSpaceRef = {
  data_scope_id: string
  space_key: string
}

export type WorkItemRef = {
  reference: string
  space_ref: PlanningSpaceRef
}

export type PlanningRouteSelection =
  | { status: 'ready'; space_ref?: PlanningSpaceRef; work_item_ref?: WorkItemRef }
  | {
      reason: 'invalid-planning-entity' | 'resource-not-mapped' | 'resource-required'
      status: 'unavailable'
    }

export function validatePlanningSpaceRef(value: unknown, path = 'space_ref'): PlanningSpaceRef {
  const object = plainObject(value, path)
  exactKeys(object, ['data_scope_id', 'space_key'], path)
  return {
    data_scope_id: requiredString(
      object.data_scope_id,
      `${path}.data_scope_id`,
      UUID_LOWERCASE,
      36,
    ),
    space_key: requiredString(object.space_key, `${path}.space_key`, SPACE_KEY, 8),
  }
}

function validateWorkItemRef(value: unknown, path = 'work_item_ref'): WorkItemRef {
  const object = plainObject(value, path)
  exactKeys(object, ['space_ref', 'reference'], path)
  const spaceRef = validatePlanningSpaceRef(object.space_ref, `${path}.space_ref`)
  const reference = requiredString(object.reference, `${path}.reference`, WORK_ITEM_REFERENCE, 18)
  // A reference carries its own space, so a pair that disagrees is a bug that
  // would otherwise route a read to the wrong store.
  if (reference.split('-', 1)[0] !== spaceRef.space_key)
    invalid(`${path}.reference`, 'expected a reference belonging to its own space')
  return { reference, space_ref: spaceRef }
}

function encodePlanningResource(value: object): string {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/**
 * The exact JSON the server encodes: keys sorted, no spacing.
 *
 * Both sides derive the resource id from the bytes, so a differently ordered
 * object is a different identity for the same space.
 */
function compareKeys(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJson(item))
    return `[${items.join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      compareKeys(left, right),
    )
    const fields = entries.map(([key, held]) => `${JSON.stringify(key)}:${canonicalJson(held)}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

function decodePlanningResource(value: string, path: string): unknown {
  if (value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value))
    invalid(path, 'expected canonical Planning resource id')
  const padding = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ),
    ) as unknown
  } catch {
    return invalid(path, 'expected canonical Planning resource id')
  }
}

export function planningSpaceEntity(value: PlanningSpaceRef): EntityRef {
  const space = validatePlanningSpaceRef(value)
  return {
    kind: 'planning-space',
    resource_id: encodePlanningResource({
      data_scope_id: space.data_scope_id,
      space_key: space.space_key,
    }),
  }
}

export function planningSpaceRef(entity: EntityRef | undefined): PlanningSpaceRef | undefined {
  if (entity === undefined || entity.kind !== 'planning-space') return undefined
  const space = validatePlanningSpaceRef(
    decodePlanningResource(entity.resource_id, 'planning_space'),
  )
  if (resourceId(planningSpaceEntity(space)) !== entity.resource_id)
    invalid('planning_space', 'expected canonical Planning resource id')
  return space
}

export function planningWorkItemEntity(value: WorkItemRef): EntityRef {
  const item = validateWorkItemRef(value)
  return {
    kind: 'work-item',
    resource_id: encodePlanningResource({
      reference: item.reference,
      space_ref: {
        data_scope_id: item.space_ref.data_scope_id,
        space_key: item.space_ref.space_key,
      },
    }),
  }
}

export function planningWorkItemRef(entity: EntityRef | undefined): WorkItemRef | undefined {
  if (entity === undefined || entity.kind !== 'work-item') return undefined
  const item = validateWorkItemRef(decodePlanningResource(entity.resource_id, 'work_item'))
  if (resourceId(planningWorkItemEntity(item)) !== entity.resource_id)
    invalid('work_item', 'expected canonical Planning resource id')
  return item
}

/** The resource id of the arms that carry one; a session or a service has none. */
function resourceId(entity: EntityRef): string {
  return 'resource_id' in entity ? entity.resource_id : ''
}

function sameEntity(left: EntityRef, right: EntityRef): boolean {
  return left.kind === right.kind && resourceId(left) === resourceId(right)
}

function defaultPlanningSelection(
  mappedResources: readonly EntityRef[],
  projectScoped: boolean,
): PlanningRouteSelection {
  if (!projectScoped) return { status: 'ready' }
  if (mappedResources.length !== 1) return { status: 'unavailable', reason: 'resource-required' }
  try {
    const space = planningSpaceRef(mappedResources[0])
    return space
      ? { status: 'ready', space_ref: space }
      : { status: 'unavailable', reason: 'invalid-planning-entity' }
  } catch {
    return { status: 'unavailable', reason: 'invalid-planning-entity' }
  }
}

/**
 * Resolve a Planning entity only at the Planning boundary. A present invalid or
 * stale identity is an explicit refusal; it can never trigger the sole-resource
 * convenience default.
 */
export function resolvePlanningRouteSelection(
  entity: EntityRef | undefined,
  mappedResources: readonly EntityRef[],
  projectScoped: boolean,
): PlanningRouteSelection {
  if (entity === undefined) return defaultPlanningSelection(mappedResources, projectScoped)
  if (entity.kind !== 'planning-space' && entity.kind !== 'work-item')
    return { status: 'unavailable', reason: 'invalid-planning-entity' }
  try {
    const item = planningWorkItemRef(entity)
    const space = planningSpaceRef(entity) ?? item?.space_ref
    if (!space) return { status: 'unavailable', reason: 'invalid-planning-entity' }
    if (
      projectScoped &&
      !mappedResources.some((resource) => sameEntity(resource, planningSpaceEntity(space)))
    )
      return { status: 'unavailable', reason: 'resource-not-mapped' }
    return {
      status: 'ready',
      space_ref: space,
      ...(item ? { work_item_ref: item } : {}),
    }
  } catch {
    return { status: 'unavailable', reason: 'invalid-planning-entity' }
  }
}
