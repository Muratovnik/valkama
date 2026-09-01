/**
 * Runtime contracts shared by the Platform's relation, route, contribution, and
 * action boundaries.
 *
 * This file intentionally has no dependency on the legacy Platform types/API.  A
 * value crossing a boundary is copied and validated here; TypeScript's
 * structural assertions are not used as payload validation.
 */

import { isCanonicalSemver } from '@/shared/api/contractGuards.ts'
import { validateActionRef } from '@/shared/api/platformActionRef.ts'
import type { ActionRef } from '@/shared/api/platformActionRef.ts'
import {
  isEntityRef,
  validateAdapterResourceRef,
  validateEntityRef,
  validateServiceRef,
} from '@/shared/api/platformEntityRef.ts'
import type { AdapterResourceRef, EntityRef, ServiceRef } from '@/shared/api/platformEntityRef.ts'
import {
  exactKeys,
  invalid,
  isoDate,
  KEY,
  MAX_ID_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_RELATIONS,
  optionalString,
  plainObject,
  presentationText,
  rejectUnsafeTree,
  requiredString,
} from '@/shared/api/platformRelationGuards.ts'

const RELATIONS_INTERFACE = 'valkama-relations' as const

type RelationState = 'resolved' | 'unavailable' | 'missing' | 'ambiguous' | 'malformed'

type RelationKind =
  | 'related'
  | 'reference'
  | 'source'
  | 'target'
  | 'contribution'
  | 'adapter-resource'
  | 'external-resource'
  | 'dependency'
  | 'execution'

export type PlatformRelation = {
  actions: ActionRef[]
  interface_version: typeof RELATIONS_INTERFACE
  kind: RelationKind
  presentation: {
    label: string
    icon_key?: string
    secondary_text?: string
  }
  provenance: {
    observed_at: string
    source_kind: string
    author?: string
  }
  provider: {
    adapter_id: string
    adapter_lineage_id: string
    adapter_version: string
    connection_id: string
    service_ref: ServiceRef
  }
  relation_id: string
  source: EntityRef
  state: RelationState
  target: EntityRef | AdapterResourceRef
}

export type PlatformRelationsPayload = {
  interface_version: typeof RELATIONS_INTERFACE
  relations: PlatformRelation[]
}

function validateRelationKind(value: unknown, path: string): RelationKind {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value))
    invalid(path, 'unknown relation kind')
  return value as RelationKind
}

function validateProvider(value: unknown, path: string): PlatformRelation['provider'] {
  const object = plainObject(value, path)
  exactKeys(
    object,
    ['service_ref', 'adapter_id', 'adapter_lineage_id', 'adapter_version', 'connection_id'],
    path,
  )
  if (!isCanonicalSemver(object.adapter_version))
    invalid(`${path}.adapter_version`, 'expected full SemVer 2.0.0 value')
  return {
    service_ref: validateServiceRef(object.service_ref, `${path}.service_ref`),
    adapter_id: requiredString(object.adapter_id, `${path}.adapter_id`),
    adapter_lineage_id: requiredString(object.adapter_lineage_id, `${path}.adapter_lineage_id`),
    adapter_version: object.adapter_version,
    connection_id: requiredString(object.connection_id, `${path}.connection_id`),
  }
}

function validateProvenance(value: unknown, path: string): PlatformRelation['provenance'] {
  const object = plainObject(value, path)
  exactKeys(object, ['source_kind', 'observed_at', 'author'], path)
  const author = optionalString(object.author, `${path}.author`, MAX_ID_LENGTH)
  const result: PlatformRelation['provenance'] = {
    source_kind: requiredString(object.source_kind, `${path}.source_kind`, KEY, 64),
    observed_at: isoDate(object.observed_at, `${path}.observed_at`),
  }
  if (author !== undefined) result.author = author
  return result
}

function validatePresentation(value: unknown, path: string): PlatformRelation['presentation'] {
  const object = plainObject(value, path)
  exactKeys(object, ['label', 'secondary_text', 'icon_key'], path)
  const secondaryText =
    object.secondary_text === undefined
      ? undefined
      : presentationText(object.secondary_text, `${path}.secondary_text`)
  const iconKey =
    object.icon_key === undefined
      ? undefined
      : requiredString(object.icon_key, `${path}.icon_key`, KEY, 64)
  const result: PlatformRelation['presentation'] = {
    label: presentationText(object.label, `${path}.label`, MAX_LABEL_LENGTH),
  }
  if (secondaryText !== undefined) result.secondary_text = secondaryText
  if (iconKey !== undefined) result.icon_key = iconKey
  return result
}

export function validatePlatformRelation(value: unknown, path = 'relation'): PlatformRelation {
  const object = plainObject(value, path)
  exactKeys(
    object,
    [
      'interface_version',
      'relation_id',
      'source',
      'kind',
      'target',
      'provider',
      'state',
      'provenance',
      'presentation',
      'actions',
    ],
    path,
  )
  rejectUnsafeTree(value, path)
  if (object.interface_version !== RELATIONS_INTERFACE)
    invalid(`${path}.interface_version`, `expected ${RELATIONS_INTERFACE}`)
  const state = object.state
  if (
    state !== 'resolved' &&
    state !== 'unavailable' &&
    state !== 'missing' &&
    state !== 'ambiguous' &&
    state !== 'malformed'
  ) {
    invalid(`${path}.state`, 'unknown relation state')
  }
  if (!Array.isArray(object.actions) || object.actions.length > 32)
    invalid(`${path}.actions`, 'expected bounded array')
  const actions = object.actions.map((action, index) =>
    validateActionRef(action, `${path}.actions[${index}]`),
  )
  const target = isEntityRef(object.target)
    ? validateEntityRef(object.target, `${path}.target`)
    : validateAdapterResourceRef(object.target, `${path}.target`)
  return {
    interface_version: RELATIONS_INTERFACE,
    relation_id: requiredString(object.relation_id, `${path}.relation_id`),
    source: validateEntityRef(object.source, `${path}.source`),
    kind: validateRelationKind(object.kind, `${path}.kind`),
    target,
    provider: validateProvider(object.provider, `${path}.provider`),
    state,
    provenance: validateProvenance(object.provenance, `${path}.provenance`),
    presentation: validatePresentation(object.presentation, `${path}.presentation`),
    actions,
  }
}

function validatePlatformRelations(value: unknown, path = 'relations'): PlatformRelation[] {
  if (!Array.isArray(value) || value.length > MAX_RELATIONS) invalid(path, 'expected bounded array')
  const relations = value.map((relation, index) =>
    validatePlatformRelation(relation, `${path}[${index}]`),
  )
  const ids = new Set<string>()
  for (const relation of relations) {
    if (ids.has(relation.relation_id))
      invalid(`${path}`, `duplicate relation_id ${relation.relation_id}`)
    ids.add(relation.relation_id)
  }
  return relations
}

export function validatePlatformRelationsPayload(
  value: unknown,
  path = 'payload',
): PlatformRelationsPayload {
  const object = plainObject(value, path)
  exactKeys(object, ['interface_version', 'relations'], path)
  if (object.interface_version !== RELATIONS_INTERFACE)
    invalid(`${path}.interface_version`, `expected ${RELATIONS_INTERFACE}`)
  return {
    interface_version: RELATIONS_INTERFACE,
    relations: validatePlatformRelations(object.relations, `${path}.relations`),
  }
}
