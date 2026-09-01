import type { EntityKind } from '@/shared/api/platformEntityRef.ts'

export const MODULES_INTERFACE = 'valkama-modules' as const

export const PLATFORM_MODULE_IDS = [
  'planning',
  'sessions',
  'analytics',
  'improvements',
  'skills',
  'memory',
  'settings',
] as const
export type PlatformRendererModuleId = (typeof PLATFORM_MODULE_IDS)[number]
export type ModuleId = Lowercase<string>

const MODULE_ID = /^[a-z][a-z0-9-]{0,63}$/u
const MAX_MODULE_REGISTRATIONS = 64

/** Renderer capability is local UI support, never module authorization. */
export function hasModuleRenderer(value: string): value is PlatformRendererModuleId {
  return (PLATFORM_MODULE_IDS as readonly string[]).includes(value)
}

export type NavigationGroup = 'work' | 'understand' | 'capabilities' | 'system'
type ModuleOperatingLevel = 'global' | 'project'
type SecondaryContextBehavior = 'all' | 'none' | 'unavailable'
export type ModuleUiStateName =
  'loading' | 'ready' | 'empty' | 'error' | 'unavailable' | 'permission-denied' | 'degraded'

type ModuleLevelSemantics = {
  action_semantics: string[]
  read_models: string[]
}

type ModuleSecondaryContext = {
  behavior: SecondaryContextBehavior
  kinds: EntityKind[]
}

type ModuleStateSupport = {
  supported: ModuleUiStateName[]
  unsupported_reason?: string
}

type ModuleStateSchema = {
  allowed_keys: string[]
  max_bytes: number
  schema_id: string
}

export type ModuleManifest = {
  feature_capabilities: string[]
  icon_key: string
  inspector_owner: string
  interface_version: typeof MODULES_INTERFACE
  module_id: ModuleId
  navigation_group: NavigationGroup
  /** Every built-in declares both levels; unsupported levels stay typed. */
  operating_levels: [ModuleOperatingLevel, ModuleOperatingLevel]
  primary_actions: string[]
  required_read_models: string[]
  route_namespace: ModuleId
  secondary_actions: string[]
  secondary_context: {
    global: ModuleSecondaryContext
    project: ModuleSecondaryContext
  }
  semantics: {
    global: ModuleLevelSemantics
    project: ModuleLevelSemantics
  }
  sse_subscriptions: string[]
  state_schema: ModuleStateSchema
  states: {
    global: ModuleStateSupport
    project: ModuleStateSupport
  }
  supported_entity_kinds: EntityKind[]
  title_key: string
  version: string
}

export type ModuleRegistration = {
  manifest: ModuleManifest
  mutable: boolean
  revision: number
  state: 'enabled' | 'disabled'
  updated_at: string
}

export type ModulesPayload = {
  interface_version: typeof MODULES_INTERFACE
  modules: ModuleRegistration[]
}

class ModulesValidationError extends Error {
  readonly code = 'platform_modules_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'ModulesValidationError'
  }
}

const TOKEN = /^[a-z][a-z0-9._-]{0,95}$/u
const ACTION_ID = /^[a-z][a-z0-9-]{0,31}(?:\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159})+$/u
// Manifest action references and runtime ActionRef invocation share one wire.
const ACTION_ID_MAX_LENGTH = 192
const ENTITY_KINDS = new Set<EntityKind>([
  'project',
  'planning-space',
  'workflow',
  'work-item',
  'execution',
  'session',
  'skill',
  'memory-resource',
  'artifact',
  'improvement-case',
  'service',
  'connection',
  'registry',
])
const UI_STATES: Set<ModuleUiStateName> = new Set([
  'loading',
  'ready',
  'empty',
  'error',
  'unavailable',
  'permission-denied',
  'degraded',
])
const MAX_LIST_LENGTH = 64

function invalid(path: string, detail: string): never {
  throw new ModulesValidationError(`${path}: ${detail}`)
}

const { plainObject, exactKeys } = contractGuards(invalid)

function stringField(value: unknown, path: string, pattern: RegExp, max = 96): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !pattern.test(value))
    invalid(path, 'expected bounded token')
  return value
}

function boundedList(value: unknown, path: string, pattern: RegExp = TOKEN, max = 96): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH)
    invalid(path, 'expected bounded list')
  const result = value.map((entry, index) => stringField(entry, `${path}[${index}]`, pattern, max))
  if (new Set(result).size !== result.length) invalid(path, 'duplicate values are not allowed')
  return result
}

function entityKinds(value: unknown, path: string): EntityKind[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH)
    invalid(path, 'expected bounded entity-kind list')
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || !ENTITY_KINDS.has(entry as EntityKind))
      invalid(`${path}[${index}]`, 'unknown entity kind')
    return entry as EntityKind
  })
  if (new Set(result).size !== result.length)
    invalid(path, 'duplicate entity kinds are not allowed')
  return result
}

function levelSemantics(value: unknown, path: string): ModuleLevelSemantics {
  const object = plainObject(value, path)
  exactKeys(object, ['read_models', 'action_semantics'], path)
  return {
    read_models: boundedList(object.read_models, `${path}.read_models`),
    action_semantics: boundedList(
      object.action_semantics,
      `${path}.action_semantics`,
      ACTION_ID,
      ACTION_ID_MAX_LENGTH,
    ),
  }
}

function secondaryContext(value: unknown, path: string): ModuleSecondaryContext {
  const object = plainObject(value, path)
  exactKeys(object, ['kinds', 'behavior'], path)
  const behavior = object.behavior
  if (behavior !== 'all' && behavior !== 'none' && behavior !== 'unavailable')
    invalid(`${path}.behavior`, 'unknown behavior')
  return { kinds: entityKinds(object.kinds, `${path}.kinds`), behavior }
}

function stateSupport(value: unknown, path: string): ModuleStateSupport {
  const object = plainObject(value, path)
  exactKeys(object, ['supported', 'unsupported_reason'], path)
  const supported = object.supported
  if (!Array.isArray(supported) || supported.length === 0 || supported.length > UI_STATES.size)
    invalid(`${path}.supported`, 'expected bounded state list')
  const names = supported.map((entry, index) => {
    if (typeof entry !== 'string' || !UI_STATES.has(entry as ModuleUiStateName))
      invalid(`${path}.supported[${index}]`, 'unknown UI state')
    return entry as ModuleUiStateName
  })
  if (new Set(names).size !== names.length)
    invalid(`${path}.supported`, 'duplicate states are not allowed')
  const reason = object.unsupported_reason
  if (
    reason !== undefined &&
    (typeof reason !== 'string' || reason.length === 0 || reason.length > 240)
  )
    invalid(`${path}.unsupported_reason`, 'expected bounded reason')
  if (reason !== undefined && names.length === UI_STATES.size)
    invalid(`${path}.unsupported_reason`, 'supported level cannot carry unsupported reason')
  return reason === undefined
    ? { supported: names }
    : { supported: names, unsupported_reason: reason as string }
}

function stateSchema(value: unknown, path: string): ModuleStateSchema {
  const object = plainObject(value, path)
  exactKeys(object, ['schema_id', 'allowed_keys', 'max_bytes'], path)
  const maxBytes = object.max_bytes
  if (
    typeof maxBytes !== 'number' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 64 ||
    maxBytes > 8192
  )
    invalid(`${path}.max_bytes`, 'expected bounded positive integer')
  return {
    schema_id: stringField(object.schema_id, `${path}.schema_id`, TOKEN),
    allowed_keys: boundedList(
      object.allowed_keys,
      `${path}.allowed_keys`,
      /^[a-z][a-z0-9_]{0,31}$/u,
    ),
    max_bytes: maxBytes,
  }
}

function moduleId(value: unknown, path: string): ModuleId {
  if (typeof value !== 'string' || !MODULE_ID.test(value)) invalid(path, 'invalid module id')
  return value as ModuleId
}

export function validateModuleManifest(value: unknown, path = 'module'): ModuleManifest {
  const object = plainObject(value, path)
  exactKeys(
    object,
    [
      'interface_version',
      'module_id',
      'version',
      'title_key',
      'icon_key',
      'navigation_group',
      'route_namespace',
      'state_schema',
      'operating_levels',
      'semantics',
      'secondary_context',
      'required_read_models',
      'sse_subscriptions',
      'supported_entity_kinds',
      'primary_actions',
      'secondary_actions',
      'inspector_owner',
      'feature_capabilities',
      'states',
    ],
    path,
  )
  if (object.interface_version !== MODULES_INTERFACE)
    invalid(`${path}.interface_version`, `expected ${MODULES_INTERFACE}`)
  const id = moduleId(object.module_id, `${path}.module_id`)
  if (object.route_namespace !== id)
    invalid(`${path}.route_namespace`, 'route namespace must equal stable module_id')
  const navigationGroup = object.navigation_group
  if (
    navigationGroup !== 'work' &&
    navigationGroup !== 'understand' &&
    navigationGroup !== 'capabilities' &&
    navigationGroup !== 'system'
  )
    invalid(`${path}.navigation_group`, 'unknown navigation group')
  if (
    !Array.isArray(object.operating_levels) ||
    object.operating_levels.length !== 2 ||
    object.operating_levels[0] !== 'global' ||
    object.operating_levels[1] !== 'project'
  )
    invalid(`${path}.operating_levels`, 'must be exactly [global, project]')
  const semantics = plainObject(object.semantics, `${path}.semantics`)
  exactKeys(semantics, ['global', 'project'], `${path}.semantics`)
  const secondary = plainObject(object.secondary_context, `${path}.secondary_context`)
  exactKeys(secondary, ['global', 'project'], `${path}.secondary_context`)
  const states = plainObject(object.states, `${path}.states`)
  exactKeys(states, ['global', 'project'], `${path}.states`)
  const primaryActions = boundedList(
    object.primary_actions,
    `${path}.primary_actions`,
    ACTION_ID,
    ACTION_ID_MAX_LENGTH,
  )
  const secondaryActions = boundedList(
    object.secondary_actions,
    `${path}.secondary_actions`,
    ACTION_ID,
    ACTION_ID_MAX_LENGTH,
  )
  const version = stringField(object.version, `${path}.version`, /^[\s\S]+$/u, 128)
  if (!isCanonicalSemver(version)) invalid(`${path}.version`, 'expected full SemVer 2.0.0 value')
  return {
    interface_version: MODULES_INTERFACE,
    module_id: id,
    version,
    title_key: stringField(object.title_key, `${path}.title_key`, TOKEN),
    icon_key: stringField(object.icon_key, `${path}.icon_key`, TOKEN),
    navigation_group: navigationGroup,
    route_namespace: id,
    state_schema: stateSchema(object.state_schema, `${path}.state_schema`),
    operating_levels: ['global', 'project'],
    semantics: {
      global: levelSemantics(semantics.global, `${path}.semantics.global`),
      project: levelSemantics(semantics.project, `${path}.semantics.project`),
    },
    secondary_context: {
      global: secondaryContext(secondary.global, `${path}.secondary_context.global`),
      project: secondaryContext(secondary.project, `${path}.secondary_context.project`),
    },
    required_read_models: boundedList(object.required_read_models, `${path}.required_read_models`),
    sse_subscriptions: boundedList(object.sse_subscriptions, `${path}.sse_subscriptions`),
    supported_entity_kinds: entityKinds(
      object.supported_entity_kinds,
      `${path}.supported_entity_kinds`,
    ),
    primary_actions: primaryActions,
    secondary_actions: secondaryActions,
    inspector_owner: stringField(object.inspector_owner, `${path}.inspector_owner`, TOKEN),
    feature_capabilities: boundedList(object.feature_capabilities, `${path}.feature_capabilities`),
    states: {
      global: stateSupport(states.global, `${path}.states.global`),
      project: stateSupport(states.project, `${path}.states.project`),
    },
  }
}

export function validateModulesPayload(value: unknown, path = 'payload'): ModulesPayload {
  const object = plainObject(value, path)
  exactKeys(object, ['interface_version', 'modules'], path)
  if (object.interface_version !== MODULES_INTERFACE)
    invalid(`${path}.interface_version`, `expected ${MODULES_INTERFACE}`)
  if (
    !Array.isArray(object.modules) ||
    object.modules.length === 0 ||
    object.modules.length > MAX_MODULE_REGISTRATIONS
  )
    invalid(`${path}.modules`, 'expected bounded non-empty module registry')
  const modules = object.modules.map((module, index) =>
    validateModuleRegistration(module, `${path}.modules[${index}]`),
  )
  const ids = modules.map((module) => module.manifest.module_id)
  if (new Set(ids).size !== ids.length) invalid(`${path}.modules`, 'duplicate module registrations')
  if (!ids.includes('settings')) invalid(`${path}.modules`, 'Settings registration is required')
  return { interface_version: MODULES_INTERFACE, modules }
}

export function validateModuleRegistration(
  value: unknown,
  path = 'module_registration',
): ModuleRegistration {
  const registration = plainObject(value, path)
  exactKeys(registration, ['manifest', 'state', 'mutable', 'revision', 'updated_at'], path)
  const manifest = validateModuleManifest(registration.manifest, `${path}.manifest`)
  if (registration.state !== 'enabled' && registration.state !== 'disabled')
    invalid(`${path}.state`, 'expected enabled or disabled')
  if (typeof registration.mutable !== 'boolean') invalid(`${path}.mutable`, 'expected boolean')
  if (
    typeof registration.revision !== 'number' ||
    !Number.isSafeInteger(registration.revision) ||
    registration.revision <= 0
  )
    invalid(`${path}.revision`, 'expected positive integer')
  if (
    typeof registration.updated_at !== 'string' ||
    registration.updated_at.length > 96 ||
    Number.isNaN(Date.parse(registration.updated_at))
  )
    invalid(`${path}.updated_at`, 'expected timestamp')
  if (
    manifest.module_id === 'settings' &&
    (registration.mutable || registration.state !== 'enabled')
  )
    invalid(path, 'Settings must be immutable and enabled')
  return {
    manifest,
    state: registration.state,
    mutable: registration.mutable,
    revision: registration.revision,
    updated_at: registration.updated_at,
  } as ModuleRegistration
}

import { contractGuards, isCanonicalSemver } from '@/shared/api/contractGuards.ts'
