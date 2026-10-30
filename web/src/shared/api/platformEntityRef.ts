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
  plainObject,
  PROJECT_ID,
  requiredString,
} from '@/shared/api/platformRefGuards.ts'

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

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u

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

function validateEntity(value: unknown, path: string): EntityRef {
  const object = plainObject(value, path)
  const kind = object.kind as EntityKind
  if (
    ![
      'artifact',
      'execution',
      'improvement-case',
      'memory-resource',
      'planning-space',
      'project',
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
    default: {
      return invalid(`${path}.kind`, 'unknown entity kind')
    }
  }
}

export function validateEntityRef(value: unknown, path = 'entity'): EntityRef {
  return validateEntity(value, path)
}
