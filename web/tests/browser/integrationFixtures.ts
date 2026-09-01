import type { RegistryConnection } from '@/shared/api/platformApiTypes.ts'

import { globalScope, now } from './planningFixtures.ts'

type BuiltInConnectionInput = {
  capabilities: string[]
  id: string
  name: string
  transport: 'built-in' | 'local-file' | 'local-process' | 'loopback-http'
  diagnostics?: string
}

function builtInConnection(input: BuiltInConnectionInput): RegistryConnection {
  return {
    connection_ref: {
      service_ref: { owner_id: 'platform', service_id: input.id },
      adapter_lineage_id: input.id,
      connection_id: 'singleton',
    },
    applicability: globalScope,
    configuration_owner: input.id,
    trust_owner: 'platform',
    trust: 'trusted',
    health: 'ready',
    state: 'registered',
    ...(input.diagnostics ? { diagnostics: { code: 'ready', message: input.diagnostics } } : {}),
    name: input.name,
    service: {
      owner_id: 'platform',
      service_id: input.id,
      service_type: input.id,
      title_key: input.name,
    },
    transport: input.transport,
    capabilities: input.capabilities,
    scope: globalScope,
    last_checked_at: now,
    observed_at: now,
  }
}

export const builtInConnections: RegistryConnection[] = [
  builtInConnection({
    id: 'claude-code-execution',
    name: 'platform.integrations.claudeCode',
    transport: 'local-process',
    capabilities: ['execution.launch', 'execution.resume', 'execution.stop', 'session.observe'],
  }),
  builtInConnection({
    id: 'codex-execution',
    name: 'platform.integrations.codex',
    transport: 'local-process',
    capabilities: ['execution.launch', 'execution.resume', 'execution.stop', 'session.observe'],
  }),
  builtInConnection({
    id: 'claude-journal-telemetry',
    name: 'platform.integrations.claudeJournal',
    transport: 'local-file',
    capabilities: ['telemetry.query'],
  }),
  builtInConnection({
    id: 'codex-rollout-telemetry',
    name: 'platform.integrations.codexRollout',
    transport: 'local-file',
    capabilities: ['telemetry.query'],
  }),
  builtInConnection({
    id: 'agentmemory-reference-v1',
    name: 'platform.integrations.agentMemory',
    transport: 'loopback-http',
    capabilities: ['memory.open', 'memory.health'],
  }),
  builtInConnection({
    id: 'codex-skills',
    name: 'platform.integrations.codexSkills',
    transport: 'local-file',
    capabilities: ['skills.catalog', 'skills.activate'],
  }),
  builtInConnection({
    id: 'claude-skills',
    name: 'platform.integrations.claudeSkills',
    transport: 'local-file',
    capabilities: ['skills.catalog', 'skills.activate'],
  }),
  builtInConnection({
    id: 'git-artifacts',
    name: 'platform.integrations.git',
    transport: 'built-in',
    capabilities: ['artifact.inspect'],
    diagnostics:
      `The repository probe is healthy. ${'Bounded diagnostic detail '.repeat(8)}`.trim(),
  }),
]
