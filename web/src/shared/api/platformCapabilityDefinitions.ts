export const KERNEL_CAPABILITY_IDS = [
  'execution.launch',
  'execution.resume',
  'execution.stop',
  'session.observe',
  'telemetry.query',
  'skills.catalog',
  'skills.activate',
  'memory.open',
  'memory.health',
  'artifact.inspect',
] as const

export type KernelCapabilityId = (typeof KERNEL_CAPABILITY_IDS)[number]

const CAPABILITY_DETAILS: Record<
  KernelCapabilityId,
  { cardinality: 'one' | 'one-or-more'; operation: 'read' | 'write'; result: string }
> = {
  'execution.launch': { cardinality: 'one', operation: 'write', result: 'execution' },
  'execution.resume': { cardinality: 'one', operation: 'write', result: 'execution' },
  'execution.stop': { cardinality: 'one', operation: 'write', result: 'execution' },
  'session.observe': { cardinality: 'one-or-more', operation: 'read', result: 'session' },
  'telemetry.query': { cardinality: 'one-or-more', operation: 'read', result: 'telemetry' },
  'skills.catalog': { cardinality: 'one-or-more', operation: 'read', result: 'skill' },
  'skills.activate': { cardinality: 'one-or-more', operation: 'write', result: 'skill' },
  'memory.open': { cardinality: 'one', operation: 'read', result: 'memory-resource' },
  'memory.health': { cardinality: 'one', operation: 'read', result: 'health' },
  'artifact.inspect': { cardinality: 'one', operation: 'read', result: 'artifact' },
}

export function matchesKernelCapabilityDefinition(capability: {
  capability_id: KernelCapabilityId
  cardinality: 'one' | 'one-or-more'
  operation_character: 'read' | 'write'
  permissions: string[]
  result_type: string
}): boolean {
  const expected = CAPABILITY_DETAILS[capability.capability_id]
  return (
    capability.cardinality === expected.cardinality &&
    capability.operation_character === expected.operation &&
    capability.result_type === expected.result &&
    capability.permissions.length === 1 &&
    capability.permissions[0] === capability.capability_id
  )
}
