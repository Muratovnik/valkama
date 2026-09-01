/** Runtime validated action references for Platform core/module/adapter actions. */

import { contractGuards } from '@/shared/api/contractGuards.ts'
import type { EntityKind } from '@/shared/api/platformEntityRef.ts'
import { PLATFORM_MODULE_IDS } from '@/shared/api/platformModuleContract.ts'

const ACTIONS_INTERFACE = 'valkama-actions' as const

type ActionOwnerKind = 'kernel' | 'module' | 'adapter'
type InvocationScopeSchema = 'global' | 'project' | 'either'
type AuthorizationTargetKind = EntityKind | 'adapter-resource'

export type ActionRef = {
  action_id: string
  input_schema_id: string
  interface_version: typeof ACTIONS_INTERFACE
  invocation_scope_schema: InvocationScopeSchema
  owner_id: string
  owner_kind: ActionOwnerKind
  target_kind: AuthorizationTargetKind
}

class PlatformActionValidationError extends Error {
  readonly code = 'platform_actions_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlatformActionValidationError'
  }
}

const ACTION_NAME = /^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})*$/u
const OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const ACTION_ID_MAX_LENGTH = 192
const SCHEMA_ID = /^[a-z][a-z0-9._-]{0,95}$/u
const MODULE_IDS = new Set<string>(PLATFORM_MODULE_IDS)
const ENTITY_KINDS = new Set<string>([
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
  'adapter-resource',
])

export function invalid(path: string, detail: string): never {
  throw new PlatformActionValidationError(`${path}: ${detail}`)
}

const { plainObject, exactKeys } = contractGuards(invalid)

function stringField(value: unknown, path: string, pattern: RegExp, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !pattern.test(value))
    invalid(path, 'expected bounded string')
  return value
}

function actionNamespace(
  value: string,
  ownerKind: ActionOwnerKind,
  ownerId: string,
  path: string,
): void {
  const parts = value.split('.')
  if (ownerKind === 'kernel') {
    if (parts.length < 2 || parts[0] !== 'core' || !ACTION_NAME.test(parts.slice(1).join('.'))) {
      invalid(`${path}.action_id`, 'kernel actions must use core.<name> namespace')
    }
    if (ownerId !== 'kernel') invalid(`${path}.owner_id`, 'kernel owner_id must be kernel')
    return
  }
  if (ownerKind === 'module') {
    if (
      parts.length < 3 ||
      parts[0] !== 'module' ||
      !MODULE_IDS.has(parts[1]) ||
      !ACTION_NAME.test(parts.slice(2).join('.'))
    ) {
      invalid(`${path}.action_id`, 'module actions must use module.<module_id>.<name> namespace')
    }
    if (ownerId !== parts[1])
      invalid(`${path}.owner_id`, 'module owner_id must match module namespace')
    return
  }
  if (
    parts.length < 3 ||
    parts[0] !== 'adapter' ||
    !OWNER_ID.test(parts[1]) ||
    !ACTION_NAME.test(parts.slice(2).join('.'))
  ) {
    invalid(`${path}.action_id`, 'adapter actions must use adapter.<lineage>.<name> namespace')
  }
  if (ownerId !== parts[1])
    invalid(`${path}.owner_id`, 'adapter owner_id must match lineage namespace')
}

export function validateActionRef(value: unknown, path = 'action'): ActionRef {
  const object = plainObject(value, path)
  exactKeys(
    object,
    [
      'interface_version',
      'action_id',
      'owner_kind',
      'owner_id',
      'input_schema_id',
      'target_kind',
      'invocation_scope_schema',
    ],
    path,
  )
  if (object.interface_version !== ACTIONS_INTERFACE)
    invalid(`${path}.interface_version`, `expected ${ACTIONS_INTERFACE}`)
  const ownerKind = object.owner_kind
  if (ownerKind !== 'kernel' && ownerKind !== 'module' && ownerKind !== 'adapter')
    invalid(`${path}.owner_kind`, 'unknown owner kind')
  const ownerId = stringField(object.owner_id, `${path}.owner_id`, OWNER_ID, 128)
  const actionId = stringField(
    object.action_id,
    `${path}.action_id`,
    /^[a-z][a-z0-9-]{0,31}(?:\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159})+$/u,
    ACTION_ID_MAX_LENGTH,
  )
  actionNamespace(actionId, ownerKind, ownerId, path)
  const targetKind = object.target_kind
  if (typeof targetKind !== 'string' || !ENTITY_KINDS.has(targetKind))
    invalid(`${path}.target_kind`, 'unknown target kind')
  const invocationScopeSchema = object.invocation_scope_schema
  if (
    invocationScopeSchema !== 'global' &&
    invocationScopeSchema !== 'project' &&
    invocationScopeSchema !== 'either'
  )
    invalid(`${path}.invocation_scope_schema`, 'unknown invocation scope schema')
  return {
    interface_version: ACTIONS_INTERFACE,
    action_id: actionId,
    owner_kind: ownerKind,
    owner_id: ownerId,
    input_schema_id: stringField(object.input_schema_id, `${path}.input_schema_id`, SCHEMA_ID, 96),
    target_kind: targetKind as AuthorizationTargetKind,
    invocation_scope_schema: invocationScopeSchema,
  }
}

export function validateActionRefs(value: unknown, path = 'actions'): ActionRef[] {
  if (!Array.isArray(value) || value.length > 128) invalid(path, 'expected bounded array')
  const actions = value.map((action, index) => validateActionRef(action, `${path}[${index}]`))
  const seen = new Set<string>()
  for (const action of actions) {
    if (seen.has(action.action_id)) invalid(path, `duplicate action_id ${action.action_id}`)
    seen.add(action.action_id)
  }
  return actions
}

/**
 * Registry semantics are intentionally immutable: once an ID has been
 * observed, a later registration cannot silently replace its owner.
 */
export class ActionRegistry {
  private readonly entries = new Map<string, ActionRef>()

  register(value: unknown): ActionRef {
    const action = validateActionRef(value)
    if (this.entries.has(action.action_id))
      throw new PlatformActionValidationError(`action_id ${action.action_id} is already registered`)
    this.entries.set(action.action_id, action)
    return action
  }

  registerMany(value: unknown): readonly ActionRef[] {
    const actions = validateActionRefs(value)
    const local = new Set<string>()
    for (const action of actions) {
      if (local.has(action.action_id) || this.entries.has(action.action_id))
        throw new PlatformActionValidationError(
          `action_id ${action.action_id} is already registered`,
        )
      local.add(action.action_id)
    }
    for (const action of actions) this.entries.set(action.action_id, action)
    return actions
  }

  get(actionId: string): ActionRef | undefined {
    const action = this.entries.get(actionId)
    return action === undefined ? undefined : { ...action }
  }

  list(): readonly ActionRef[] {
    return [...this.entries.values()].map((action) => ({ ...action }))
  }
}

export const CORE_ACTIONS: readonly ActionRef[] = [
  {
    interface_version: ACTIONS_INTERFACE,
    action_id: 'core.work-item.create',
    owner_kind: 'kernel',
    owner_id: 'kernel',
    input_schema_id: 'core.work-item.create',
    target_kind: 'work-item',
    invocation_scope_schema: 'either',
  },
  {
    interface_version: ACTIONS_INTERFACE,
    action_id: 'core.work-item.open',
    owner_kind: 'kernel',
    owner_id: 'kernel',
    input_schema_id: 'core.work-item.open',
    target_kind: 'work-item',
    invocation_scope_schema: 'either',
  },
  {
    interface_version: ACTIONS_INTERFACE,
    action_id: 'core.work-item.attach-resource',
    owner_kind: 'kernel',
    owner_id: 'kernel',
    input_schema_id: 'core.work-item.attach-resource',
    target_kind: 'adapter-resource',
    invocation_scope_schema: 'project',
  },
]
