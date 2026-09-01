/**
 * The two command/result pairs: mutating a relation, and invoking an action.
 *
 * A command is validated before it is sent and its result is validated before it
 * is believed, because the far side is an adapter this product does not own.
 */

import {
  boundedText,
  fromValidator,
  parseContract,
  positiveInt,
  safeText,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { invalid, validateActionRef } from '@/shared/api/platformActionRef.ts'
import { enumField } from '@/shared/api/platformApiGuards.ts'
import {
  ACTION_COMMAND_INTERFACE,
  ACTION_RESULT_INTERFACE,
  RELATION_COMMAND_INTERFACE,
  RELATION_RESULT_INTERFACE,
} from '@/shared/api/platformApiTypes.ts'
import type {
  InvocationContext,
  PlatformActionCommand,
  PlatformActionResult,
  PlatformRelationCommand,
  PlatformRelationResult,
} from '@/shared/api/platformApiTypes.ts'
import { validateAdapterResourceRef, validateEntityRef } from '@/shared/api/platformEntityRef.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import { validatePlatformRelation } from '@/shared/api/platformRelations.ts'
import { validateOperatingScope } from '@/shared/api/platformRoute.ts'

function workItemEntity(value: unknown, path: string): EntityRef {
  const entity = validateEntityRef(value, path)
  if (entity.kind !== 'work-item') invalid(path, 'expected work-item entity')
  return entity
}

const invocationContextSchema = strictObject({
  view_scope: fromValidator(validateOperatingScope),
  invocation_scope: fromValidator(validateOperatingScope),
  target: z.unknown(),
})

function validateInvocationContext(value: unknown, path: string): InvocationContext {
  const record = parseContract(invocationContextSchema, value, path, invalid)
  // Two grammars answer for one field and the first that accepts the value
  // wins; a union would report neither refusal.
  const target = (() => {
    try {
      return validateEntityRef(record.target, `${path}.target`)
    } catch {
      return validateAdapterResourceRef(record.target, `${path}.target`)
    }
  })()
  return {
    view_scope: record.view_scope,
    invocation_scope: record.invocation_scope,
    target,
  }
}

const platformRelationCommandSchema = strictObject({
  interface_version: z.literal(RELATION_COMMAND_INTERFACE, {
    message: `expected ${RELATION_COMMAND_INTERFACE}`,
  }),
  operation: enumField(['attach', 'remove'] as const),
  entity_ref: fromValidator(workItemEntity),
  resource_ref: fromValidator(validateAdapterResourceRef),
  invocation_context: z.unknown(),
  action_ref: fromValidator(validateActionRef),
  expected_revision: positiveInt(true),
  confirmation: z.literal(true, { message: 'explicit confirmation must be true' }),
  fallback_label: safeText(240).optional(),
})

export function validatePlatformRelationCommand(
  value: unknown,
  path = 'command',
): PlatformRelationCommand {
  const record = parseContract(platformRelationCommandSchema, value, path, invalid)
  const context = validateInvocationContext(record.invocation_context, `${path}.invocation_context`)
  if (context.invocation_scope.kind !== 'project')
    invalid(
      `${path}.invocation_context.invocation_scope`,
      'relation writes require exact Project scope',
    )
  if (JSON.stringify(context.target) !== JSON.stringify(record.resource_ref))
    invalid(`${path}.invocation_context.target`, 'target must equal resource_ref')
  const result: PlatformRelationCommand = {
    interface_version: RELATION_COMMAND_INTERFACE,
    operation: record.operation,
    entity_ref: record.entity_ref,
    resource_ref: record.resource_ref,
    invocation_context: context,
    action_ref: record.action_ref,
    expected_revision: record.expected_revision,
    confirmation: true,
  }
  if (record.fallback_label !== undefined) result.fallback_label = record.fallback_label
  return result
}

const platformRelationResultSchema = strictObject({
  interface_version: z.literal(RELATION_RESULT_INTERFACE, {
    message: `expected ${RELATION_RESULT_INTERFACE}`,
  }),
  operation: enumField(['attach', 'remove'] as const),
  entity_ref: fromValidator(workItemEntity),
  card_revision: positiveInt(true),
  relation: z.unknown().optional(),
  removed: z.unknown().optional(),
})

export function validatePlatformRelationResult(
  value: unknown,
  path = 'result',
): PlatformRelationResult {
  const record = parseContract(platformRelationResultSchema, value, path, invalid)
  const result: PlatformRelationResult = {
    interface_version: RELATION_RESULT_INTERFACE,
    operation: record.operation,
    entity_ref: record.entity_ref,
    card_revision: record.card_revision,
  }
  if (record.operation === 'attach') {
    if (record.relation === undefined || record.removed !== undefined)
      invalid(path, 'attach requires relation only')
    result.relation = validatePlatformRelation(record.relation, `${path}.relation`)
  } else {
    if (record.removed !== true || record.relation !== undefined)
      invalid(path, 'remove requires removed=true only')
    result.removed = true
  }
  return result
}

const platformActionCommandSchema = strictObject({
  interface_version: z.literal(ACTION_COMMAND_INTERFACE, {
    message: `expected ${ACTION_COMMAND_INTERFACE}`,
  }),
  action_ref: fromValidator(validateActionRef),
  invocation_context: z.unknown(),
  input: strictObject({
    entity_ref: fromValidator(workItemEntity),
    resource_ref: fromValidator(validateAdapterResourceRef),
  }),
  confirmation: z.literal(true, { message: 'explicit confirmation must be true' }),
})

export function validatePlatformActionCommand(
  value: unknown,
  path = 'command',
): PlatformActionCommand {
  const record = parseContract(platformActionCommandSchema, value, path, invalid)
  const context = validateInvocationContext(record.invocation_context, `${path}.invocation_context`)
  if (context.invocation_scope.kind !== 'project')
    invalid(
      `${path}.invocation_context.invocation_scope`,
      'external actions require exact Project scope',
    )
  if (JSON.stringify(context.target) !== JSON.stringify(record.input.resource_ref))
    invalid(`${path}.invocation_context.target`, 'target must equal input.resource_ref')
  return {
    interface_version: ACTION_COMMAND_INTERFACE,
    action_ref: record.action_ref,
    invocation_context: context,
    input: record.input,
    confirmation: true,
  }
}

const platformActionResultSchema = strictObject({
  interface_version: z.literal(ACTION_RESULT_INTERFACE, {
    message: `expected ${ACTION_RESULT_INTERFACE}`,
  }),
  action_ref: fromValidator(validateActionRef),
  entity_ref: fromValidator(workItemEntity),
  target: strictObject({
    target_kind: z.literal('external-resource', { message: 'expected external-resource' }),
    uri: boundedText(/^[a-z][a-z0-9+.-]{1,31}:\/\/[^\s<>"']{1,2000}$/u, 2048),
  }),
  presentation: strictObject({ label: boundedText(/^[^<>\u{0}-\u{1F}]{1,240}$/u, 240) }),
})

export function validatePlatformActionResult(
  value: unknown,
  path = 'result',
): PlatformActionResult {
  const record = parseContract(platformActionResultSchema, value, path, invalid)
  const uri = record.target.uri
  const scheme = uri.slice(0, uri.indexOf(':')).toLocaleLowerCase()
  if (['data', 'file', 'http', 'javascript', 'vbscript'].includes(scheme)) {
    invalid(`${path}.target.uri`, 'unsafe external-resource scheme')
  }
  return {
    interface_version: ACTION_RESULT_INTERFACE,
    action_ref: record.action_ref,
    entity_ref: record.entity_ref,
    target: { target_kind: 'external-resource', uri },
    presentation: { label: record.presentation.label },
  }
}
