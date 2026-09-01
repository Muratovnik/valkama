/**
 * Neutral Kernel entity refs.
 *
 * A reference is a resolved pointer this product wrote, so every field is
 * checked against the shape its kind declares and nothing is inferred: an
 * unknown kind, a missing key or an extra one is a refusal.
 */

import {
  exactKeys,
  ID,
  invalid,
  KEY,
  plainObject,
  PROJECT_ID,
  requiredString,
} from '@/shared/api/platformRelationGuards.ts'

export type EntityKind =
  | 'project'
  | 'planning-space'
  | 'workflow'
  | 'work-item'
  | 'execution'
  | 'session'
  | 'skill'
  | 'memory-resource'
  | 'artifact'
  | 'improvement-case'
  | 'service'
  | 'connection'
  | 'registry'

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u

export type ServiceRef = {
  owner_id: string
  service_id: string
}

export type ConnectionRef = {
  adapter_lineage_id: string
  connection_id: string
  service_ref: ServiceRef
}

export type AdapterResourceRef = {
  connection_ref: ConnectionRef
  external_id: string
  resource_type: string
}

export type EntityRef =
  | { kind: 'project'; project_id: string }
  | {
      kind:
        | 'planning-space'
        | 'workflow'
        | 'work-item'
        | 'execution'
        | 'memory-resource'
        | 'artifact'
        | 'improvement-case'
      resource_id: string
    }
  | { client_family: string; kind: 'session'; session_id: string }
  | { kind: 'skill'; skill_key: string; source_scope: 'global' | 'project'; project_id?: string }
  | ({ kind: 'service' } & ServiceRef)
  | ({ kind: 'connection' } & ConnectionRef)
  | { kind: 'registry'; registry_id: string }

export function validateServiceRef(value: unknown, path = 'service_ref'): ServiceRef {
  const object = plainObject(value, path)
  exactKeys(object, ['owner_id', 'service_id'], path)
  return {
    owner_id: requiredString(object.owner_id, `${path}.owner_id`),
    service_id: requiredString(object.service_id, `${path}.service_id`),
  }
}

export function validateConnectionRef(value: unknown, path = 'connection_ref'): ConnectionRef {
  const object = plainObject(value, path)
  exactKeys(object, ['service_ref', 'adapter_lineage_id', 'connection_id'], path)
  return {
    service_ref: validateServiceRef(object.service_ref, `${path}.service_ref`),
    adapter_lineage_id: requiredString(object.adapter_lineage_id, `${path}.adapter_lineage_id`),
    connection_id: requiredString(object.connection_id, `${path}.connection_id`),
  }
}

export function validateAdapterResourceRef(
  value: unknown,
  path = 'adapter_resource_ref',
): AdapterResourceRef {
  const object = plainObject(value, path)
  exactKeys(object, ['connection_ref', 'resource_type', 'external_id'], path)
  return {
    connection_ref: validateConnectionRef(object.connection_ref, `${path}.connection_ref`),
    resource_type: requiredString(object.resource_type, `${path}.resource_type`, KEY, 64),
    external_id: requiredString(
      object.external_id,
      `${path}.external_id`,
      /^[^\u{0}-\u{1F}]{1,160}$/u,
      160,
    ),
  }
}

function validateEntity(value: unknown, path: string): EntityRef {
  const object = plainObject(value, path)
  const kind = object.kind as EntityKind
  if (
    ![
      'artifact',
      'connection',
      'execution',
      'improvement-case',
      'memory-resource',
      'planning-space',
      'project',
      'registry',
      'service',
      'session',
      'skill',
      'work-item',
      'workflow',
    ].includes(kind)
  ) {
    invalid(`${path}.kind`, 'unknown entity kind')
  }
  switch (kind as EntityKind) {
    case 'project': {
      exactKeys(object, ['kind', 'project_id'], path)
      return {
        kind: 'project',
        project_id: requiredString(object.project_id, `${path}.project_id`, PROJECT_ID, 160),
      }
    }
    case 'planning-space':
    case 'workflow':
    case 'work-item':
    case 'execution':
    case 'memory-resource':
    case 'artifact':
    case 'improvement-case': {
      exactKeys(object, ['kind', 'resource_id'], path)
      return {
        kind: kind as
          | 'planning-space'
          | 'workflow'
          | 'work-item'
          | 'execution'
          | 'memory-resource'
          | 'artifact'
          | 'improvement-case',
        resource_id: requiredString(object.resource_id, `${path}.resource_id`, RESOURCE_ID, 512),
      }
    }
    case 'session': {
      exactKeys(object, ['kind', 'client_family', 'session_id'], path)
      return {
        kind: 'session',
        client_family: requiredString(
          object.client_family,
          `${path}.client_family`,
          /^[a-z][a-z0-9._-]{0,63}$/i,
          64,
        ),
        session_id: requiredString(object.session_id, `${path}.session_id`, ID, 160),
      }
    }
    case 'skill': {
      exactKeys(object, ['kind', 'skill_key', 'source_scope', 'project_id'], path)
      const sourceScope = object.source_scope
      if (sourceScope !== 'global' && sourceScope !== 'project')
        invalid(`${path}.source_scope`, 'expected global or project')
      if (sourceScope === 'global' && object.project_id !== undefined)
        invalid(`${path}.project_id`, 'global skill cannot have project_id')
      const projectId =
        sourceScope === 'project'
          ? requiredString(object.project_id, `${path}.project_id`, PROJECT_ID, 160)
          : undefined
      const result: EntityRef = {
        kind: 'skill',
        skill_key: requiredString(
          object.skill_key,
          `${path}.skill_key`,
          /^[^\u{0}-\u{1F}]{1,160}$/u,
          160,
        ),
        source_scope: sourceScope,
      }
      if (projectId !== undefined) (result as { project_id?: string }).project_id = projectId
      return result
    }
    case 'service': {
      exactKeys(object, ['kind', 'owner_id', 'service_id'], path)
      return {
        kind: 'service',
        ...validateServiceRef({ owner_id: object.owner_id, service_id: object.service_id }, path),
      }
    }
    case 'connection': {
      exactKeys(object, ['kind', 'service_ref', 'adapter_lineage_id', 'connection_id'], path)
      return {
        kind: 'connection',
        ...validateConnectionRef(
          {
            service_ref: object.service_ref,
            adapter_lineage_id: object.adapter_lineage_id,
            connection_id: object.connection_id,
          },
          path,
        ),
      }
    }
    case 'registry': {
      exactKeys(object, ['kind', 'registry_id'], path)
      return {
        kind: 'registry',
        registry_id: requiredString(object.registry_id, `${path}.registry_id`),
      }
    }
    default: {
      return invalid(`${path}.kind`, 'unknown entity kind')
    }
  }
}

export function validateEntityRef(value: unknown, path = 'entity'): EntityRef {
  return validateEntity(value, path)
}

export function isEntityRef(value: unknown): value is EntityRef {
  try {
    validateEntityRef(value)
    return true
  } catch {
    return false
  }
}

export function isAdapterResourceRef(value: unknown): value is AdapterResourceRef {
  try {
    validateAdapterResourceRef(value)
    return true
  } catch {
    return false
  }
}
