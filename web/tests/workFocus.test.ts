import { afterEach, expect, test, vi } from 'vitest'

import { matchesWorkFilter } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { fetchSessionContext, resolveRef } from '@/shared/api/api.ts'
import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import { fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import {
  parsePlatformRoute,
  recoverWorkRoute,
  serializePlatformRoute,
} from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

import { dataScopeId, planningReadModel, spaceRef } from './browser/planningFixtures.ts'
import { planningReadFor } from './browser/planningReadFixture.ts'
const READY: WorkFilter = { text: '', ready: true }
const HELD: WorkFilter = { text: '', held: true }
const REVIEW: WorkFilter = { text: '', category: ['review'] }

afterEach(() => vi.unstubAllGlobals())
test('retired deep routes recover into Work in the same operating scope', () => {
  const scope = { kind: 'project' as const, project_ref: { project_id: 'sample' } }
  for (const module_id of ['sessions', 'analytics', 'improvements', 'skills', 'memory']) {
    const old = parsePlatformRoute(
      serializePlatformRoute({ module_id, scope, state: { query: 'old' } }),
    )
    expect(recoverWorkRoute(old)).toEqual({ module_id: 'planning', scope })
  }
  const unknown: PlatformRoute = { module_id: 'future', scope }
  expect(recoverWorkRoute(unknown)).toBe(unknown)
  expect(() => parsePlatformRoute('/modules/skills/global?unknown=x')).toThrow()
})
test('the filter reads readiness, the claim and the workflow category as separate facts', () => {
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
  expect(matchesWorkFilter({ ...item, ready: true }, READY)).toBe(true)
  expect(matchesWorkFilter({ ...item, ready: false }, READY)).toBe(false)
  expect(
    matchesWorkFilter(
      { ...item, claim_ref: 'owner', state: { ...item.state, is_terminal: false } },
      HELD,
    ),
  ).toBe(true)
  expect(
    matchesWorkFilter(
      { ...item, claim_ref: 'owner', state: { ...item.state, is_terminal: true } },
      HELD,
    ),
  ).toBe(false)
  expect(
    matchesWorkFilter(
      { ...item, state: { ...item.state, key: 'renamed', category: 'blocked' } },
      { text: '', category: ['blocked'] },
    ),
  ).toBe(true)
  expect(
    matchesWorkFilter(
      { ...item, state: { ...item.state, key: 'renamed', category: 'review' } },
      REVIEW,
    ),
  ).toBe(true)
  expect(matchesWorkFilter(item, { text: '' })).toBe(true)
})

test('the Planning model retains review work beyond 2,000 items', () => {
  const model = structuredClone(planningReadModel) as PlanningReadModel
  const baseItem = model.work_items[0]
  if (!baseItem) throw new Error('Planning fixture needs a work item')

  const reviewState: PlanningReadModel['work_items'][number]['state'] = {
    state_id: '00000000-0000-4000-8000-000000000903',
    key: 'review',
    name: 'Review',
    category: 'review',
    is_terminal: false,
  }
  const workflow = model.workflow
  if (!workflow) throw new Error('Planning fixture needs a workflow')
  model.workflow = {
    ...workflow,
    states: [...workflow.states, { ...reviewState, position: workflow.states.length }],
  }
  model.work_items = Array.from({ length: 2001 }, (_, index) => {
    const number = index + 1
    const identity = 5000 + number
    return {
      ...baseItem,
      work_item_id: `00000000-0000-4000-8000-${String(identity).padStart(12, '0')}`,
      reference: `MAIN-${number}`,
      number,
      state: index === 2000 ? reviewState : baseItem.state,
    }
  })
  model.links = []
  model.stale_claims = []

  const space = model.planning_spaces[0]
  if (!space) throw new Error('Planning fixture needs a space summary')
  space.work_items = 2001
  space.open = 2001
  space.active = 2000

  const validated = validateReadModel(model)
  expect(validated.work_items).toHaveLength(2001)
  expect(
    validated.work_items
      .filter((item) => matchesWorkFilter(item, REVIEW))
      .map((item) => item.reference),
  ).toEqual(['MAIN-2001'])
})

test('exact-session context and retained refs do not request a session fleet or event feed', async () => {
  const payload = {
    kind: 'session',
    value: 'exact id',
    resolved: false,
    detail: 'Missing exact session',
  }
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(payload)))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchSessionContext('exact id')).toEqual(payload)
  expect(await resolveRef('session', 'exact id')).toEqual(payload)
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([
    '/api/session?id=exact%20id',
    '/api/ref?kind=session&value=exact%20id',
  ])
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
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(payload)))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchPlatformPlanning({ kind: 'global' })).toEqual(payload)
  expect(fetch).toHaveBeenCalledWith(
    '/api/platform/planning?scope_kind=global&directory_only=true',
    { signal: expect.any(AbortSignal) },
  )
})
