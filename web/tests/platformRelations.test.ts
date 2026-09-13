import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  validateContribution,
  validateContributionsPayload,
} from '@/shared/api/platformContributions.ts'
import { validateAdapterResourceRef, validateEntityRef } from '@/shared/api/platformEntityRef.ts'
import {
  planningSpaceEntity,
  planningWorkItemEntity,
  validatePlanningSpaceRef,
} from '@/shared/api/platformPlanningRefs.ts'
import {
  validatePlatformRelation,
  validatePlatformRelationsPayload,
} from '@/shared/api/platformRelations.ts'

const provider = {
  service_ref: { owner_id: 'owner', service_id: 'memory' },
  adapter_id: 'agentmemory',
  adapter_lineage_id: 'lineage-memory',
  adapter_version: '1.0.0',
  connection_id: 'singleton',
}
const workItemRef = {
  space_ref: { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', space_key: 'MAIN' },
  reference: 'MAIN-1',
}
const source = planningWorkItemEntity(workItemRef)
const relation = {
  interface_version: 'valkama-relations' as const,
  relation_id: 'relation-1',
  source,
  kind: 'reference' as const,
  target: {
    connection_ref: {
      service_ref: provider.service_ref,
      adapter_lineage_id: provider.adapter_lineage_id,
      connection_id: provider.connection_id,
    },
    resource_type: 'memory-entry',
    external_id: 'mem-1',
  },
  provider,
  state: 'resolved' as const,
  provenance: { source_kind: 'core-ref', observed_at: '2026-08-13T12:00:00Z' },
  presentation: { label: 'Memory pointer' },
  actions: [],
}

test('EntityRef shapes and adapter resource identity validate', () => {
  assert.deepEqual(validateEntityRef(source), source)
  assert.deepEqual(validateEntityRef({ kind: 'project', project_id: 'p1' }), {
    kind: 'project',
    project_id: 'p1',
  })
  assert.deepEqual(validateAdapterResourceRef(relation.target), relation.target)
  assert.throws(
    () =>
      planningWorkItemEntity({
        space_ref: { data_scope_id: 'not-uuid', space_key: 'MAIN' },
        reference: 'MAIN-1',
      }),
    /data_scope_id/,
  )
  // A key is uppercase, two to eight characters, and holds no separator: the
  // reference splits on the hyphen, so a key carrying one would make `QA-1-2`
  // two readings of the same text.
  for (const space_key of ['main', 'M', 'MAIN-2', 'TOOLONGKEY', 'MA IN']) {
    assert.throws(
      () =>
        planningWorkItemEntity({
          space_ref: { ...workItemRef.space_ref, space_key },
          reference: `${space_key}-1`,
        }),
      /space_key|reference/,
    )
  }
  // The pair is the identity, so a reference from another space is refused.
  assert.throws(
    () => planningWorkItemEntity({ space_ref: workItemRef.space_ref, reference: 'OTHER-1' }),
    /reference/,
  )
  assert.throws(() => validateEntityRef({ ...source, extra: true }), /unknown field/)
})

test('relation payload validates typed state/provenance/presentation/actions', () => {
  assert.equal(validatePlatformRelation(relation).relation_id, 'relation-1')
  assert.equal(
    validatePlatformRelationsPayload({
      interface_version: 'valkama-relations',
      relations: [relation],
    }).relations.length,
    1,
  )
  const beta = {
    ...relation,
    provider: { ...relation.provider, adapter_version: '2.0.0-beta.1+build.7' },
  }
  assert.equal(validatePlatformRelation(beta).provider.adapter_version, '2.0.0-beta.1+build.7')
  assert.throws(
    () =>
      validatePlatformRelation({
        ...relation,
        provider: { ...relation.provider, adapter_version: '01.2.3' },
      }),
    /adapter_version|SemVer/,
  )
  assert.throws(
    () => validatePlatformRelation({ ...relation, state: 'ready' }),
    /unknown relation state/,
  )
  assert.throws(() => validatePlatformRelation({ ...relation, extra: true }), /unknown field/)
  assert.throws(
    () =>
      validatePlatformRelationsPayload({
        interface_version: 'valkama-relations',
        relations: [relation, { ...relation }],
      }),
    /duplicate relation_id/,
  )
})

test('relation presentation refuses raw body/path/provider injection', () => {
  assert.throws(
    () =>
      validatePlatformRelation({
        ...relation,
        presentation: { label: '<script>alert(1)</script>' },
      }),
    /HTML|JS|path/,
  )
  assert.throws(
    () => validatePlatformRelation({ ...relation, target: { ...relation.target, secret: 'nope' } }),
    /unknown field/,
  )
})

test('declarative contributions validate named slots and reject executable/provider content', () => {
  const contribution = {
    interface_version: 'valkama-contributions' as const,
    contribution_id: 'memory-inspector',
    owner_kind: 'adapter' as const,
    owner_id: 'lineage-memory',
    slot: 'inspector-section' as const,
    module_id: 'planning' as const,
    entity_kinds: ['work-item'] as const,
    content: { kind: 'definition-list' as const, items: [{ label: 'Status', value: 'Resolved' }] },
    actions: [],
    provenance: {
      adapter_id: 'agentmemory',
      adapter_lineage_id: 'lineage-memory',
      adapter_version: '1.0.0',
      connection_id: 'singleton',
    },
  }
  assert.equal(validateContribution(contribution).slot, 'inspector-section')
  assert.equal(
    validateContributionsPayload({
      interface_version: 'valkama-contributions',
      contributions: [contribution],
    }).contributions.length,
    1,
  )
  const beta = {
    ...contribution,
    provenance: { ...contribution.provenance, adapter_version: '2.0.0-beta.1+build.7' },
  }
  assert.equal(validateContribution(beta).provenance?.adapter_version, '2.0.0-beta.1+build.7')
  assert.throws(
    () =>
      validateContribution({
        ...contribution,
        provenance: { ...contribution.provenance, adapter_version: '01.2.3' },
      }),
    /adapter_version|SemVer/,
  )
  assert.throws(
    () =>
      validateContribution({
        ...contribution,
        content: { kind: 'text', text: '<script>x</script>' },
      }),
    /HTML|JS|path/,
  )
  assert.throws(
    () => validateContribution({ ...contribution, content: { kind: 'raw-html', html: '<div />' } }),
    /unsupported|unknown|provider/,
  )
})

test('relation and contribution security boundaries reject anchors and missing required fields', () => {
  assert.throws(
    () =>
      validatePlatformRelation({
        ...relation,
        presentation: { label: 'ok', secondary_text: '<a href="/tmp">unsafe</a>' },
      }),
    /HTML|JS|path/,
  )
  const incomplete = { ...relation } as Record<string, unknown>
  delete incomplete.actions
  assert.throws(() => validatePlatformRelation(incomplete), /actions|missing|bounded/)
})

test('project IDs and UUIDs use the frozen lowercase canonical grammar', () => {
  for (const project_id of ['a', 'project-1', `a${'b'.repeat(159)}`]) {
    assert.deepEqual(validateEntityRef({ kind: 'project', project_id }), {
      kind: 'project',
      project_id,
    })
  }
  const uuidByVersion = [
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    'abcdefab-cdef-4abc-8def-abcdefabcdef',
    '6ba7b811-9dad-51d1-80b4-00c04fd430c8',
  ]
  for (const data_scope_id of uuidByVersion) {
    const space = { data_scope_id, space_key: 'MAIN' }
    assert.deepEqual(validateEntityRef(planningSpaceEntity(space)), planningSpaceEntity(space))
  }
  for (const project_id of ['', 'Project', '1project', 'project_name', `a${'b'.repeat(160)}`]) {
    assert.throws(() => validateEntityRef({ kind: 'project', project_id }), /project_id/)
  }
  for (const data_scope_id of [
    'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',
    'abcdefab-cdef-0abc-8def-abcdefabcdef',
    'abcdefab-cdef-6abc-8def-abcdefabcdef',
    'abcdefab-cdef-4abc-7def-abcdefabcdef',
    'not-a-uuid',
  ]) {
    assert.throws(
      () => validatePlanningSpaceRef({ data_scope_id, space_key: 'MAIN' }),
      /data_scope_id/,
    )
  }
})

test('core memory refs use the provider-neutral reference relation golden shape', () => {
  const coreMemory = {
    interface_version: 'valkama-relations' as const,
    relation_id: 'core-ref:7',
    source,
    kind: 'reference' as const,
    target: { kind: 'registry' as const, registry_id: 'memory-0123456789abcdef' },
    provider: {
      service_ref: { owner_id: 'platform', service_id: 'core-ref' },
      adapter_id: 'core-ref',
      adapter_lineage_id: 'unresolved',
      adapter_version: '0.0.0',
      connection_id: 'unresolved',
    },
    state: 'unavailable' as const,
    provenance: { source_kind: 'kanban-ref', observed_at: '2026-08-13T00:00:00Z', author: 'agent' },
    presentation: { label: 'Memory pointer' },
    actions: [],
  }
  assert.deepEqual(validatePlatformRelation(coreMemory), coreMemory)
  assert.throws(
    () => validatePlatformRelation({ ...coreMemory, kind: 'core-ref:memory' }),
    /relation kind/,
  )
})
