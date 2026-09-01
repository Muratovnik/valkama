/**
 * What the platform registry, the analyzer profile and the skills inventory
 * answer, for the same one project the board fixtures describe.
 *
 * The project scope carries a connection, an assignment and a grant; the global
 * scope carries none of the three, which is what makes "this write is not
 * available here" a fact the suite can read rather than a state it has to mock.
 */
import type {
  PlatformRegistryReady,
  RegistryAssignment,
  RegistryConnection,
} from '@/shared/api/platformApiTypes.ts'

import { moduleRegistrations } from '../support/moduleRegistrations.ts'
import { unavailableCapabilityResolutions } from '../support/platformCapabilities.ts'
import { builtInConnections } from './integrationFixtures.ts'
import {
  actions,
  connectionRef,
  dataScopeId,
  now,
  projectId,
  projectScope,
} from './planningFixtures.ts'

const notesConnection: RegistryConnection = {
  connection_ref: connectionRef,
  applicability: projectScope,
  configuration_owner: 'notes-service',
  trust_owner: 'workspace',
  trust: 'trusted',
  health: 'ready',
  state: 'registered',
  diagnostics: { code: 'ready', message: 'Local fixture provider is ready.' },
  name: 'platform.integrations.notes',
  service: {
    owner_id: connectionRef.service_ref.owner_id,
    service_id: connectionRef.service_ref.service_id,
    service_type: 'artifact-store',
    title_key: 'resources.notes',
  },
  transport: 'built-in',
  capabilities: ['artifact.inspect'],
  scope: projectScope,
  last_checked_at: now,
  observed_at: now,
}
const notesAssignment: RegistryAssignment = {
  assignment_id: 'project-artifact-inspect',
  capability_id: 'artifact.inspect',
  scope: { kind: 'project' as const, project_id: projectId },
  connection_ids: ['workspace:notes:lineage-notes:primary'],
  state: 'enabled' as const,
  changed_by: 'codex',
  revision: 1,
}

function connectionIdentity(connection: RegistryConnection): string {
  const ref = connection.connection_ref
  return `${ref.service_ref.owner_id}:${ref.service_ref.service_id}:${ref.adapter_lineage_id}:${ref.connection_id}`
}

function assignment(
  capabilityId: string,
  connectionIds: string[],
  scope: { kind: 'installation' } | { kind: 'project'; project_id: string },
  revision = 1,
): RegistryAssignment {
  return {
    assignment_id: `${scope.kind}-${capabilityId.replace('.', '-')}`,
    capability_id: capabilityId,
    scope,
    connection_ids: connectionIds,
    state: 'enabled' as const,
    changed_by: 'platform-seed',
    revision,
  }
}

function builtInIdentity(id: string): string {
  return `platform:${id}:${id}:singleton`
}

const installationAssignments = [
  assignment('execution.launch', [builtInIdentity('codex-execution')], { kind: 'installation' }),
  assignment('execution.resume', [builtInIdentity('codex-execution')], { kind: 'installation' }),
  assignment('execution.stop', [builtInIdentity('codex-execution')], { kind: 'installation' }),
  assignment('session.observe', [builtInIdentity('codex-execution')], { kind: 'installation' }),
  assignment('telemetry.query', [builtInIdentity('codex-rollout-telemetry')], {
    kind: 'installation',
  }),
  assignment('skills.catalog', [builtInIdentity('codex-skills')], { kind: 'installation' }),
  assignment('skills.activate', [builtInIdentity('codex-skills')], { kind: 'installation' }),
  assignment('memory.open', [builtInIdentity('agentmemory-reference-v1')], {
    kind: 'installation',
  }),
  assignment('memory.health', [builtInIdentity('agentmemory-reference-v1')], {
    kind: 'installation',
  }),
  assignment('artifact.inspect', [builtInIdentity('git-artifacts')], { kind: 'installation' }),
]
const projectAssignments = [
  assignment('telemetry.query', [builtInIdentity('claude-journal-telemetry')], {
    kind: 'project',
    project_id: projectId,
  }),
  notesAssignment,
]

/**
 * The Kernel record a resolution names, taken from the registry's display row.
 * The two shapes differ on purpose, and a fixture that passed the display row
 * straight through was why nothing here noticed.
 */
function kernelRecord(connection: RegistryConnection) {
  const { connection_ref, applicability, configuration_owner, trust_owner, trust, health, state } =
    connection
  return {
    connection_ref,
    applicability,
    configuration_owner,
    trust_owner,
    trust,
    health,
    state,
    ...(connection.diagnostics ? { diagnostics: connection.diagnostics } : {}),
  }
}

function capabilityResolutions(
  connections: RegistryConnection[],
  assignments: RegistryAssignment[],
  project: boolean,
): PlatformRegistryReady['capabilities'] {
  const resolutions = unavailableCapabilityResolutions()
  return resolutions.map((resolution) => {
    const capabilityId = resolution.capability.capability_id
    const selected =
      (project
        ? assignments.find(
            (candidate) =>
              candidate.capability_id === capabilityId && candidate.scope.kind === 'project',
          )
        : undefined) ??
      assignments.find(
        (candidate) =>
          candidate.capability_id === capabilityId && candidate.scope.kind === 'installation',
      )
    if (!selected) return resolution
    const selectedConnections = selected.connection_ids.map((id) => {
      const found = connections.find((candidate) => connectionIdentity(candidate) === id)
      if (!found) throw new Error(`missing fixture connection ${id}`)
      return found
    })
    return {
      assignment: selected,
      capability: resolution.capability,
      connections: selectedConnections.map((candidate) => kernelRecord(candidate)),
      health: selectedConnections.map((candidate) => candidate.health),
      permissions: resolution.capability.permissions,
      source: selected.scope.kind,
      state: 'ready',
    }
  }) as PlatformRegistryReady['capabilities']
}

export function rebuildRegistryCapabilities(
  registry: {
    assignments: RegistryAssignment[]
    capabilities: PlatformRegistryReady['capabilities']
    connections: RegistryConnection[]
  },
  project: boolean,
): void {
  registry.capabilities = capabilityResolutions(
    registry.connections,
    registry.assignments,
    project,
  ) as never
}

const registryBase = {
  modules: moduleRegistrations(),
  services: [
    {
      service_ref: connectionRef.service_ref,
      service_type: 'notes',
      title_key: 'resources.notes',
      configuration_owner: 'notes-service',
      trust_owner: 'workspace',
      discovery_provenance: 'registered',
      state: 'registered',
      direct_read: false,
    },
  ],
  adapters: [
    {
      contract_version: 'valkama-adapter',
      adapter_id: 'notes-adapter',
      adapter_lineage_id: 'lineage-notes',
      version: '1.0.0',
      title_key: 'resources.notes',
      package_id: 'notes-package',
      publisher_id: 'workspace',
      owner_id: 'workspace',
      configuration_owner: 'notes-service',
      trust_owner: 'workspace',
      execution: 'local_service',
      supported_service_types: ['notes'],
      capabilities: ['attach', 'open', 'remove'],
      consumes: ['work-item'],
      permissions: [
        {
          permission_id: 'relation.attach',
          connection_mode: 'required',
          entity_kinds: ['adapter-resource'],
          target_kinds: ['note'],
        },
      ],
      health_contract: {
        timeout_ms: 1000,
        max_payload_bytes: 8192,
        states: ['ready', 'degraded', 'unavailable'],
      },
      state: 'registered',
    },
  ],
  packages: [
    {
      package_id: 'notes-package',
      publisher_id: 'workspace',
      version: '1.0.0',
      execution: 'local_service',
      provenance: 'provider-owned',
    },
  ],
  actions,
  action_inputs: actions.map((entry, index) => ({
    action_id: entry.action_id,
    operation: ['attach', 'open', 'remove'][index],
    resource_types: ['note'],
    fields: [{ key: 'external_id', kind: 'stable-id', required: true, max_length: 128 }],
    confirmation: 'required',
    title_key: `platform.relations.${['attach', 'open', 'remove'][index]}`,
  })),
  core_ref_bindings: [],
  audit: [],
}

export const projectRegistry = {
  ...registryBase,
  connections: [...builtInConnections, notesConnection],
  assignments: [...installationAssignments, ...projectAssignments],
  capabilities: capabilityResolutions(
    [...builtInConnections, notesConnection],
    [...installationAssignments, ...projectAssignments],
    true,
  ),
  grants: [
    {
      grant_id: 'grant-notes',
      adapter_lineage_id: 'lineage-notes',
      connection_ref: connectionRef,
      permission_id: 'relation.attach',
      applicability: projectScope,
      entity_kinds: ['adapter-resource'],
      data_scope_ids: [dataScopeId],
      granted_by: 'owner',
      granted_at: now,
      revision: 1,
      active: true,
      state: 'active',
    },
  ],
}
export const globalRegistry = {
  ...registryBase,
  connections: builtInConnections,
  assignments: installationAssignments,
  capabilities: capabilityResolutions(builtInConnections, installationAssignments, false),
  grants: [],
}

export const signalSummary = {
  total: 0,
  source_counts: { session_event: 0, agentmemory_lesson: 0, user_feedback: 0 },
  session_count: 0,
  last_recorded_at: null,
}
export const improvementProfile = {
  interface_version: 'improvements-api',
  scope: 'personal',
  revision: 0,
  enabled: false,
  purpose: '',
  expected_behavior: '',
  allowed_targets: [],
  excluded_targets: ['product-code'],
  analyzer_client: 'codex',
  analyzer_model: '',
  reasoning_effort: '',
  planning_space: '',
  schedule: { mode: 'manual', interval_hours: 24 },
  limits: { lookback_days: 30, max_sessions: 20, max_chars: 60_000 },
  capabilities: { can_analyze: false, can_approve: false },
  signal_summary: signalSummary,
}
