import { afterEach, expect, test, vi } from 'vitest'

import { fetchSessionContext, resolveRef } from '@/shared/api/api.ts'
import { fetchExecutionUsage } from '@/shared/api/executionApi.ts'
import { inWorkQueue, validateReadModel } from '@/shared/api/planningModel.ts'
import { fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import {
  parsePlatformRoute,
  recoverWorkRoute,
  serializePlatformRoute,
} from '@/shared/api/platformRoute.ts'

import { executionUsage } from './browser/executionFixtures.ts'
import { dataScopeId, spaceRef } from './browser/planningFixtures.ts'
import { planningReadFor } from './browser/planningReadFixture.ts'
afterEach(() => vi.unstubAllGlobals())
test('retired deep routes recover into Work in the same operating scope', () => {
  const scope = { kind: 'project' as const, project_ref: { project_id: 'sample' } }
  for (const module_id of ['sessions', 'analytics', 'improvements', 'skills', 'memory']) {
    const old = parsePlatformRoute(
      serializePlatformRoute({ module_id, scope, state: { query: 'old' } }),
    )
    expect(recoverWorkRoute(old)).toEqual({ module_id: 'planning', scope })
  }
  const unknown = { module_id: 'future', scope }
  expect(recoverWorkRoute(unknown)).toBe(unknown)
  expect(() => parsePlatformRoute('/modules/skills/global?unknown=x')).toThrow()
})
test('queue slices use ready, claim, and workflow category facts independently', () => {
  const item = validateReadModel(
    planningReadFor(
      new URLSearchParams({
        project: 'example-project',
        data_scope_id: dataScopeId,
        space_key: spaceRef.space_key,
      }),
    ).body,
  ).work_items[0]
  expect(item).toBeDefined()
  expect(inWorkQueue({ ...item, ready: true }, 'ready')).toBe(true)
  expect(inWorkQueue({ ...item, ready: false }, 'ready')).toBe(false)
  expect(
    inWorkQueue(
      { ...item, claim_ref: 'owner', state: { ...item.state, is_terminal: false } },
      'assigned',
    ),
  ).toBe(true)
  expect(
    inWorkQueue(
      { ...item, claim_ref: 'owner', state: { ...item.state, is_terminal: true } },
      'assigned',
    ),
  ).toBe(false)
  expect(
    inWorkQueue(
      { ...item, state: { ...item.state, key: 'renamed', category: 'blocked' } },
      'blocked',
    ),
  ).toBe(true)
  expect(
    inWorkQueue(
      { ...item, state: { ...item.state, key: 'renamed', category: 'review' } },
      'review',
    ),
  ).toBe(true)
  expect(inWorkQueue(item, 'all')).toBe(true)
})
test('exact-session context and retained refs do not request a session fleet or event feed', async () => {
  const payload = {
    kind: 'session',
    value: 'exact id',
    resolved: false,
    detail: 'Missing exact session',
  }
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload)))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchSessionContext('exact id')).toEqual(payload)
  expect(await resolveRef('session', 'exact id')).toEqual(payload)
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([
    '/api/session?id=exact%20id',
    '/api/ref?kind=session&value=exact%20id',
  ])
})
test('the retained execution usage client still validates the Planning-owned wire', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(executionUsage)))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchExecutionUsage('attempt 1')).toEqual(executionUsage.usage)
  expect(fetch).toHaveBeenCalledWith('/api/execution/usage?execution_id=attempt%201', undefined)
})

test('the global Work portfolio requests the bounded project directory without full space items', async () => {
  const payload = {
    interface_version: 'valkama-planning',
    scope: { kind: 'global' },
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        projects: [
          {
            project_id: 'sample',
            title: 'Sample',
            binding_state: 'mapped',
            planning_spaces: [{ space_ref: spaceRef, title: 'Main', work_item_count: 1966 }],
          },
        ],
        planning_spaces: [],
      },
    },
  }
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload)))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchPlatformPlanning({ kind: 'global' })).toEqual(payload)
  expect(fetch).toHaveBeenCalledWith(
    '/api/platform/planning?scope_kind=global&directory_only=true',
    undefined,
  )
})
