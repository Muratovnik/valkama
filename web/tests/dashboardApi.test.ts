import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { afterEach, test, vi } from 'vitest'

import {
  fetchAnalyticsPortfolio,
  fetchSpaceAnalytics,
} from '@/entities/analytics/api/analyticsApi.ts'
import {
  validateAnalyticsPortfolio,
  validateDashboardPayload,
} from '@/entities/analytics/utils/dashboardContract.ts'

import { analyticsPayload, portfolioPayload } from './browser/analyticsFixtures.ts'

const source = readFileSync(new URL('../src/shared/api/api.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/app/App.vue', import.meta.url), 'utf8')

afterEach(() => vi.unstubAllGlobals())

test('the standalone dashboard renderer keeps its bounded payload marker', () => {
  assert.throws(() => validateDashboardPayload({ interface_version: 'wrong' }))
  assert.throws(() => validateDashboardPayload({ interface_version: 'dashboard' }))
  assert.doesNotThrow(() => validateDashboardPayload(analyticsPayload))
})

test('analytics wire contracts reject unknown and missing nested fields', () => {
  assert.throws(() =>
    validateDashboardPayload({
      ...analyticsPayload,
      kpis: { ...analyticsPayload.kpis, made_up_zero: 0 },
    }),
  )
  const withoutCoverage = structuredClone(analyticsPayload)
  Reflect.deleteProperty(withoutCoverage, 'history_coverage')
  assert.throws(() => validateDashboardPayload(withoutCoverage))

  const withoutUnknownFlow = structuredClone(analyticsPayload)
  Reflect.deleteProperty(withoutUnknownFlow.flow, 'unknown')
  assert.throws(() => validateDashboardPayload(withoutUnknownFlow))

  const withoutDeclaredFlow = structuredClone(analyticsPayload)
  const [firstState] = withoutDeclaredFlow.states
  assert.ok(firstState)
  Reflect.deleteProperty(withoutDeclaredFlow.flow, firstState.key)
  assert.throws(() => validateDashboardPayload(withoutDeclaredFlow))

  const withInventedFlow = structuredClone(analyticsPayload)
  withInventedFlow.flow.made_up = 0
  assert.throws(() => validateDashboardPayload(withInventedFlow))

  const withTextLane = structuredClone(analyticsPayload) as unknown as {
    flow: Record<string, unknown>
  }
  withTextLane.flow.dev = '1'
  assert.throws(() => validateDashboardPayload(withTextLane))

  const withCancelledLane = structuredClone(analyticsPayload)
  withCancelledLane.states.push({ key: 'cancelled', category: 'cancelled' })
  withCancelledLane.flow.cancelled = 0
  assert.doesNotThrow(() => validateDashboardPayload(withCancelledLane))

  const staleClaimAlias = structuredClone(analyticsPayload) as unknown as {
    work_items: Array<Record<string, unknown>>
  }
  const [firstWorkItem] = staleClaimAlias.work_items
  assert.ok(firstWorkItem)
  firstWorkItem.claimed_by = firstWorkItem.claim_ref
  Reflect.deleteProperty(firstWorkItem, 'claim_ref')
  assert.throws(() => validateDashboardPayload(staleClaimAlias))

  assert.doesNotThrow(() => validateAnalyticsPortfolio(portfolioPayload))
  assert.throws(() =>
    validateAnalyticsPortfolio({
      ...portfolioPayload,
      projects: [{ ...portfolioPayload.projects[0], alias: 'wrong space' }],
    }),
  )
})

test('analytics reads return typed failures without exposing response prose', async () => {
  const json = vi.fn()
  const text = vi.fn(() => Promise.resolve('private backend prose'))
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status: 500, json, text })),
  )

  await assert.rejects(() => fetchSpaceAnalytics('MAIN'), {
    code: 'request_failed',
    retryable: true,
    status: 500,
  })
  assert.equal(json.mock.calls.length, 0)
  assert.equal(text.mock.calls.length, 0)
})

test('the portfolio client validates the whole response before returning it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...portfolioPayload, leaked_alias: 'portfolio' }),
      }),
    ),
  )

  await assert.rejects(
    () => fetchAnalyticsPortfolio(),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as Error & { code: string }).code === 'dashboard_contract_invalid',
  )
})

test('the dashboard read is owned by the Analytics module and uses one exact board', () => {
  assert.doesNotMatch(source, /export function (?:fetchDashboard|subscribeDashboard)/)
  assert.doesNotMatch(source, /\/api\/dashboard|view:\s*['"]dashboard['"]/u)
  assert.doesNotMatch(
    app,
    /fetchDashboard|subscribeDashboard|exactProjectBoardName|\/api\/dashboard/u,
  )
  // The module stage is what mounts a module's screen; the shell mounts the stage.
  assert.match(
    readFileSync(new URL('../src/app/components/AppModuleStage.vue', import.meta.url), 'utf8'),
    /AnalyticsView/,
  )
  const analyticsApi = readFileSync(
    new URL('../src/entities/analytics/api/analyticsApi.ts', import.meta.url),
    'utf8',
  )
  const analyticsView = readFileSync(
    new URL('../src/pages/analytics/AnalyticsView.vue', import.meta.url),
    'utf8',
  )
  assert.match(analyticsApi, /\/api\/dashboard/)
  assert.match(analyticsApi, /validateDashboardPayload/)
  assert.match(analyticsView, /spaceEligible/)
  assert.match(analyticsView, /primaryWriteScopeId === spaceRef\.value\.data_scope_id/)
})
