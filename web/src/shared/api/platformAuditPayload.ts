import {
  boundedText,
  fromValidator,
  parseContract,
  plainObject,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { invalid } from '@/shared/api/platformActionRef.ts'
import { canonicalJson, enumField, ID, ISO, PROJECT_ID } from '@/shared/api/platformApiGuards.ts'
import type { RegistryAudit } from '@/shared/api/platformApiTypes.ts'
import {
  validateAdapterResourceRef,
  validateConnectionRef,
  validateEntityRef,
} from '@/shared/api/platformEntityRef.ts'
import { validateOperatingScope } from '@/shared/api/platformRoute.ts'

const actionDetailSchema = strictObject({
  view_scope: fromValidator(validateOperatingScope),
  invocation_scope: fromValidator(validateOperatingScope),
  target: fromValidator(validateAdapterResourceRef),
  binding: strictObject({
    project_id: boundedText(PROJECT_ID, 160),
    resource_ref: fromValidator(validateEntityRef),
    registry_revision: positiveInt(true),
  }),
  decision: strictObject({
    permission_id: boundedText(ID),
    adapter_lineage_id: boundedText(ID),
    connection_ref: fromValidator(validateConnectionRef),
    connection_state: enumField(['registered', 'invalid', 'tombstoned'] as const),
    connection_trust: enumField(['trusted', 'restricted', 'blocked', 'unknown'] as const),
    connection_health: enumField(['ready', 'not-observed', 'degraded', 'unavailable'] as const),
    assignment_id: boundedText(ID),
    assignment_revision: positiveInt(),
    grant_id: boundedText(ID),
    grant_revision: positiveInt(),
  }),
})
  .refine(
    (detail) =>
      detail.invocation_scope.kind === 'project' &&
      detail.invocation_scope.project_ref.project_id === detail.binding.project_id,
    { message: 'must match exact Project invocation scope', path: ['binding', 'project_id'] },
  )
  .refine(
    (detail) =>
      canonicalJson(detail.target.connection_ref) === canonicalJson(detail.decision.connection_ref),
    { message: 'must match target connection_ref', path: ['decision', 'connection_ref'] },
  )

const metadataDetailSchema = z.union([
  strictObject({}),
  strictObject({ adapter_lineage_id: boundedText(ID) }),
  strictObject({ revoked_by: boundedText(ID) }),
  strictObject({ state: enumField(['enabled', 'disabled'] as const) }),
])

const auditSchema = strictObject({
  sequence: positiveInt(),
  event_kind: boundedText(ID),
  entity_kind: boundedText(ID),
  entity_id: boundedText(ID),
  detail: plainObject,
  at: boundedText(ISO, 96),
})

/** Validate the event envelope and the exact detail family its event may carry. */
export function validateRegistryAudit(value: unknown, path: string): RegistryAudit {
  const record = parseContract(auditSchema, value, path, invalid)
  // Only action invocation events carry the authorization decision. Registry
  // lifecycle events use one of the Kernel's small, exact metadata records.
  const schema = record.event_kind === 'action.invoked' ? actionDetailSchema : metadataDetailSchema
  const detail = parseContract(schema, record.detail, `${path}.detail`, invalid)
  return { ...record, detail }
}
