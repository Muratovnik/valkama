/**
 * The shapes the Platform's read models and commands take on the wire.
 *
 * Types only: every one of them is proven at runtime by the validator in the
 * module named after it, and none of these declarations is load-bearing on its
 * own. They sit together because several read models quote each other's rows.
 */

import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

export const CONTEXT_INTERFACE = 'valkama-context' as const
export const UI_PREFS_INTERFACE = 'valkama-ui-prefs' as const

export type BindingState = 'mapped' | 'unbound' | 'stale' | 'detached' | 'ambiguous' | 'unavailable'

export type ProjectDirectoryResource = {
  resource_ref: EntityRef
  state: BindingState
  reason?: string
}

type ProjectDirectory = {
  binding_state: BindingState
  project_id: string
  resources: ProjectDirectoryResource[]
  title: string
}

export type PlatformUiPrefs = {
  module_id: string
  scope: OperatingScope
  resource_ref?: EntityRef
}

export type PlatformUiPrefsResult = {
  interface_version: typeof UI_PREFS_INTERFACE
  prefs: PlatformUiPrefs
}

export type PlatformContextReady = {
  primary: { data_scope_id: string; is_writable: true }
  projects: ProjectDirectory[]
  ui_prefs: PlatformUiPrefs | null
}

export type PlatformContextPayload = {
  interface_version: typeof CONTEXT_INTERFACE
  scope: OperatingScope
  state: PlatformUiState<PlatformContextReady>
}
