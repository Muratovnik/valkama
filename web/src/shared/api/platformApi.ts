/**
 * Every HTTP call the Platform makes, and nothing else.
 *
 * The contracts live beside this file, one module per read model. What is left
 * here is the request: the query a scope becomes, the endpoint each read model
 * is fetched from, and the two commands that write.
 */

import { assertScope, invalid } from '@/shared/api/platformApiGuards.ts'
import { UI_PREFS_INTERFACE } from '@/shared/api/platformApiTypes.ts'
import type {
  PlatformContextPayload,
  PlatformUiPrefs,
  PlatformUiPrefsResult,
} from '@/shared/api/platformApiTypes.ts'
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
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { validatePlatformUiState } from '@/shared/api/platformUiState.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

export function scopeQuery(scope: OperatingScope): URLSearchParams {
  const query = new URLSearchParams({ scope_kind: scope.kind })
  if (scope.kind === 'project') query.set('project_id', scope.project_ref.project_id)
  return query
}

export async function requestUnknown(input: string, init?: RequestInit): Promise<unknown> {
  const { response, payload } = await readJsonResponse(input, init)
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
