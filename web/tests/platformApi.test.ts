import assert from 'node:assert/strict'

import { test } from 'vitest'

import * as platformApi from '@/shared/api/platformApi.ts'
import {
  validatePlatformActionCommand,
  validatePlatformActionResult,
  validatePlatformRelationCommand,
} from '@/shared/api/platformCommands.ts'
import {
  validatePlatformContextPayload,
  validatePlatformUiPrefsResult,
} from '@/shared/api/platformContextPayload.ts'
import * as planningApi from '@/shared/api/platformPlanningApi.ts'
import { validatePlatformPlanningPayload } from '@/shared/api/platformPlanningPayload.ts'
import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { validatePlatformRegistryPayload } from '@/shared/api/platformRegistryPayload.ts'

import { moduleRegistrations } from './support/moduleRegistrations.ts'
import { unavailableCapabilityResolutions } from './support/platformCapabilities.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

const scope = { kind: 'project' as const, project_ref: { project_id: 'example-project' } }
const spaceRef = {
  data_scope_id: '123e4567-e89b-42d3-a456-426614174000',
  space_key: 'MAIN',
}
const workItemRef = { space_ref: spaceRef, reference: 'MAIN-264' }
const entityRef = planningWorkItemEntity(workItemRef)
const connectionRef = {
  service_ref: { owner_id: 'workspace', service_id: 'notes' },
  adapter_lineage_id: 'lineage-notes',
  connection_id: 'primary',
}
const action = {
  interface_version: 'valkama-actions' as const,
  action_id: 'adapter.lineage-notes.attach',
  owner_kind: 'adapter' as const,
  owner_id: 'lineage-notes',
  input_schema_id: 'adapter.resource.attach',
  target_kind: 'adapter-resource' as const,
  invocation_scope_schema: 'project' as const,
}

test('context validates exact primary and project bindings without path-shaped legacy data', () => {
  const payload = {
    interface_version: 'valkama-context',
    scope: { kind: 'global' },
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        primary: { data_scope_id: spaceRef.data_scope_id, is_writable: true },
        projects: [
          {
            project_id: 'example-project',
            title: 'Example Project',
            source_hash: 'a'.repeat(64),
            binding_state: 'mapped',
            resources: [{ resource_ref: planningSpaceEntity(spaceRef), state: 'mapped' }],
          },
        ],
        ui_prefs: null,
      },
    },
  }
  assert.equal(validatePlatformContextPayload(payload).state.status, 'ready')
  assert.throws(
    () => validatePlatformContextPayload({ ...payload, path: 'C:\\workspace' }),
    /unknown field/,
  )
})

test('context ui_prefs and saved-preference results validate exact bounded records', () => {
  const base = {
    interface_version: 'valkama-context',
    scope: { kind: 'global' },
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        primary: { data_scope_id: spaceRef.data_scope_id, is_writable: true },
        projects: [],
        ui_prefs: { module_id: 'planning', scope, resource_ref: planningSpaceEntity(spaceRef) },
      },
    },
  }
  const parsed = validatePlatformContextPayload(base)
  assert.equal(
    parsed.state.status === 'ready' && parsed.state.payload.ui_prefs?.module_id,
    'planning',
  )
  const unknownField = structuredClone(base)
  ;(unknownField.state.payload.ui_prefs as Record<string, unknown>).surprise = true
  assert.throws(() => validatePlatformContextPayload(unknownField), /unknown field/)
  const saved = validatePlatformUiPrefsResult({
    interface_version: 'valkama-ui-prefs',
    prefs: { module_id: 'skills', scope: { kind: 'global' } },
  })
  assert.equal(saved.prefs.module_id, 'skills')
  assert.throws(
    () => validatePlatformUiPrefsResult({ interface_version: 'valkama-ui-prefs', prefs: null }),
    /expected saved preference/,
  )
})

test('savePlatformUiPrefs posts one validated preference body to the owned endpoint', async () => {
  const originalFetch = globalThis.fetch
  const posts: Array<{ body: unknown; url: string }> = []
  globalThis.fetch = withSecurityBootstrap(async (input, init) => {
    posts.push({ url: requestUrl(input), body: JSON.parse(requestBody(init?.body)) })
    return new Response(
      JSON.stringify({
        interface_version: 'valkama-ui-prefs',
        prefs: { module_id: 'planning', scope, resource_ref: planningSpaceEntity(spaceRef) },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  })
  try {
    const result = await platformApi.savePlatformUiPrefs({
      module_id: 'planning',
      scope,
      resource_ref: planningSpaceEntity(spaceRef),
    })
    assert.equal(result.prefs.module_id, 'planning')
    assert.deepEqual(
      posts.map((entry) => entry.url),
      ['/api/platform/ui-prefs'],
    )
    assert.deepEqual(posts[0].body, {
      interface_version: 'valkama-ui-prefs',
      module_id: 'planning',
      scope,
      resource_ref: planningSpaceEntity(spaceRef),
    })
    await assert.rejects(
      () => platformApi.savePlatformUiPrefs({ module_id: 'Not Valid', scope }),
      /bounded string/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('registry requires distinct bounded entity arrays and explicit action input operations', () => {
  const payload = {
    interface_version: 'valkama-registry',
    scope,
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        modules: moduleRegistrations(),
        services: [],
        adapters: [],
        connections: [],
        assignments: [],
        capabilities: unavailableCapabilityResolutions(),
        grants: [],
        packages: [],
        actions: [action],
        action_inputs: [
          {
            action_id: action.action_id,
            operation: 'attach',
            resource_types: ['note'],
            fields: [{ key: 'external_id', kind: 'stable-id', required: true, max_length: 128 }],
            confirmation: 'required',
            title_key: 'resources.note.attach',
          },
        ],
        core_ref_bindings: [],
        audit: [
          {
            sequence: 1,
            event_kind: 'package.registered',
            entity_kind: 'package',
            entity_id: 'workspace:notes',
            detail: {},
            at: '2026-08-13T09:00:00Z',
          },
        ],
      },
    },
  }
  const result = validatePlatformRegistryPayload(payload)
  assert.equal(
    result.state.status === 'ready' && result.state.payload.action_inputs[0].operation,
    'attach',
  )
  const memoryResolution =
    result.state.status === 'ready'
      ? result.state.payload.capabilities.find(
          (entry) => entry.capability.capability_id === 'memory.open',
        )
      : undefined
  assert.deepEqual(
    memoryResolution
      ? {
          operation: memoryResolution.capability.operation_character,
          result: memoryResolution.capability.result_type,
        }
      : null,
    { operation: 'read', result: 'memory-resource' },
  )
  for (const field of ['operation_character', 'result_type'] as const) {
    const missingCapabilityField = structuredClone(payload)
    delete missingCapabilityField.state.payload.capabilities[0].capability[field]
    assert.throws(() => validatePlatformRegistryPayload(missingCapabilityField), /unknown value/)
  }
  const missingOperation = structuredClone(payload)
  delete (missingOperation.state.payload.action_inputs[0] as { operation?: string }).operation
  assert.throws(() => validatePlatformRegistryPayload(missingOperation), /operation.*missing field/)

  const actionAudit = structuredClone(payload)
  actionAudit.state.payload.audit[0].event_kind = 'action.invoked'
  actionAudit.state.payload.audit[0].entity_kind = 'action'
  actionAudit.state.payload.audit[0].entity_id = action.action_id
  actionAudit.state.payload.audit[0].detail = {
    view_scope: { kind: 'global' },
    invocation_scope: scope,
    target: { connection_ref: connectionRef, resource_type: 'note', external_id: 'N-264' },
    binding: {
      project_id: 'example-project',
      resource_ref: planningSpaceEntity(spaceRef),
      registry_revision: 2,
    },
    decision: {
      permission_id: 'notes.resource',
      adapter_lineage_id: 'lineage-notes',
      connection_ref: connectionRef,
      connection_state: 'registered',
      connection_trust: 'trusted',
      connection_health: 'ready',
      assignment_id: 'assignment-notes',
      assignment_revision: 3,
      grant_id: 'grant-notes',
      grant_revision: 4,
    },
  }
  assert.deepEqual(
    validatePlatformRegistryPayload(actionAudit).state.status === 'ready'
      ? validatePlatformRegistryPayload(actionAudit).state.payload.audit[0].detail
      : null,
    actionAudit.state.payload.audit[0].detail,
  )
  const unsafeAudit = structuredClone(actionAudit)
  ;(unsafeAudit.state.payload.audit[0].detail as Record<string, unknown>).provider_body = {
    token: 'secret',
  }
  assert.throws(() => validatePlatformRegistryPayload(unsafeAudit), /provider_body/)
})

test('planning accepts only sparse exact work-item summaries', () => {
  // A summary is what a directory needs and nothing more. The description is the
  // field that made the Board-era payload grow into a second read model, so the
  // schema refusing it is the whole point of the shape being sparse.
  const workItem = {
    work_item_ref: { space_ref: spaceRef, reference: 'MAIN-264' },
    title: 'Acceptance /context all',
    state_key: 'dev',
    state_category: 'active',
    priority: 'high',
    labels: ['platform'],
    claim_ref: 'codex',
    revision: 4,
    updated_at: '2026-08-13T09:00:00Z',
  }
  const payload = {
    interface_version: 'valkama-planning',
    scope,
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        projects: [
          {
            project_id: 'example-project',
            title: 'Example Project',
            binding_state: 'mapped',
            planning_spaces: [{ space_ref: spaceRef, title: 'Main', work_item_count: 1 }],
          },
        ],
        planning_spaces: [{ space_ref: spaceRef, title: 'Main', work_items: [workItem] }],
      },
    },
  }
  assert.equal(validatePlatformPlanningPayload(payload).state.status, 'ready')
  assert.throws(
    () =>
      validatePlatformPlanningPayload({
        ...payload,
        state: {
          ...payload.state,
          payload: {
            ...payload.state.payload,
            planning_spaces: [
              {
                ...payload.state.payload.planning_spaces[0],
                work_items: [{ ...workItem, description: 'legacy detail' }],
              },
            ],
          },
        },
      }),
    /description.*unknown field/,
  )
})

test('relation mutations require exact Project invocation scope and target identity', () => {
  const resource = { connection_ref: connectionRef, resource_type: 'note', external_id: 'N-264' }
  const command = {
    interface_version: 'valkama-relation-command',
    operation: 'attach',
    entity_ref: entityRef,
    resource_ref: resource,
    invocation_context: {
      view_scope: { kind: 'global' },
      invocation_scope: scope,
      target: resource,
    },
    action_ref: action,
    expected_revision: 4,
    confirmation: true,
    fallback_label: 'N-264',
  }
  assert.equal(validatePlatformRelationCommand(command).operation, 'attach')
  for (const confirmation of [undefined, false, 'true', 1]) {
    const candidate = { ...command } as Record<string, unknown>
    if (confirmation === undefined) delete candidate.confirmation
    else candidate.confirmation = confirmation
    assert.throws(() => validatePlatformRelationCommand(candidate), /confirmation/)
  }
  assert.throws(
    () =>
      validatePlatformRelationCommand({
        ...command,
        invocation_context: { ...command.invocation_context, invocation_scope: { kind: 'global' } },
      }),
    /Project scope/,
  )
})

test('external actions require explicit confirmation bound to the exact Project target', () => {
  const resource = { connection_ref: connectionRef, resource_type: 'note', external_id: 'N-264' }
  const command = {
    interface_version: 'valkama-action-command',
    action_ref: {
      ...action,
      action_id: 'adapter.lineage-notes.open',
      input_schema_id: 'adapter.resource.open',
    },
    invocation_context: {
      view_scope: { kind: 'global' as const },
      invocation_scope: scope,
      target: resource,
    },
    input: { entity_ref: entityRef, resource_ref: resource },
    confirmation: true,
  }
  assert.equal(validatePlatformActionCommand(command).confirmation, true)
  for (const confirmation of [undefined, false, 'true', 1]) {
    const candidate = { ...command } as Record<string, unknown>
    if (confirmation === undefined) delete candidate.confirmation
    else candidate.confirmation = confirmation
    assert.throws(() => validatePlatformActionCommand(candidate), /confirmation/)
  }
})

test('open targets are provider-neutral but reject unsafe browser schemes', () => {
  const result = {
    interface_version: 'valkama-action-result',
    action_ref: action,
    entity_ref: entityRef,
    target: { target_kind: 'external-resource', uri: 'resource-link://entry/N-264' },
    presentation: { label: 'Open resource' },
  }
  assert.equal(validatePlatformActionResult(result).target.uri, 'resource-link://entry/N-264')
  for (const uri of [
    'javascript://alert',
    'data://payload',
    'file://local/path',

    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- see above
    'http://insecure.invalid',
  ]) {
    assert.throws(
      () => validatePlatformActionResult({ ...result, target: { ...result.target, uri } }),
      /unsafe/,
    )
  }
})

/** Which read model a request path is answered with, matched in order. */
const INTERFACE_VERSION_BY_PATH = [
  { fragment: '/context', version: 'valkama-context' },
  { fragment: '/registry', version: 'valkama-registry' },
  { fragment: '/work-item', version: 'valkama-planning-work-item' },
]

test('GET helpers serialize only canonical scope and exact binding parameters', async () => {
  const originalFetch = globalThis.fetch
  const requested: string[] = []
  const attachedSpaceRef = { ...spaceRef, data_scope_id: '123e4567-e89b-42d3-a456-426614174001' }
  globalThis.fetch = (async (input: string | URL | Request) => {
    const pathname = requestUrl(input)
    requested.push(pathname)
    const version =
      INTERFACE_VERSION_BY_PATH.find((entry) => pathname.includes(entry.fragment))?.version ??
      'valkama-planning'
    return new Response(
      JSON.stringify({
        interface_version: version,
        scope,
        ...(pathname.includes('/work-item')
          ? { work_item_ref: { space_ref: spaceRef, reference: 'MAIN-264' } }
          : {}),
        state: { interface_version: 'valkama-ui-state', status: 'empty' },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }) as typeof fetch
  try {
    await platformApi.fetchPlatformContext(scope)
    await platformApi.fetchPlatformRegistry(scope)
    await planningApi.fetchPlatformPlanning(scope, spaceRef)
    await planningApi.fetchPlatformPlanning(scope, attachedSpaceRef)
    await planningApi.fetchPlanningWorkItem(scope, { space_ref: spaceRef, reference: 'MAIN-264' })
    // Two stores may hold a space keyed the same way, so the data scope travels
    // with the key on every read; the reference is sent whole rather than split
    // into a key and a number the server would have to put back together.
    assert.deepEqual(requested, [
      '/api/platform/context?scope_kind=project&project_id=example-project',
      '/api/platform/registry?scope_kind=project&project_id=example-project',
      `/api/platform/planning?scope_kind=project&project_id=example-project&data_scope_id=${spaceRef.data_scope_id}&space_key=MAIN`,
      `/api/platform/planning?scope_kind=project&project_id=example-project&data_scope_id=${attachedSpaceRef.data_scope_id}&space_key=MAIN`,
      `/api/modules/planning/work-item?scope_kind=project&project_id=example-project&data_scope_id=${spaceRef.data_scope_id}&space_key=MAIN&reference=MAIN-264`,
    ])
    await assert.rejects(
      () =>
        planningApi.fetchPlanningWorkItem(
          { kind: 'global' },
          { space_ref: spaceRef, reference: 'MAIN-264' },
        ),
      /Project scope/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Project planning rejects implicit binding and response envelopes must echo exact scope', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        interface_version: 'valkama-context',
        scope: { kind: 'global' },
        state: { interface_version: 'valkama-ui-state', status: 'empty' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch
  try {
    await assert.rejects(() => planningApi.fetchPlatformPlanning(scope), /exact space binding/)
    await assert.rejects(() => platformApi.fetchPlatformContext(scope), /scope does not match/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a class instance is not a wire payload, however well its shape matches', () => {
  class Envelope {
    interface_version = 'valkama-context'
    scope = { kind: 'global' as const }
    state = { interface_version: 'valkama-ui-state', status: 'loading' as const }
  }
  assert.throws(() => validatePlatformContextPayload(new Envelope()), /expected plain object/)
  const plain = JSON.parse(JSON.stringify(new Envelope()))
  assert.equal(validatePlatformContextPayload(plain).interface_version, 'valkama-context')
})

test('an absent key is a missing field, and a present one is judged on its own terms', () => {
  const missingPrefs = { interface_version: 'valkama-ui-prefs' }
  assert.throws(() => validatePlatformUiPrefsResult(missingPrefs), /prefs: missing field/)
  const wrongType = { interface_version: 'valkama-ui-prefs', prefs: 'not an object' }
  assert.throws(() => validatePlatformUiPrefsResult(wrongType), /prefs: expected plain object/)
})
