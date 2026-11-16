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

/** A project as the shell names it: its id and the name a reader sees. */
type ShellProject = { display_name: string; project_id: string }

/**
 * One space the shell can open, with its projects, the default one first, and the
 * projects of other spaces its items name, each with the key of the space it lives in
 * (null when the registry binds it to no space).
 */
export type ShellSpace = {
  data_scope_id: string
  default_project: string | null
  name: string
  other_space_projects: Array<ShellProject & { space_key: string | null }>
  projects: ShellProject[]
  space_key: string
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
  spaces: ShellSpace[]
  ui_prefs: PlatformUiPrefs | null
}

export type PlatformContextPayload = {
  interface_version: typeof CONTEXT_INTERFACE
  scope: OperatingScope
  state: PlatformUiState<PlatformContextReady>
}
