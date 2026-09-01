/**
 * The registry read model: services, adapters, connections, assignments,
 * grants, packages, core bindings, the audit trail and the action inputs.
 *
 * This is the largest of the read models because it is the one an operator
 * configures; every row here is something they can see and change in Settings.
 */

import {
  boundedList,
  boundedText,
  fromValidator,
  parseContract,
  positiveInt,
  strictObject,
  uniqueList,
  z,
} from '@/shared/api/contract.ts'
import { invalid, validateActionRef } from '@/shared/api/platformActionRef.ts'
import {
  authorizationTargetKindsSchema,
  canonicalJson,
  entityKindsSchema,
  enumField,
  ID,
  ISO,
  MESSAGE_KEY,
  PROJECT_ID,
  STRICT_SEMVER,
  UUID,
} from '@/shared/api/platformApiGuards.ts'
import { validateRegistryAudit } from '@/shared/api/platformAuditPayload.ts'
import {
  KERNEL_CAPABILITY_IDS,
  matchesKernelCapabilityDefinition,
} from '@/shared/api/platformCapabilityDefinitions.ts'
import { validateConnectionRef, validateServiceRef } from '@/shared/api/platformEntityRef.ts'
import { validateModulesPayload } from '@/shared/api/platformModuleContract.ts'
import { validateOperatingScope } from '@/shared/api/platformRoute.ts'

const serviceSchema = strictObject({
  service_ref: fromValidator(validateServiceRef),
  service_type: boundedText(ID),
  title_key: boundedText(MESSAGE_KEY, 96),
  configuration_owner: boundedText(ID),
  trust_owner: boundedText(ID),
  discovery_provenance: boundedText(ID),
  state: enumField(['registered', 'invalid', 'tombstoned'] as const),
  direct_read: z.boolean(),
})

const permissionSchema = strictObject({
  permission_id: boundedText(ID),
  connection_mode: enumField(['required', 'none'] as const),
  entity_kinds: authorizationTargetKindsSchema,
  target_kinds: uniqueList(boundedText(ID), 128).optional(),
})

const healthContractSchema = strictObject({
  timeout_ms: positiveInt(),
  max_payload_bytes: positiveInt(),
  states: boundedList(
    enumField(['ready', 'not-observed', 'degraded', 'unavailable'] as const),
    4,
  ).optional(),
})

const adapterSchema = strictObject({
  contract_version: z.literal('valkama-adapter', { message: 'expected valkama-adapter' }),
  adapter_id: boundedText(ID),
  adapter_lineage_id: boundedText(ID),
  version: boundedText(STRICT_SEMVER, 128),
  title_key: boundedText(MESSAGE_KEY, 96),
  package_id: boundedText(ID),
  publisher_id: boundedText(ID),
  owner_id: boundedText(ID),
  configuration_owner: boundedText(ID),
  trust_owner: boundedText(ID),
  execution: enumField(['built_in', 'local_service', 'local_process'] as const),
  supported_service_types: uniqueList(boundedText(ID), 128),
  capabilities: uniqueList(boundedText(ID), 128),
  consumes: entityKindsSchema,
  permissions: boundedList(permissionSchema, 128),
  health_contract: healthContractSchema,
  direct_read: z.boolean().optional(),
  state: enumField(['registered', 'tombstoned'] as const),
})

/**
 * A Connection as the Kernel stores it. A capability resolution names
 * Connections with exactly this record; the display facts below belong to the
 * registry's own connection list, which the view joins by identity rather than
 * carrying a second copy inside all ten resolutions.
 */
const kernelConnectionFields = {
  connection_ref: fromValidator(validateConnectionRef),
  applicability: fromValidator(validateOperatingScope),
  configuration_owner: boundedText(ID),
  trust_owner: boundedText(ID),
  trust: enumField(['trusted', 'restricted', 'blocked', 'unknown'] as const),
  health: enumField(['ready', 'not-observed', 'degraded', 'unavailable'] as const),
  state: enumField(['registered', 'invalid', 'tombstoned'] as const),
  diagnostics: strictObject({
    code: boundedText(ID),
    message: boundedText(/^[^<>\u{0}-\u{1F}]{1,512}$/u, 512),
  }).optional(),
}

const kernelConnectionSchema = strictObject(kernelConnectionFields)

const connectionSchema = strictObject({
  ...kernelConnectionFields,
  name: boundedText(ID, 160),
  service: strictObject({
    owner_id: boundedText(ID),
    service_id: boundedText(ID),
    service_type: boundedText(ID),
    title_key: boundedText(ID, 160),
  }),
  // `remote-https` is the external half: the other four are all local, and
  // an adapter on another host had no honest value among them.
  transport: enumField([
    'built-in',
    'local-file',
    'local-process',
    'loopback-http',
    'remote-https',
  ] as const),
  capabilities: uniqueList(
    z.lazy(() => capabilityIdSchema),
    32,
  ),
  scope: fromValidator(validateOperatingScope),
  last_checked_at: boundedText(ISO, 96).nullable(),
  observed_at: boundedText(ISO, 96),
})

function connectionIdentity(connection: z.infer<typeof kernelConnectionSchema>): string {
  const ref = connection.connection_ref
  return `${ref.service_ref.owner_id}:${ref.service_ref.service_id}:${ref.adapter_lineage_id}:${ref.connection_id}`
}

const capabilityIdSchema = enumField(KERNEL_CAPABILITY_IDS)

export const assignmentSchema = strictObject({
  assignment_id: boundedText(ID),
  capability_id: capabilityIdSchema,
  scope: z.union([
    strictObject({ kind: z.literal('installation') }),
    strictObject({ kind: z.literal('project'), project_id: boundedText(PROJECT_ID, 160) }),
  ]),
  connection_ids: uniqueList(boundedText(ID), 128),
  state: enumField(['enabled', 'disabled'] as const),
  changed_by: boundedText(ID),
  revision: positiveInt(),
})

const capabilitySchema = strictObject({
  capability_id: capabilityIdSchema,
  cardinality: enumField(['one', 'one-or-more'] as const),
  operation_character: enumField(['read', 'write'] as const),
  result_type: enumField([
    'execution',
    'session',
    'telemetry',
    'skill',
    'memory-resource',
    'artifact',
    'health',
  ] as const),
  assignment_scopes: z.tuple([z.literal('installation'), z.literal('project')]),
  permissions: uniqueList(boundedText(ID), 32),
  unavailable_state: z.literal('unavailable'),
}).refine(matchesKernelCapabilityDefinition, {
  message: 'capability definition does not match the Kernel definition',
})

const resolutionFields = {
  capability: capabilitySchema,
  permissions: uniqueList(boundedText(ID), 128),
}

const readyCapabilityResolutionSchema = strictObject({
  ...resolutionFields,
  state: z.literal('ready'),
  assignment: assignmentSchema,
  connections: boundedList(kernelConnectionSchema, 128).min(1),
  health: boundedList(
    enumField(['ready', 'not-observed', 'degraded', 'unavailable'] as const),
    128,
  ).min(1),
  source: z.enum(['installation', 'project']),
})
  .refine(
    (resolution) =>
      resolution.capability.cardinality === 'one'
        ? resolution.connections.length === 1
        : resolution.connections.length >= 1,
    { message: 'ready connection cardinality does not match capability' },
  )
  .refine(
    (resolution) =>
      resolution.assignment.capability_id === resolution.capability.capability_id &&
      resolution.assignment.state === 'enabled',
    { message: 'ready assignment does not match capability' },
  )
  .refine(
    (resolution) =>
      resolution.connections.every(
        (connection) =>
          connection.state === 'registered' &&
          (connection.health === 'ready' || connection.health === 'not-observed'),
      ),
    { message: 'ready resolution contains an unusable connection' },
  )
  .refine(
    (resolution) =>
      canonicalJson(resolution.connections.map((connection) => connectionIdentity(connection))) ===
      canonicalJson(resolution.assignment.connection_ids),
    { message: 'ready connections do not match assignment identities' },
  )
  .refine(
    (resolution) =>
      resolution.source ===
      (resolution.assignment.scope.kind === 'installation' ? 'installation' : 'project'),
    { message: 'ready source does not match assignment scope' },
  )
  .refine(
    (resolution) =>
      resolution.health.length === resolution.connections.length &&
      resolution.health.every((health, index) => health === resolution.connections[index].health),
    { message: 'ready health does not match connections' },
  )
  .refine(
    (resolution) =>
      canonicalJson(resolution.permissions) === canonicalJson(resolution.capability.permissions),
    { message: 'resolution permissions do not match capability' },
  )

const unavailableCapabilityResolutionSchema = strictObject({
  ...resolutionFields,
  state: z.literal('unavailable'),
  assignment: assignmentSchema.optional(),
  connections: z.tuple([]),
  health: z.tuple([]),
  source: z.enum(['installation', 'project']).nullable(),
  reason: boundedText(ID),
}).refine(
  (resolution) =>
    canonicalJson(resolution.permissions) === canonicalJson(resolution.capability.permissions),
  { message: 'resolution permissions do not match capability' },
)

export const capabilityResolutionSchema = z.union([
  readyCapabilityResolutionSchema,
  unavailableCapabilityResolutionSchema,
])

const grantSchema = strictObject({
  grant_id: boundedText(ID),
  adapter_lineage_id: boundedText(ID),
  connection_ref: fromValidator(validateConnectionRef).nullable(),
  permission_id: boundedText(ID),
  applicability: fromValidator(validateOperatingScope),
  entity_kinds: authorizationTargetKindsSchema,
  data_scope_ids: boundedList(boundedText(UUID, 36), 128),
  granted_by: boundedText(ID),
  granted_at: boundedText(ISO, 96),
  revision: positiveInt(),
  active: z.boolean(),
  state: enumField(['active', 'revoked'] as const),
}).refine((grant) => (grant.state === 'active') === grant.active, {
  message: 'grant active/state disagree',
})

const packageDescriptorSchema = strictObject({
  package_id: boundedText(ID),
  publisher_id: boundedText(ID),
  version: boundedText(STRICT_SEMVER, 128),
  execution: enumField(['built_in', 'local_service', 'local_process'] as const),
  provenance: enumField(['platform-built-in', 'provider-owned'] as const),
})

const coreBindingSchema = strictObject({
  core_ref_kind: boundedText(ID),
  service_ref: fromValidator(validateServiceRef),
  adapter_lineage_id: boundedText(ID),
  connection_id: boundedText(ID),
  binding_version: boundedText(ID),
  direct_read: z.literal(false, { message: 'core refs must remain pointer-only' }),
})

/** The one input a Platform action descriptor may declare is the exact stable-id
 *  field; the whole tuple is the contract, so it is checked as a unit. */
const actionInputFieldSchema = strictObject({
  key: z.unknown(),
  kind: z.unknown(),
  required: z.unknown(),
  max_length: z.unknown(),
})
  .refine(
    (field) =>
      field.key === 'external_id' &&
      field.kind === 'stable-id' &&
      field.required === true &&
      field.max_length === 128,
    { message: 'expected exact stable-id field' },
  )
  .transform(() => ({
    key: 'external_id' as const,
    kind: 'stable-id' as const,
    required: true as const,
    max_length: 128 as const,
  }))

const actionInputSchema = strictObject({
  action_id: boundedText(/^[a-z][a-z0-9-]{0,31}(?:\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159})+$/u, 192),
  operation: enumField(['attach', 'open', 'remove'] as const),
  resource_types: uniqueList(boundedText(ID), 32),
  fields: z.tuple([actionInputFieldSchema], { message: 'expected one stable-id field' }),
  confirmation: z.literal('required', { message: 'confirmation must be required' }),
  title_key: boundedText(MESSAGE_KEY, 96),
})

const registryReadySchema = strictObject({
  modules: z.unknown(),
  services: boundedList(serviceSchema),
  adapters: boundedList(adapterSchema),
  connections: boundedList(connectionSchema),
  assignments: boundedList(assignmentSchema),
  capabilities: boundedList(capabilityResolutionSchema, 10).length(10, {
    message: 'expected all Kernel capabilities',
  }),
  grants: boundedList(grantSchema),
  packages: boundedList(packageDescriptorSchema),
  actions: boundedList(fromValidator(validateActionRef)),
  action_inputs: boundedList(actionInputSchema),
  core_ref_bindings: boundedList(coreBindingSchema),
  audit: boundedList(z.unknown(), 1000),
})

function registryReady(value: unknown, path: string): PlatformRegistryReady {
  const record = parseContract(registryReadySchema, value, path, invalid)
  const result: PlatformRegistryReady = {
    ...record,
    modules: validateModulesPayload(
      { interface_version: 'valkama-modules', modules: record.modules },
      `${path}.modules_payload`,
    ).modules,
    audit: record.audit.map((entry, index) =>
      validateRegistryAudit(entry, `${path}.audit[${index}]`),
    ),
  }
  const capabilityIds = result.capabilities.map((resolution) => resolution.capability.capability_id)
  if (new Set(capabilityIds).size !== capabilityIds.length)
    invalid(`${path}.capabilities`, 'duplicate capability resolution')
  if (KERNEL_CAPABILITY_IDS.some((capabilityId) => !capabilityIds.includes(capabilityId)))
    invalid(`${path}.capabilities`, 'missing Kernel capability resolution')
  const actions = new Map(result.actions.map((entry) => [entry.action_id, entry]))
  const descriptors = new Set<string>()
  for (const descriptor of result.action_inputs) {
    const registered = actions.get(descriptor.action_id)
    if (registered?.owner_kind !== 'adapter')
      invalid(`${path}.action_inputs`, 'descriptor must reference a registered adapter action')
    if (descriptor.resource_types.length === 0)
      invalid(`${path}.action_inputs`, 'descriptor requires at least one resource type')
    const key = `${descriptor.action_id}:${descriptor.operation}`
    if (descriptors.has(key)) invalid(`${path}.action_inputs`, 'duplicate action input descriptor')
    descriptors.add(key)
  }
  return result
}

export function validatePlatformRegistryPayload(
  value: unknown,
  path = 'registry',
): PlatformRegistryPayload {
  const record = parseContract(registryEnvelopeSchema, value, path, invalid)
  return {
    interface_version: REGISTRY_INTERFACE,
    scope: record.scope,
    state: validateTypedState(record.state, `${path}.state`, registryReady),
  }
}
import { REGISTRY_INTERFACE } from '@/shared/api/platformApiTypes.ts'
import type {
  PlatformRegistryPayload,
  PlatformRegistryReady,
} from '@/shared/api/platformApiTypes.ts'
import { registryEnvelopeSchema, validateTypedState } from '@/shared/api/platformContextPayload.ts'
