/** The operating scope a route names, and how its path spells it. */

import { contractGuards } from '@/shared/api/contractGuards.ts'
import { validatePlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'

/**
 * Where work is looked at: every space, or one space, narrowed to one project when
 * `project_ref` names one. A project of another space may narrow it too, when items of
 * this space name it.
 */
type SpaceScope = {
  kind: 'space'
  space_ref: PlanningSpaceRef
  project_ref?: { project_id: string }
}
export type OperatingScope = { kind: 'global' } | SpaceScope

const PROJECT_ID = /^[a-z][a-z0-9-]{0,159}$/u
const DATA_SCOPE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SPACE_KEY = /^[A-Z][A-Z0-9]{1,7}$/u

class PlatformRouteValidationError extends Error {
  readonly code = 'platform_route_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlatformRouteValidationError'
  }
}

/** A route that breaks its contract, said by the path that broke it. */
export function invalid(path: string, detail: string): never {
  throw new PlatformRouteValidationError(`${path}: ${detail}`)
}

const { plainObject, exactKeys } = contractGuards(invalid)

export function validateOperatingScope(value: unknown, path = 'scope'): OperatingScope {
  const object = plainObject(value, path)
  if (object.kind === 'global') {
    exactKeys(object, ['kind'], path)
    return { kind: 'global' }
  }
  if (object.kind !== 'space') return invalid(`${path}.kind`, 'expected global or space')
  exactKeys(object, ['kind', 'space_ref', 'project_ref'], path)
  let space: PlanningSpaceRef
  try {
    space = validatePlanningSpaceRef(object.space_ref, `${path}.space_ref`)
  } catch (error) {
    return invalid(`${path}.space_ref`, error instanceof Error ? error.message : 'invalid')
  }
  if (object.project_ref === undefined) return { kind: 'space', space_ref: space }
  const project = plainObject(object.project_ref, `${path}.project_ref`)
  exactKeys(project, ['project_id'], `${path}.project_ref`)
  if (typeof project.project_id !== 'string' || !PROJECT_ID.test(project.project_id))
    invalid(`${path}.project_ref.project_id`, 'expected bounded project id')
  return { kind: 'space', space_ref: space, project_ref: { project_id: project.project_id } }
}

/** Whether two scopes are one place: the same space, narrowed by the same project or by none. */
export function sameScope(left: OperatingScope, right: OperatingScope): boolean {
  return left.kind === 'global' || right.kind === 'global'
    ? left.kind === right.kind
    : left.space_ref.data_scope_id === right.space_ref.data_scope_id &&
        left.space_ref.space_key === right.space_ref.space_key &&
        left.project_ref?.project_id === right.project_ref?.project_id
}

export function decodePathSegment(raw: string, path: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return invalid(path, 'invalid percent-encoding')
  }
}

/**
 * One path segment that has to match `pattern`.
 *
 * Canonical means the encoded form round-trips exactly: two spellings of one id
 * would be two URLs for one place, and `.`/`..` are refused before they can be
 * read as a path at all.
 */
function pathSegment(raw: string, name: string, pattern: RegExp): string {
  const path = `url.pathname.${name}`
  if (raw.length === 0) invalid(path, `${name} is required`)
  const value = decodePathSegment(raw, path)
  if (!pattern.test(value) || value === '.' || value === '..') invalid(path, `invalid ${name}`)
  if (encodeURIComponent(value) !== raw)
    invalid(path, `${name} must be canonically percent-encoded`)
  return value
}

/**
 * The scope the segments after the module spell: `global`, `space/<data_scope_id>/<key>`,
 * and the same followed by `project/<project_id>`. The store's identity stands before the
 * key because a key is unique only inside its store.
 */
export function scopeOfPath(rest: readonly string[]): OperatingScope {
  if (rest.length === 1 && rest[0] === 'global') return { kind: 'global' }
  const narrowed = rest.length === 5 && rest[3] === 'project'
  if (rest[0] !== 'space' || (rest.length !== 3 && !narrowed))
    invalid('url.pathname', 'invalid operating scope route')
  const space_ref = {
    data_scope_id: pathSegment(rest[1], 'data_scope_id', DATA_SCOPE_ID),
    space_key: pathSegment(rest[2], 'space_key', SPACE_KEY),
  }
  if (!narrowed) return { kind: 'space', space_ref }
  const project_id = pathSegment(rest[4], 'project_id', PROJECT_ID)
  return { kind: 'space', space_ref, project_ref: { project_id } }
}

/** The part of a route's path its scope spells. */
export function scopePath(scope: OperatingScope): string {
  if (scope.kind === 'global') return 'global'
  const { data_scope_id, space_key } = scope.space_ref
  const space = `space/${encodeURIComponent(data_scope_id)}/${encodeURIComponent(space_key)}`
  return scope.project_ref === undefined
    ? space
    : `${space}/project/${encodeURIComponent(scope.project_ref.project_id)}`
}
