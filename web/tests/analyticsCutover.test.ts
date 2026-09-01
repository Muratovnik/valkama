import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  dashboardExportHref,
  serializeAnalyticsFilters,
  spaceAnalyticsHref,
} from '@/entities/analytics/api/analyticsApi.ts'

import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'

import { analyticsPayload } from './browser/analyticsFixtures.ts'
import { dataScopeId, projectId, spaceRef } from './browser/planningFixtures.ts'

test('analytics requests and exports share the committed canonical scope', () => {
  const payload = {
    ...analyticsPayload,
    as_of: '2026-08-24T12:00:00Z',
    filters: {
      ...analyticsPayload.filters,
      as_of: '2026-08-24T12:00:00Z',
      date_from: '2026-08-01T00:00:00Z',
      client: 'codex',
    },
  }
  const query = serializeAnalyticsFilters(payload.filters)
  assert.equal(query.get('date_from'), '2026-08-01T00:00:00Z')
  assert.equal(query.get('client'), 'codex')
  assert.equal(query.get('as_of'), '2026-08-24T12:00:00Z')
  assert.equal(query.has('from'), false)
  assert.equal(
    query.toString(),
    'client=codex&date_from=2026-08-01T00%3A00%3A00Z&as_of=2026-08-24T12%3A00%3A00Z',
  )
  assert.equal(
    dashboardExportHref(payload, 'json'),
    `/api/dashboard/export?space=MAIN&format=json&${query.toString()}`,
  )
})

test('portfolio navigation carries the exact planning-space identity', () => {
  const href = spaceAnalyticsHref(projectId, dataScopeId, spaceRef.space_key)
  const route = parsePlatformRoute(href)
  assert.equal(route.module_id, 'analytics')
  assert.deepEqual(route.scope, { kind: 'project', project_ref: { project_id: projectId } })
  assert.deepEqual(planningSpaceRef(route.entity), spaceRef)
})
