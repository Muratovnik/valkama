import assert from 'node:assert/strict'

import { test } from 'vitest'

import { validatePlatformRegistryPayload } from '@/shared/api/platformRegistryPayload.ts'

import { moduleRegistrations } from './support/moduleRegistrations.ts'
import { unavailableCapabilityResolutions } from './support/platformCapabilities.ts'

const connectionRef = {
  service_ref: { owner_id: 'openai', service_id: 'codex' },
  adapter_lineage_id: 'codex-execution',
  connection_id: 'local',
}
const connectionId = 'openai:codex:codex-execution:local'

function registryPayload() {
  const assignment = {
    assignment_id: 'installation-execution-launch',
    capability_id: 'execution.launch',
    changed_by: 'platform-seed',
    connection_ids: [connectionId],
    revision: 1,
    scope: { kind: 'installation' },
    state: 'enabled',
  }
  // The Kernel record a resolution names, and the display row the registry
  // publishes for it. Two shapes on purpose: the resolution does not carry a
  // second copy of the presentation.
  const kernelConnection = {
    applicability: { kind: 'global' },
    configuration_owner: 'openai',
    connection_ref: connectionRef,
    health: 'ready',
    state: 'registered',
    trust: 'unknown',
    trust_owner: 'openai',
  }
  const connection = {
    ...kernelConnection,
    capabilities: ['execution.launch'],
    last_checked_at: '2026-08-21T08:00:00Z',
    name: 'platform.integrations.claudeCode',
    observed_at: '2026-08-21T08:00:00Z',
    scope: { kind: 'global' },
    service: {
      owner_id: 'openai',
      service_id: 'codex',
      service_type: 'agent-execution',
      title_key: 'platform.integrations.claudeCode',
    },
    transport: 'local-process',
  }
  const service = {
    configuration_owner: 'anthropic',
    direct_read: false,
    discovery_provenance: 'platform-built-in',
    service_ref: { owner_id: 'anthropic', service_id: 'claude-code' },
    service_type: 'agent-execution',
    state: 'registered',
    title_key: 'platform.integrations.claudeCode',
    trust_owner: 'anthropic',
  }
  const adapter = {
    adapter_id: 'claude-code-execution',
    adapter_lineage_id: 'claude-code-execution',
    capabilities: ['execution.launch'],
    configuration_owner: 'anthropic',
    consumes: [],
    contract_version: 'valkama-adapter',
    direct_read: false,
    execution: 'local_process',
    health_contract: {
      max_payload_bytes: 8192,
      states: ['ready', 'degraded', 'unavailable', 'not-observed'],
      timeout_ms: 500,
    },
    owner_id: 'valkama',
    package_id: 'valkama.claude-code',
    permissions: [
      {
        connection_mode: 'required',
        entity_kinds: ['registry'],
        permission_id: 'execution.launch',
      },
    ],
    publisher_id: 'valkama',
    state: 'registered',
    supported_service_types: ['agent-execution'],
    title_key: 'platform.integrations.claudeCode',
    trust_owner: 'anthropic',
    version: '1.0.0',
  }
  const capabilities = unavailableCapabilityResolutions()
  capabilities[0] = {
    assignment,
    capability: capabilities[0].capability,
    connections: [kernelConnection],
    health: ['ready'],
    permissions: ['execution.launch'],
    source: 'installation',
    state: 'ready',
  } as never
  return {
    interface_version: 'valkama-registry',
    scope: { kind: 'global' },
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        action_inputs: [],
        actions: [],
        adapters: [adapter],
        assignments: [assignment],
        audit: [],
        capabilities,
        connections: [connection],
        core_ref_bindings: [],
        grants: [],
        modules: moduleRegistrations(),
        packages: [],
        services: [service],
      },
    },
  }
}

test('registry requires one exact structurally complete resolution per Kernel capability', () => {
  const payload = registryPayload()
  assert.equal(validatePlatformRegistryPayload(payload).state.status, 'ready')

  const missing = structuredClone(payload)
  missing.state.payload.capabilities.pop()
  assert.throws(() => validatePlatformRegistryPayload(missing), /Kernel capabilities/)

  const duplicate = structuredClone(payload)
  duplicate.state.payload.capabilities[9] = structuredClone(duplicate.state.payload.capabilities[0])
  assert.throws(() => validatePlatformRegistryPayload(duplicate), /duplicate capability/)

  const wrongDefinition = structuredClone(payload)
  wrongDefinition.state.payload.capabilities[0].capability.cardinality = 'one-or-more'
  assert.throws(() => validatePlatformRegistryPayload(wrongDefinition), /Kernel definition/)
})

test('authorization targets include provider resources without widening EntityRef', () => {
  const payload = registryPayload()
  payload.state.payload.adapters.push({
    adapter_id: 'artifact-adapter',
    adapter_lineage_id: 'artifact-adapter',
    capabilities: ['artifact.inspect'],
    configuration_owner: 'workspace',
    consumes: ['work-item'],
    contract_version: 'valkama-adapter',
    execution: 'built_in',
    health_contract: { max_payload_bytes: 8192, timeout_ms: 1000 },
    owner_id: 'workspace',
    package_id: 'artifact-package',
    permissions: [
      {
        connection_mode: 'required',
        entity_kinds: ['adapter-resource'],
        permission_id: 'relation.attach',
        target_kinds: ['artifact'],
      },
    ],
    publisher_id: 'workspace',
    state: 'registered',
    supported_service_types: ['artifact-store'],
    title_key: 'platform.integrations.artifact',
    trust_owner: 'workspace',
    version: '1.0.0',
  })
  assert.equal(validatePlatformRegistryPayload(payload).state.status, 'ready')

  payload.state.payload.adapters[0].permissions[0].entity_kinds = ['not-an-entity']
  assert.throws(() => validatePlatformRegistryPayload(payload), /unknown value/)
})

test('registry assignments always carry a positive wire revision', () => {
  const missingRevision = registryPayload()
  delete (missingRevision.state.payload.assignments[0] as { revision?: number }).revision
  assert.throws(() => validatePlatformRegistryPayload(missingRevision), /revision.*missing field/)

  const zeroRevision = registryPayload()
  zeroRevision.state.payload.assignments[0].revision = 0
  assert.throws(() => validatePlatformRegistryPayload(zeroRevision), /positive integer/)
})

test('ready and unavailable capability states refuse partial or misleading facts', () => {
  const incompleteReady = registryPayload()
  const firstReady = incompleteReady.state.payload.capabilities[0] as Record<string, unknown>
  delete firstReady.assignment
  assert.throws(() => validatePlatformRegistryPayload(incompleteReady), /unknown value/)

  const incompleteUnavailable = registryPayload()
  const unavailable = incompleteUnavailable.state.payload.capabilities[1] as Record<string, unknown>
  delete unavailable.reason
  assert.throws(() => validatePlatformRegistryPayload(incompleteUnavailable), /unknown value/)

  const misleadingUnavailable = registryPayload()
  Object.assign(misleadingUnavailable.state.payload.capabilities[1], {
    connections: misleadingUnavailable.state.payload.connections,
    health: ['ready'],
  })
  assert.throws(() => validatePlatformRegistryPayload(misleadingUnavailable), /unknown value/)
})

test('ready capability facts match the authoritative resolver decision', () => {
  type ReadyFixture = {
    assignment: { connection_ids: string[]; scope: { kind: string } }
    connections: Array<{ health: string; state: string }>
    health: string[]
    source: string
  }

  const degraded = registryPayload()
  const degradedReady = degraded.state.payload.capabilities[0] as unknown as ReadyFixture
  degradedReady.connections[0].health = 'degraded'
  degradedReady.health[0] = 'degraded'
  assert.throws(() => validatePlatformRegistryPayload(degraded), /unusable connection/)

  const inactive = registryPayload()
  const inactiveReady = inactive.state.payload.capabilities[0] as unknown as ReadyFixture
  inactiveReady.connections[0].state = 'tombstoned'
  assert.throws(() => validatePlatformRegistryPayload(inactive), /unusable connection/)

  const mismatchedIdentity = registryPayload()
  const identityReady = mismatchedIdentity.state.payload.capabilities[0] as unknown as ReadyFixture
  identityReady.assignment.connection_ids = ['openai:codex:codex-execution:different']
  assert.throws(() => validatePlatformRegistryPayload(mismatchedIdentity), /assignment identities/)

  const mismatchedSource = registryPayload()
  const sourceReady = mismatchedSource.state.payload.capabilities[0] as unknown as ReadyFixture
  sourceReady.source = 'project'
  assert.throws(() => validatePlatformRegistryPayload(mismatchedSource), /assignment scope/)
})

test('a registry carries the built-in Service and Adapter records as published', () => {
  const payload = registryPayload()
  const parsed = validatePlatformRegistryPayload(payload)
  assert.equal(parsed.state.status, 'ready')
  if (parsed.state.status !== 'ready') return
  // A camelCase message key is what the catalogue actually holds. Refusing it
  // failed the whole Settings view against a payload the server was right to
  // send, and an empty fixture list is why nothing here noticed.
  assert.equal(parsed.state.payload.services[0].title_key, 'platform.integrations.claudeCode')
  assert.equal(parsed.state.payload.adapters[0].title_key, 'platform.integrations.claudeCode')
})

test('a message key is widened for camelCase and nothing else', () => {
  for (const refused of ['Platform.integrations.claudeCode', 'platform integrations', '']) {
    const payload = registryPayload()
    payload.state.payload.services[0].title_key = refused
    assert.throws(() => validatePlatformRegistryPayload(payload), /title_key/u)
  }
})

test('registry lifecycle audit accepts the Kernel metadata shapes', () => {
  const payload = registryPayload()
  payload.state.payload.audit = [
    {
      sequence: 1,
      event_kind: 'unregistered',
      entity_kind: 'adapter',
      entity_id: 'example-external',
      detail: { adapter_lineage_id: 'lineage-example-external' },
      at: '2026-08-13T09:01:00Z',
    },
  ]
  assert.equal(validatePlatformRegistryPayload(payload).state.status, 'ready')
})
