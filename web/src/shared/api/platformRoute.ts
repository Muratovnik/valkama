/** Canonical clean-start Platform route (module + required Global/Project scope). */

import {
  contractGuards,
  MAX_CONTRACT_DEPTH,
  MAX_CONTRACT_NODES,
  POLLUTION_KEYS,
} from '@/shared/api/contractGuards.ts'
import { validateEntityRef } from '@/shared/api/platformEntityRef.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleId, ModuleManifest } from '@/shared/api/platformModuleContract.ts'

export type OperatingScope =
  { kind: 'global' } | { kind: 'project'; project_ref: { project_id: string } }

const MAX_ENTITY_BYTES = 4096
const MAX_STATE_BYTES = 4096
const BASE64URL = /^[A-Za-z0-9_-]+$/u
const MODULE_ID = /^[a-z][a-z0-9-]{0,63}$/u
const PROJECT_ID = /^[a-z][a-z0-9-]{0,159}$/u

export type PlatformRouteUnavailable = {
  input_module_id: string
  input_scope: OperatingScope
  reason:
    | 'unknown-module'
    | 'disabled-module'
    | 'unsupported-view'
    | 'unsupported-scope'
    | 'incompatible-entity'
  recovery: {
    available_modules: readonly ModuleId[]
    kind: 'choose-module'
  }
  status: 'unavailable'
}

export type PlatformRouteResolution = PlatformRoute | PlatformRouteUnavailable
type ModuleRouteState = Record<string, string | number | boolean>

export type PlatformRoute = {
  module_id: ModuleId
  scope: OperatingScope
  entity?: EntityRef
  state?: Record<string, string | number | boolean>
}

export type ManifestRouteAuthority =
  | { status: 'ready' }
  | { reason: 'unsupported-scope' | 'incompatible-entity'; status: 'unavailable' }

class PlatformRouteValidationError extends Error {
  readonly code = 'platform_route_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlatformRouteValidationError'
  }
}

function invalid(path: string, detail: string): never {
  throw new PlatformRouteValidationError(`${path}: ${detail}`)
}

const { plainObject, exactKeys } = contractGuards(invalid)

function canonicalJson(
  value: unknown,
  path = 'json',
  depth = 0,
  seen = new WeakSet<object>(),
): string {
  if (depth > MAX_CONTRACT_DEPTH) invalid(path, `payload exceeds depth ${MAX_CONTRACT_DEPTH}`)
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return canonicalArrayJson(value, path, depth, seen)
  if (typeof value === 'object') return canonicalObjectJson(value, path, depth, seen)
  return invalid(path, 'unsupported JSON value')
}

/** `[a,b,c]` with every entry canonical, refusing a cycle or an oversized list. */
function canonicalArrayJson(
  value: unknown[],
  path: string,
  depth: number,
  seen: WeakSet<object>,
): string {
  if (seen.has(value)) invalid(path, 'cyclic payload is not allowed')
  if (value.length > MAX_CONTRACT_NODES)
    invalid(path, `payload exceeds ${MAX_CONTRACT_NODES} values`)
  seen.add(value)
  const encoded = value.map((entry, index) =>
    canonicalJson(entry, `${path}[${index}]`, depth + 1, seen),
  )
  const result = `[${encoded.join(',')}]`
  seen.delete(value)
  return result
}

/** `{"a":1}` with keys sorted, which is what makes one payload one string. */
function canonicalObjectJson(
  value: object,
  path: string,
  depth: number,
  seen: WeakSet<object>,
): string {
  const object = plainObject(value, path)
  if (seen.has(object)) invalid(path, 'cyclic payload is not allowed')
  seen.add(object)
  const keys = Object.keys(object)
  if (keys.length > MAX_CONTRACT_NODES)
    invalid(path, `payload exceeds ${MAX_CONTRACT_NODES} values`)
  const entries = keys.sort().map((key) => {
    if (POLLUTION_KEYS.has(key)) invalid(`${path}.${key}`, 'prototype-pollution key is not allowed')
    const encoded = canonicalJson(object[key], `${path}.${key}`, depth + 1, seen)
    return `${JSON.stringify(key)}:${encoded}`
  })
  seen.delete(object)
  return `{${entries.join(',')}}`
}

function encodeBytesBase64Url(bytes: Uint8Array, path: string, maxBytes: number): string {
  if (bytes.byteLength > maxBytes) invalid(path, `payload exceeds ${maxBytes} bytes`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
  if (encoded.length === 0) invalid(path, 'empty payload')
  return encoded
}

function encodeBase64Url(value: string, path: string, maxBytes: number): string {
  return encodeBytesBase64Url(new TextEncoder().encode(value), path, maxBytes)
}

function decodeBase64Url(value: string, path: string, maxBytes: number): string {
  if (
    value.length === 0 ||
    value.length > Math.ceil((maxBytes * 4) / 3) + 8 ||
    !BASE64URL.test(value) ||
    value.length % 4 === 1
  )
    invalid(path, 'invalid bounded base64url payload')
  const padding = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  let binary: string
  try {
    binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  } catch {
    invalid(path, 'invalid base64url encoding')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (bytes.byteLength > maxBytes) invalid(path, `payload exceeds ${maxBytes} bytes`)
  // RFC 4648 allows multiple textual aliases for the same bytes when the
  // final sextet carries non-zero unused bits. Re-encoding the decoded bytes
  // rejects those aliases as well as any implicit padding form.
  if (encodeBytesBase64Url(bytes, path, maxBytes) !== value)
    invalid(path, 'base64url payload is not canonical')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return invalid(path, 'payload is not valid UTF-8')
  }
}

function decodeCanonicalJson<T>(encoded: string, path: string, maxBytes: number): T {
  const text = decodeBase64Url(encoded, path, maxBytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    invalid(path, 'payload is not JSON')
  }
  const canonical = canonicalJson(parsed, path)
  if (new TextEncoder().encode(canonical).byteLength > maxBytes)
    invalid(path, `payload exceeds ${maxBytes} bytes`)
  if (canonical !== text) invalid(path, 'JSON must be canonical (sorted keys/no whitespace)')
  return parsed as T
}

function validateScope(value: unknown, path = 'scope'): OperatingScope {
  const object = plainObject(value, path)
  if (object.kind === 'global') {
    exactKeys(object, ['kind'], path)
    return { kind: 'global' }
  }
  if (object.kind === 'project') {
    exactKeys(object, ['kind', 'project_ref'], path)
    const project = plainObject(object.project_ref, `${path}.project_ref`)
    exactKeys(project, ['project_id'], `${path}.project_ref`)
    if (typeof project.project_id !== 'string' || !PROJECT_ID.test(project.project_id))
      invalid(`${path}.project_ref.project_id`, 'expected bounded project id')
    return { kind: 'project', project_ref: { project_id: project.project_id } }
  }
  return invalid(`${path}.kind`, 'expected global or project')
}

export function validateOperatingScope(value: unknown, path = 'scope'): OperatingScope {
  return validateScope(value, path)
}

export function validateManifestRouteState(
  manifest: ModuleManifest,
  value: unknown,
  path = 'state',
): ModuleRouteState {
  const object = plainObject(value, path)
  const allowed = new Set(manifest.state_schema.allowed_keys)
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) invalid(`${path}.${key}`, 'unknown module-local state key')
  }
  validateUnknownModuleState(object, path)
  if (new TextEncoder().encode(JSON.stringify(object)).byteLength > manifest.state_schema.max_bytes)
    invalid(path, 'state exceeds module schema bound')
  return { ...object } as ModuleRouteState
}

/**
 * Decide whether one already-validated route is owned by one authoritative
 * module manifest. Entity and secondary-context support belong to the module,
 * not to the generic URL grammar.
 */
export function resolveManifestRouteAuthority(
  manifest: ModuleManifest,
  route: PlatformRoute,
): ManifestRouteAuthority {
  const scopeKind = route.scope.kind
  if (!manifest.operating_levels.includes(scopeKind))
    return { status: 'unavailable', reason: 'unsupported-scope' }
  if (route.entity === undefined) return { status: 'ready' }
  if (!manifest.supported_entity_kinds.includes(route.entity.kind))
    return { status: 'unavailable', reason: 'incompatible-entity' }
  const context = manifest.secondary_context[scopeKind]
  if (context.behavior !== 'all' || !context.kinds.includes(route.entity.kind))
    return { status: 'unavailable', reason: 'incompatible-entity' }
  return { status: 'ready' }
}

function validateUnknownModuleState(value: unknown, path = 'state'): ModuleRouteState {
  const object = plainObject(value, path)
  for (const [key, entry] of Object.entries(object)) {
    if (POLLUTION_KEYS.has(key)) invalid(`${path}.${key}`, 'prototype-pollution key is not allowed')
    if (typeof entry === 'string') {
      if (entry.length > 240) invalid(`${path}.${key}`, 'string value is too long')
    } else if (typeof entry === 'number') {
      if (!Number.isSafeInteger(entry)) invalid(`${path}.${key}`, 'expected finite safe integer')
    } else if (typeof entry !== 'boolean') {
      invalid(`${path}.${key}`, 'unknown module state must contain primitive values')
    }
  }
  return { ...object } as ModuleRouteState
}

function validateModuleId(value: unknown, path: string): ModuleId {
  if (typeof value !== 'string' || !MODULE_ID.test(value)) invalid(path, 'invalid module id')
  return value as ModuleId
}

function inputUrl(input: string | URL): URL {
  try {
    // A base for parsing a relative URL, never fetched, and `.invalid` is the
    // TLD reserved to resolve nowhere.
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- see above
    return input instanceof URL ? new URL(input.href) : new URL(input, 'http://platform.invalid')
  } catch {
    return invalid('url', 'invalid URL')
  }
}

function decodePathSegment(raw: string, path: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return invalid(path, 'invalid percent-encoding')
  }
}

/**
 * The project id in the fourth path segment.
 *
 * Canonical means the encoded form round-trips exactly: two spellings of one id
 * would be two URLs for one place, and `.`/`..` are refused before they can be
 * read as a path at all.
 */
function pathProjectId(raw: string): string {
  if (raw.length === 0) invalid('url.pathname.project_id', 'project id is required')
  const projectId = decodePathSegment(raw, 'url.pathname.project_id')
  if (!PROJECT_ID.test(projectId) || projectId === '.' || projectId === '..')
    invalid('url.pathname.project_id', 'invalid project id')
  if (encodeURIComponent(projectId) !== raw)
    invalid('url.pathname.project_id', 'project id must be canonically percent-encoded')
  return projectId
}

/** The module id and operating scope named by a `/modules/<module_id>/<scope>` path. */
function routePath(url: URL): { moduleSegment: string; scope: OperatingScope } {
  const rawSegments = url.pathname.split('/')
  if (
    rawSegments[0] !== '' ||
    rawSegments.length < 4 ||
    rawSegments.some((segment) => segment === '..' || segment === '.')
  )
    invalid('url.pathname', 'expected /modules/<module_id>/<scope> route')
  if (rawSegments[1] !== 'modules') invalid('url.pathname', 'route must start with /modules')
  const moduleSegment = decodePathSegment(rawSegments[2], 'url.pathname.module_id')
  if (!MODULE_ID.test(moduleSegment) || encodeURIComponent(moduleSegment) !== rawSegments[2])
    invalid('url.pathname.module_id', 'invalid module id')
  const scopeKind = rawSegments[3]
  if (scopeKind === 'global' && rawSegments.length === 4)
    return { moduleSegment, scope: { kind: 'global' } }
  if (scopeKind !== 'project' || rawSegments.length !== 5)
    invalid('url.pathname', 'invalid operating scope route')
  const project_id = pathProjectId(rawSegments[4])
  return { moduleSegment, scope: { kind: 'project', project_ref: { project_id } } }
}

/**
 * The two query keys a canonical route may carry, still encoded.
 *
 * A repeated key is refused rather than resolved: last-one-wins would make two
 * different URLs mean the same route. Only the two current keys are accepted.
 */
function routeQuery(url: URL): {
  encodedEntity: string | undefined
  encodedState: string | undefined
} {
  const seen = new Set<string>()
  let encodedEntity: string | undefined
  let encodedState: string | undefined
  for (const [key, value] of url.searchParams.entries()) {
    if (seen.has(key)) invalid(`url.search.${key}`, 'duplicate query key')
    seen.add(key)
    if (key !== 'entity' && key !== 'state') invalid(`url.search.${key}`, 'unknown query key')
    if (key === 'entity') encodedEntity = value
    else encodedState = value
  }
  return { encodedEntity, encodedState }
}

export function parsePlatformRoute(input: string | URL): PlatformRoute {
  const url = inputUrl(input)
  if (url.hash) invalid('url.hash', 'fragments are not part of the canonical route')
  if (url.username || url.password) invalid('url', 'credentials are not allowed')
  const { moduleSegment, scope } = routePath(url)
  const resolvedModuleId = validateModuleId(moduleSegment, 'url.pathname.module_id')
  const { encodedEntity, encodedState } = routeQuery(url)
  const entity =
    encodedEntity === undefined
      ? undefined
      : validateEntityRef(
          decodeCanonicalJson(encodedEntity, 'url.search.entity', MAX_ENTITY_BYTES),
          'url.search.entity',
        )
  if (
    scope.kind === 'project' &&
    entity?.kind === 'project' &&
    entity.project_id !== scope.project_ref.project_id
  )
    invalid('url.search.entity', 'project entity does not match route project')
  const decodedState =
    encodedState === undefined
      ? undefined
      : decodeCanonicalJson<unknown>(encodedState, 'url.search.state', MAX_STATE_BYTES)
  const state =
    decodedState === undefined ? undefined : validateUnknownModuleState(decodedState, 'state')
  return {
    module_id: resolvedModuleId,
    scope,
    ...(entity === undefined ? {} : { entity }),
    ...(state === undefined ? {} : { state }),
  }
}

/**
 * Resolve a canonical route for a shell consumer. Unknown but syntactically
 * valid module IDs are recoverable product state; malformed paths, unknown
 * query keys and invalid payloads still throw PlatformRouteValidationError.
 */
export function resolvePlatformRoute(input: string | URL): PlatformRouteResolution {
  return parsePlatformRoute(input)
}

export function isPlatformRouteUnavailable(value: unknown): value is PlatformRouteUnavailable {
  if (typeof value !== 'object' || value === null) return false
  const object = value as Record<string, unknown>
  return (
    object.status === 'unavailable' &&
    (object.reason === 'unknown-module' ||
      object.reason === 'disabled-module' ||
      object.reason === 'unsupported-view' ||
      object.reason === 'unsupported-scope' ||
      object.reason === 'incompatible-entity') &&
    typeof object.input_module_id === 'string' &&
    object.input_scope !== undefined
  )
}

function validateRoute(value: unknown): PlatformRoute {
  const object = plainObject(value, 'route')
  exactKeys(object, ['module_id', 'scope', 'entity', 'state'], 'route')
  const moduleId = object.module_id
  const resolvedModuleId = validateModuleId(moduleId, 'route.module_id')
  const scope = validateScope(object.scope)
  if (scope.kind === 'project' && object.entity !== undefined) {
    const entity = validateEntityRef(object.entity, 'route.entity')
    if (entity.kind === 'project' && entity.project_id !== scope.project_ref.project_id)
      invalid('route.entity', 'project entity does not match route project')
  }
  const entity =
    object.entity === undefined ? undefined : validateEntityRef(object.entity, 'route.entity')
  const state =
    object.state === undefined ? undefined : validateUnknownModuleState(object.state, 'route.state')
  return {
    module_id: resolvedModuleId,
    scope,
    ...(entity === undefined ? {} : { entity }),
    ...(state === undefined ? {} : { state }),
  }
}

export function serializePlatformRoute(value: unknown): string {
  const route = validateRoute(value)
  const projectSuffix =
    route.scope.kind === 'global'
      ? 'global'
      : `project/${encodeURIComponent(route.scope.project_ref.project_id)}`
  const path = `/modules/${route.module_id}/${projectSuffix}`
  const query: string[] = []
  if (route.entity !== undefined)
    query.push(
      `entity=${encodeBase64Url(canonicalJson(route.entity, 'route.entity'), 'route.entity', MAX_ENTITY_BYTES)}`,
    )
  if (route.state !== undefined)
    query.push(
      `state=${encodeBase64Url(canonicalJson(route.state, 'route.state'), 'route.state', MAX_STATE_BYTES)}`,
    )
  return query.length === 0 ? path : `${path}?${query.join('&')}`
}

export function roundTripPlatformRoute(value: unknown): PlatformRoute {
  return parsePlatformRoute(serializePlatformRoute(value))
}
