/**
 * The action reference a failure state may offer as its retry: one kernel, module or
 * adapter action, bound to its owner's namespace.
 */

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

function invalid(path: string, detail: string): never {
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
