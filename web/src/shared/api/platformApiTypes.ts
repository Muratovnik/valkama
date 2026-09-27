/**
 * The shapes the Platform's read models and commands take on the wire.
 *
 * Types only: every one of them is proven at runtime by the validator in the
 * module named after it, and none of these declarations is load-bearing on its
 * own. They sit together because several read models quote each other's rows.
 */

import type { ActionRef } from '@/shared/api/platformActionRef.ts'
import type {
  AdapterResourceRef,
  ConnectionRef,
  EntityRef,
  ServiceRef,
} from '@/shared/api/platformEntityRef.ts'
import type { PlatformRelation } from '@/shared/api/platformRelations.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

export const CONTEXT_INTERFACE = 'valkama-context' as const
export const UI_PREFS_INTERFACE = 'valkama-ui-prefs' as const
export const REGISTRY_INTERFACE = 'valkama-registry' as const
export const RELATION_COMMAND_INTERFACE = 'valkama-relation-command' as const
export const RELATION_RESULT_INTERFACE = 'valkama-relation-result' as const

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

type RegistryService = {
  configuration_owner: string
  direct_read: boolean
  discovery_provenance: string
  service_ref: ServiceRef
  service_type: string
  state: 'registered' | 'invalid' | 'tombstoned'
  title_key: string
  trust_owner: string
}

type RegistryAdapter = {
  adapter_id: string
  adapter_lineage_id: string
  capabilities: string[]
  configuration_owner: string
  consumes: string[]
  contract_version: 'valkama-adapter'
  execution: 'built_in' | 'local_service' | 'local_process'
  health_contract: {
    max_payload_bytes: number
    timeout_ms: number
    states?: Array<'ready' | 'not-observed' | 'degraded' | 'unavailable'>
  }
  owner_id: string
  package_id: string
  permissions: Array<{
    connection_mode: 'required' | 'none'
    entity_kinds: string[]
    permission_id: string
    target_kinds?: string[]
  }>
  publisher_id: string
  state: 'registered' | 'tombstoned'
  supported_service_types: string[]
  title_key: string
  trust_owner: string
  version: string
  direct_read?: boolean
}

/**
 * A Connection as the Kernel stores it. This is what a capability resolution
 * names; the display facts live on `RegistryConnection` below, which the
 * registry publishes once and the view joins by identity.
 */
type KernelConnection = {
  applicability: OperatingScope
  configuration_owner: string
  connection_ref: ConnectionRef
  health: 'ready' | 'not-observed' | 'degraded' | 'unavailable'
  state: 'registered' | 'invalid' | 'tombstoned'
  trust: 'trusted' | 'restricted' | 'blocked' | 'unknown'
  trust_owner: string
  diagnostics?: { code: string; message: string }
}

export type RegistryConnection = KernelConnection & {
  capabilities: RegistryAssignment['capability_id'][]
  last_checked_at: string | null
  name: string
  observed_at: string
  scope: OperatingScope
  service: {
    owner_id: string
    service_id: string
    service_type: string
    title_key: string
  }
  transport: 'built-in' | 'local-file' | 'local-process' | 'loopback-http' | 'remote-https'
}

export type RegistryAssignment = {
  assignment_id: string
  capability_id:
    | 'execution.launch'
    | 'execution.resume'
    | 'execution.stop'
    | 'session.observe'
    | 'telemetry.query'
    | 'skills.catalog'
    | 'skills.activate'
    | 'memory.open'
    | 'memory.health'
    | 'artifact.inspect'
  changed_by: string
  connection_ids: string[]
  revision: number
  scope: { kind: 'installation' } | { kind: 'project'; project_id: string }
  state: 'enabled' | 'disabled'
}

type CapabilityResolutionBase = {
  capability: {
    assignment_scopes: ['installation', 'project']
    capability_id: RegistryAssignment['capability_id']
    cardinality: 'one' | 'one-or-more'
    operation_character: 'read' | 'write'
    permissions: string[]
    result_type:
      'execution' | 'session' | 'telemetry' | 'skill' | 'memory-resource' | 'artifact' | 'health'
    unavailable_state: 'unavailable'
  }
  connections: KernelConnection[]
  health: KernelConnection['health'][]
  permissions: string[]
}

type CapabilityResolution = CapabilityResolutionBase &
  (
    | {
        assignment: RegistryAssignment
        source: 'installation' | 'project'
        state: 'ready'
      }
    | {
        connections: []
        health: []
        reason: string
        source: 'installation' | 'project' | null
        state: 'unavailable'
        assignment?: RegistryAssignment
      }
  )

export type RegistryGrant = {
  active: boolean
  adapter_lineage_id: string
  applicability: OperatingScope
  connection_ref: ConnectionRef | null
  data_scope_ids: string[]
  entity_kinds: string[]
  grant_id: string
  granted_at: string
  granted_by: string
  permission_id: string
  revision: number
  state: 'active' | 'revoked'
}

type RegistryPackage = {
  execution: 'built_in' | 'local_service' | 'local_process'
  package_id: string
  provenance: 'platform-built-in' | 'provider-owned'
  publisher_id: string
  version: string
}

type CoreRefBinding = {
  adapter_lineage_id: string
  binding_version: string
  connection_id: string
  core_ref_kind: string
  direct_read: false
  service_ref: ServiceRef
}

export type RegistryAudit = {
  at: string
  detail:
    | Record<string, never>
    | { adapter_lineage_id: string }
    | { revoked_by: string }
    | { state: 'enabled' | 'disabled' }
    | {
        binding: {
          project_id: string
          registry_revision: number
          resource_ref: EntityRef
        }
        decision: {
          adapter_lineage_id: string
          assignment_id: string
          assignment_revision: number
          connection_health: RegistryConnection['health']
          connection_ref: ConnectionRef
          connection_state: RegistryConnection['state']
          connection_trust: RegistryConnection['trust']
          grant_id: string
          grant_revision: number
          permission_id: string
        }
        invocation_scope: OperatingScope
        target: AdapterResourceRef
        view_scope: OperatingScope
      }
  entity_id: string
  entity_kind: string
  event_kind: string
  sequence: number
}

export type ActionInputDescriptor = {
  action_id: string
  confirmation: 'required'
  fields: [{ key: 'external_id'; kind: 'stable-id'; max_length: 128; required: true }]
  operation: 'attach' | 'open' | 'remove'
  resource_types: string[]
  title_key: string
}

export type PlatformRegistryReady = {
  action_inputs: ActionInputDescriptor[]
  actions: ActionRef[]
  adapters: RegistryAdapter[]
  assignments: RegistryAssignment[]
  audit: RegistryAudit[]
  capabilities: CapabilityResolution[]
  connections: RegistryConnection[]
  core_ref_bindings: CoreRefBinding[]
  grants: RegistryGrant[]
  modules: ModuleRegistration[]
  packages: RegistryPackage[]
  services: RegistryService[]
}

export type PlatformRegistryPayload = {
  interface_version: typeof REGISTRY_INTERFACE
  scope: OperatingScope
  state: PlatformUiState<PlatformRegistryReady>
}

export type InvocationContext = {
  invocation_scope: OperatingScope
  target: EntityRef | AdapterResourceRef
  view_scope: OperatingScope
}

export type PlatformRelationCommand = {
  action_ref: ActionRef
  confirmation: true
  entity_ref: EntityRef
  expected_revision: number
  interface_version: typeof RELATION_COMMAND_INTERFACE
  invocation_context: InvocationContext
  operation: 'attach' | 'remove'
  resource_ref: AdapterResourceRef
  fallback_label?: string
}

export type PlatformRelationResult = {
  card_revision: number
  entity_ref: EntityRef
  interface_version: typeof RELATION_RESULT_INTERFACE
  operation: 'attach' | 'remove'
  relation?: PlatformRelation
  removed?: true
}

export const ACTION_COMMAND_INTERFACE = 'valkama-action-command' as const
export const ACTION_RESULT_INTERFACE = 'valkama-action-result' as const

export type PlatformActionCommand = {
  action_ref: ActionRef
  confirmation: true
  input: { entity_ref: EntityRef; resource_ref: AdapterResourceRef }
  interface_version: typeof ACTION_COMMAND_INTERFACE
  invocation_context: InvocationContext
}

export type PlatformActionResult = {
  action_ref: ActionRef
  entity_ref: EntityRef
  interface_version: typeof ACTION_RESULT_INTERFACE
  presentation: { label: string }
  target: { target_kind: 'external-resource'; uri: string }
}
import type { ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
