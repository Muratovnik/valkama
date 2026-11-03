/**
 * The context a shell opens with: which project directory it can see, and the
 * route preference it left behind.
 */

import {
  boundedList,
  boundedText,
  fromValidator,
  parseContract,
  safeText,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { validateEntityRef } from '@/shared/api/platformEntityRef.ts'
import { validateOperatingScope } from '@/shared/api/platformRoute.ts'
import { validatePlatformUiState } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

const projectResourceSchema = strictObject({
  resource_ref: fromValidator(validateEntityRef),
  state: z.enum([...BINDING_STATES] as [BindingState, ...BindingState[]], {
    message: 'unknown binding state',
  }),
  reason: safeText().optional(),
})

const projectDirectorySchema = strictObject({
  project_id: boundedText(PROJECT_ID, 160),
  // The registry keeps a project's name in up to 200 characters, brackets
  // included; it is shown as text, never as markup.
  title: boundedText(/^[^\u{0}]{1,200}$/u, 200),
  binding_state: z.enum([...BINDING_STATES] as [BindingState, ...BindingState[]], {
    message: 'unknown binding state',
  }),
  resources: boundedList(projectResourceSchema, 128),
})

const MODULE_ID = /^[a-z][a-z0-9-]{0,63}$/u

const uiPrefsSchema = strictObject({
  module_id: boundedText(MODULE_ID, 64),
  scope: fromValidator(validateOperatingScope),
  resource_ref: fromValidator(validateEntityRef).optional(),
})

/** Nothing is stored until the shell writes a preference once, so the wire
 *  shape is the record or an explicit null — never an absent field. */
const savedUiPrefsSchema = uiPrefsSchema.nullable()

export function uiPrefs(value: unknown, path: string): PlatformUiPrefs | null {
  return parseContract(savedUiPrefsSchema, value, path, invalid)
}

const platformUiPrefsResultSchema = strictObject({
  interface_version: z.literal(UI_PREFS_INTERFACE, {
    message: `expected ${UI_PREFS_INTERFACE}`,
  }),
  prefs: savedUiPrefsSchema,
})

export function validatePlatformUiPrefsResult(
  value: unknown,
  path = 'ui_prefs',
): PlatformUiPrefsResult {
  const record = parseContract(platformUiPrefsResultSchema, value, path, invalid)
  if (record.prefs === null) invalid(`${path}.prefs`, 'expected saved preference record')
  return { interface_version: UI_PREFS_INTERFACE, prefs: record.prefs }
}

const contextReadySchema = strictObject({
  primary: strictObject({
    data_scope_id: boundedText(UUID, 36),
    is_writable: z.literal(true, { message: 'primary must be explicitly writable' }),
  }),
  projects: z.array(projectDirectorySchema),
  ui_prefs: savedUiPrefsSchema,
})

function contextReady(value: unknown, path: string): PlatformContextReady {
  return parseContract(contextReadySchema, value, path, invalid)
}

export function validateTypedState<T>(
  value: unknown,
  path: string,
  ready: (value: unknown, path: string) => T,
): PlatformUiState<T> {
  const state = validatePlatformUiState<T>(value, path)
  if (state.status === 'ready')
    return {
      ...state,
      payload: ready((value as Record<string, unknown>).payload, `${path}.payload`),
    }
  if (state.status === 'degraded')
    return {
      ...state,
      payload: ready((value as Record<string, unknown>).payload, `${path}.payload`),
    }
  return state
}

/** Every module read model arrives in the same three-field envelope; only the
 *  pinned interface version differs. */
function envelopeSchema(version: string) {
  return strictObject({
    interface_version: z.literal(version, { message: `expected ${version}` }),
    scope: fromValidator(validateOperatingScope),
    state: z.unknown(),
  })
}

const contextEnvelopeSchema = envelopeSchema(CONTEXT_INTERFACE)

export function validatePlatformContextPayload(
  value: unknown,
  path = 'context',
): PlatformContextPayload {
  const record = parseContract(contextEnvelopeSchema, value, path, invalid)
  return {
    interface_version: CONTEXT_INTERFACE,
    scope: record.scope,
    state: validateTypedState(record.state, `${path}.state`, contextReady),
  }
}
import { BINDING_STATES, invalid, PROJECT_ID, UUID } from '@/shared/api/platformApiGuards.ts'
import { CONTEXT_INTERFACE, UI_PREFS_INTERFACE } from '@/shared/api/platformApiTypes.ts'
import type {
  BindingState,
  PlatformContextPayload,
  PlatformContextReady,
  PlatformUiPrefs,
  PlatformUiPrefsResult,
} from '@/shared/api/platformApiTypes.ts'
