import assert from 'node:assert/strict'

import { test } from 'vitest'

import * as platformApi from '@/shared/api/platformApi.ts'
import {
  validatePlatformContextPayload,
  validatePlatformUiPrefsResult,
} from '@/shared/api/platformContextPayload.ts'
import * as planningApi from '@/shared/api/platformPlanningApi.ts'
import { validatePlatformPlanningPayload } from '@/shared/api/platformPlanningPayload.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'

import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

const scope = { kind: 'project' as const, project_ref: { project_id: 'example-project' } }
const spaceRef = {
  data_scope_id: '123e4567-e89b-42d3-a456-426614174000',
  space_key: 'MAIN',
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

/** Which read model a request path is answered with, matched in order. */
const INTERFACE_VERSION_BY_PATH = [
  { fragment: '/context', version: 'valkama-context' },
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
    await planningApi.fetchPlatformPlanning(scope, spaceRef)
    await planningApi.fetchPlatformPlanning(scope, attachedSpaceRef)
    await planningApi.fetchPlanningWorkItem(scope, { space_ref: spaceRef, reference: 'MAIN-264' })
    // Two stores may hold a space keyed the same way, so the data scope travels
    // with the key on every read; the reference is sent whole rather than split
    // into a key and a number the server would have to put back together.
    assert.deepEqual(requested, [
      '/api/platform/context?scope_kind=project&project_id=example-project',
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
