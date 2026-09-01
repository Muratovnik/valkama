/**
 * Every HTTP call the Platform makes, and nothing else.
 *
 * The contracts live beside this file, one module per read model. What is left
 * here is the request: the query a scope becomes, the endpoint each read model
 * is fetched from, and the four commands that write.
 */

import { boundedText, parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { invalid } from '@/shared/api/platformActionRef.ts'
import { assertScope, canonicalJson, ID } from '@/shared/api/platformApiGuards.ts'
import { UI_PREFS_INTERFACE } from '@/shared/api/platformApiTypes.ts'
import type {
  PlatformActionCommand,
  PlatformActionResult,
  PlatformContextPayload,
  PlatformRegistryPayload,
  PlatformRelationCommand,
  PlatformRelationResult,
  PlatformUiPrefs,
  PlatformUiPrefsResult,
  RegistryAssignment,
} from '@/shared/api/platformApiTypes.ts'
import {
  validatePlatformActionCommand,
  validatePlatformActionResult,
  validatePlatformRelationCommand,
  validatePlatformRelationResult,
} from '@/shared/api/platformCommands.ts'
import {
  uiPrefs,
  validatePlatformContextPayload,
  validatePlatformUiPrefsResult,
} from '@/shared/api/platformContextPayload.ts'
import {
  validateModuleRegistration,
  validateModulesPayload,
} from '@/shared/api/platformModuleContract.ts'
import type {
  ModuleId,
  ModuleRegistration,
  ModulesPayload,
} from '@/shared/api/platformModuleContract.ts'
import {
  assignmentSchema,
  capabilityResolutionSchema,
  validatePlatformRegistryPayload,
} from '@/shared/api/platformRegistryPayload.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { validatePlatformUiState } from '@/shared/api/platformUiState.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'

export function scopeQuery(scope: OperatingScope): URLSearchParams {
  const query = new URLSearchParams({ scope_kind: scope.kind })
  if (scope.kind === 'project') query.set('project_id', scope.project_ref.project_id)
  return query
}

export async function requestUnknown(input: string, init?: RequestInit): Promise<unknown> {
  const response = await secureFetch(input, init)
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    let state: ReturnType<typeof validatePlatformUiState> | undefined
    if (payload !== null) {
      try {
        state = validatePlatformUiState(payload, 'error')
      } catch {
        // A proxy or older adapter may return a shorter error body. The HTTP
        // status is still authoritative for retry and conflict recovery.
      }
    }
    const failure = new Error(state && 'reason' in state ? state.reason : `HTTP ${response.status}`)
    Object.assign(failure, { status: response.status, ...(state ? { state } : {}) })
    throw failure
  }
  return payload
}

export async function fetchModules(): Promise<ModulesPayload> {
  return validateModulesPayload(await requestUnknown('/api/modules'))
}

export async function setModuleState(
  moduleId: ModuleId,
  state: 'enabled' | 'disabled',
  expectedRevision: number,
): Promise<ModuleRegistration> {
  const payload = await requestUnknown('/api/modules/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module_id: moduleId, state, expected_revision: expectedRevision }),
  })
  const object = payload as { interface_version?: unknown; module?: unknown }
  if (object.interface_version !== 'valkama-modules') invalid('module_result', 'wrong interface')
  const registration = validateModuleRegistration(object.module, 'module_result.module')
  if (
    registration.manifest.module_id !== moduleId ||
    registration.state !== state ||
    registration.revision !== expectedRevision + 1
  )
    invalid('module_result.module', 'response does not match optimistic mutation')
  return registration
}

export async function fetchPlatformContext(scope: OperatingScope): Promise<PlatformContextPayload> {
  const payload = validatePlatformContextPayload(
    await requestUnknown(`/api/platform/context?${scopeQuery(scope)}`),
  )
  assertScope(payload.scope, scope, 'context.scope')
  return payload
}

const ASSIGNMENT_ACTIVATION_INTERFACE = 'valkama-assignment-activation' as const
const ASSIGNMENT_SELECTION_INTERFACE = 'valkama-assignment-selection' as const

const assignmentResultSchema = strictObject({
  interface_version: z.literal(ASSIGNMENT_ACTIVATION_INTERFACE, {
    message: `expected ${ASSIGNMENT_ACTIVATION_INTERFACE}`,
  }),
  assignment: assignmentSchema,
})

const assignmentSelectionResultSchema = strictObject({
  interface_version: z.literal(ASSIGNMENT_SELECTION_INTERFACE),
  operation: z.enum(['set', 'reset']),
  assignment: assignmentSchema.nullable(),
  effective: capabilityResolutionSchema,
})
type AssignmentSelectionResult = z.infer<typeof assignmentSelectionResultSchema>

export async function setAssignmentState(
  assignmentId: string,
  state: 'enabled' | 'disabled',
): Promise<RegistryAssignment> {
  const result = parseContract(
    assignmentResultSchema,
    await requestUnknown('/api/platform/assignments/activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interface_version: ASSIGNMENT_ACTIVATION_INTERFACE,
        assignment_id: parseContract(
          boundedText(ID),
          assignmentId,
          'assignment_command.assignment_id',
          invalid,
        ),
        state,
      }),
    }),
    'assignment_result',
    invalid,
  )
  return result.assignment
}

export async function setPlatformAssignment(
  capabilityId: RegistryAssignment['capability_id'],
  scope: RegistryAssignment['scope'],
  connectionIds: string[],
  expectedRevision: number,
): Promise<AssignmentSelectionResult> {
  return parseContract(
    assignmentSelectionResultSchema,
    await requestUnknown('/api/platform/assignments/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interface_version: ASSIGNMENT_SELECTION_INTERFACE,
        operation: 'set',
        capability_id: capabilityId,
        scope,
        connection_ids: connectionIds.map((id, index) =>
          parseContract(
            boundedText(ID),
            id,
            `assignment_selection.connection_ids[${index}]`,
            invalid,
          ),
        ),
        expected_revision: expectedRevision,
      }),
    }),
    'assignment_selection_result',
    invalid,
  )
}

export async function resetProjectAssignment(
  capabilityId: RegistryAssignment['capability_id'],
  projectId: string,
  expectedRevision: number,
): Promise<AssignmentSelectionResult> {
  return parseContract(
    assignmentSelectionResultSchema,
    await requestUnknown('/api/platform/assignments/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interface_version: ASSIGNMENT_SELECTION_INTERFACE,
        operation: 'reset',
        capability_id: capabilityId,
        scope: { kind: 'project', project_id: projectId },
        expected_revision: expectedRevision,
      }),
    }),
    'assignment_selection_result',
    invalid,
  )
}

export async function savePlatformUiPrefs(prefs: PlatformUiPrefs): Promise<PlatformUiPrefsResult> {
  const validated = uiPrefs(prefs, 'ui_prefs.request')
  if (validated === null) invalid('ui_prefs.request', 'expected preference record')
  return validatePlatformUiPrefsResult(
    await requestUnknown('/api/platform/ui-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interface_version: UI_PREFS_INTERFACE, ...validated }),
    }),
  )
}

export async function fetchPlatformRegistry(
  scope: OperatingScope,
): Promise<PlatformRegistryPayload> {
  const payload = validatePlatformRegistryPayload(
    await requestUnknown(`/api/platform/registry?${scopeQuery(scope)}`),
  )
  assertScope(payload.scope, scope, 'registry.scope')
  return payload
}

export async function mutatePlatformRelation(
  command: PlatformRelationCommand,
): Promise<PlatformRelationResult> {
  const body = validatePlatformRelationCommand(command)
  const result = validatePlatformRelationResult(
    await requestUnknown('/api/platform/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  if (
    result.operation !== body.operation ||
    canonicalJson(result.entity_ref) !== canonicalJson(body.entity_ref)
  )
    invalid('result', 'response does not match relation command')
  return result
}

export async function invokePlatformAction(
  command: PlatformActionCommand,
): Promise<PlatformActionResult> {
  const body = validatePlatformActionCommand(command)
  const result = validatePlatformActionResult(
    await requestUnknown('/api/platform/actions/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  if (
    canonicalJson(result.action_ref) !== canonicalJson(body.action_ref) ||
    canonicalJson(result.entity_ref) !== canonicalJson(body.input.entity_ref)
  )
    invalid('result', 'response does not match action command')
  return result
}
