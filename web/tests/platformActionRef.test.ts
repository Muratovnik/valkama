import assert from 'node:assert/strict'

import { test } from 'vitest'

import { validateActionRef } from '@/shared/api/platformActionRef.ts'

const KERNEL_ACTION = {
  interface_version: 'valkama-actions',
  action_id: 'core.work-item.open',
  owner_kind: 'kernel',
  owner_id: 'kernel',
  input_schema_id: 'core.work-item.open',
  target_kind: 'work-item',
  invocation_scope_schema: 'either',
} as const

test('core/module/adapter action namespaces are owner-bound', () => {
  assert.deepEqual(validateActionRef(KERNEL_ACTION), KERNEL_ACTION)
  assert.deepEqual(
    validateActionRef({
      interface_version: 'valkama-actions',
      action_id: 'module.planning.create',
      owner_kind: 'module',
      owner_id: 'planning',
      input_schema_id: 'planning.create',
      target_kind: 'work-item',
      invocation_scope_schema: 'project',
    }).owner_kind,
    'module',
  )
  assert.deepEqual(
    validateActionRef({
      interface_version: 'valkama-actions',
      action_id: 'adapter.lineage-a.open',
      owner_kind: 'adapter',
      owner_id: 'lineage-a',
      input_schema_id: 'adapter.open',
      target_kind: 'adapter-resource',
      invocation_scope_schema: 'project',
    }).owner_kind,
    'adapter',
  )
  assert.equal(
    validateActionRef({
      interface_version: 'valkama-actions',
      action_id: 'module.planning.work-item.create',
      owner_kind: 'module',
      owner_id: 'planning',
      input_schema_id: 'planning.work-item.create',
      target_kind: 'work-item',
      invocation_scope_schema: 'project',
    }).action_id,
    'module.planning.work-item.create',
  )
})
test('action validator rejects owner takeover, namespace mismatch, and additive fields', () => {
  const base = KERNEL_ACTION
  assert.throws(
    () => validateActionRef({ ...base, action_id: 'module.planning.create' }),
    /kernel actions/,
  )
  assert.throws(() => validateActionRef({ ...base, owner_id: 'other' }), /owner_id/)
  assert.throws(() => validateActionRef({ ...base, extra: true }), /unknown field/)
})

test('action owner identifiers use the shared 128-character bound', () => {
  for (const owner of ['a', 'lineage-1', 'a'.repeat(128)]) {
    const accepted = {
      interface_version: 'valkama-actions',
      action_id: `adapter.${owner}.open`,
      owner_kind: 'adapter',
      owner_id: owner,
      input_schema_id: 'adapter.open',
      target_kind: 'adapter-resource',
      invocation_scope_schema: 'project',
    }
    assert.equal(validateActionRef(accepted).owner_id, owner)
  }
  for (const owner of ['', '-lineage', 'a'.repeat(129)]) {
    assert.throws(
      () =>
        validateActionRef({
          interface_version: 'valkama-actions',
          action_id: `adapter.${owner}.open`,
          owner_kind: 'adapter',
          owner_id: owner,
          input_schema_id: 'adapter.open',
          target_kind: 'adapter-resource',
          invocation_scope_schema: 'project',
        }),
      /owner_id|action_id|bounded/,
    )
  }
})

test('action identifiers reject values beyond the shared 192-character bound', () => {
  const action = {
    ...KERNEL_ACTION,
    action_id: `core.${'a'.repeat(190)}`,
  }
  assert.throws(() => validateActionRef(action), /action_id|bounded/)
})

test('ActionRef accepts exactly 192 characters and rejects 193', () => {
  const acceptedId = `core.${'a'.repeat(62)}.${'b'.repeat(62)}.${'c'.repeat(61)}`
  assert.equal(acceptedId.length, 192)
  assert.equal(validateActionRef({ ...KERNEL_ACTION, action_id: acceptedId }).action_id, acceptedId)
  const rejectedId = `core.${'a'.repeat(62)}.${'b'.repeat(62)}.${'c'.repeat(62)}`
  assert.equal(rejectedId.length, 193)
  assert.throws(
    () => validateActionRef({ ...KERNEL_ACTION, action_id: rejectedId }),
    /action_id|bounded/,
  )
})

test('module ActionRefs reject owners outside the six frozen module IDs', () => {
  assert.throws(
    () =>
      validateActionRef({
        interface_version: 'valkama-actions',
        action_id: 'module.future.create',
        owner_kind: 'module',
        owner_id: 'future',
        input_schema_id: 'future.create',
        target_kind: 'work-item',
        invocation_scope_schema: 'project',
      }),
    /module actions/,
  )
})
