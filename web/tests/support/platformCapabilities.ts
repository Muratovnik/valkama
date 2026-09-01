const capabilityCases = [
  ['execution.launch', 'one', 'write', 'execution'],
  ['execution.resume', 'one', 'write', 'execution'],
  ['execution.stop', 'one', 'write', 'execution'],
  ['session.observe', 'one-or-more', 'read', 'session'],
  ['telemetry.query', 'one-or-more', 'read', 'telemetry'],
  ['skills.catalog', 'one-or-more', 'read', 'skill'],
  ['skills.activate', 'one-or-more', 'write', 'skill'],
  ['memory.open', 'one', 'read', 'memory-resource'],
  ['memory.health', 'one', 'read', 'health'],
  ['artifact.inspect', 'one', 'read', 'artifact'],
] as const

export function unavailableCapabilityResolutions() {
  return capabilityCases.map(([capabilityId, cardinality, operation, resultType]) => ({
    state: 'unavailable',
    capability: {
      capability_id: capabilityId,
      cardinality,
      operation_character: operation,
      result_type: resultType,
      assignment_scopes: ['installation', 'project'],
      permissions: [capabilityId],
      unavailable_state: 'unavailable',
    },
    connections: [],
    health: [],
    permissions: [capabilityId],
    source: null,
    reason: 'assignment-missing',
  }))
}
