/** Analytics read model client, owned by the Analytics module. */

import {
  validateAnalyticsPortfolio,
  validateDashboardPayload,
} from '@/entities/analytics/utils/dashboardContract.ts'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { responseFailure } from '@/shared/api/typedFailure.ts'
import type { DashboardFilters, DashboardPayload } from '@/shared/types/analytics.ts'

export type AnalyticsFilterInput = Partial<DashboardFilters>

const FILTER_KEYS = [
  'epic',
  'client',
  'agent',
  'environment',
  'tool',
  'status',
  'date_from',
  'date_to',
  'as_of',
] as const satisfies readonly (keyof DashboardFilters)[]

/** One stable spelling and order for dashboard reads, retries, and exports. */
export function serializeAnalyticsFilters(filters: AnalyticsFilterInput = {}): URLSearchParams {
  const query = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value))
  }
  return query
}

function dashboardQuery(space: string, filters: AnalyticsFilterInput): URLSearchParams {
  const query = new URLSearchParams({ space })
  for (const [key, value] of serializeAnalyticsFilters(filters)) query.set(key, value)
  return query
}

export async function fetchSpaceAnalytics(
  space: string,
  filters: AnalyticsFilterInput = {},
): Promise<DashboardPayload> {
  const query = dashboardQuery(space, filters)
  const response = await fetch(`/api/dashboard?${query.toString()}`)
  if (!response.ok) throw responseFailure(response)
  return validateDashboardPayload(await response.json())
}

/** Export the exact committed dashboard selection, without a second filter vocabulary. */
export function dashboardExportHref(
  payload: Pick<DashboardPayload, 'filters' | 'planning_space'>,
  format: 'csv' | 'json',
): string {
  const query = new URLSearchParams({ space: payload.planning_space, format })
  for (const [key, value] of serializeAnalyticsFilters(payload.filters)) query.set(key, value)
  return `/api/dashboard/export?${query.toString()}`
}

/** A portfolio row opens the exact primary-store planning space it summarized. */
export function spaceAnalyticsHref(
  projectId: string,
  dataScopeId: string,
  spaceKey: string,
): string {
  return serializePlatformRoute({
    module_id: 'analytics',
    scope: { kind: 'project', project_ref: { project_id: projectId } },
    entity: planningSpaceEntity({ data_scope_id: dataScopeId, space_key: spaceKey }),
  })
}
/**
 * Several projects in one reading.
 *
 * A read of its own rather than N dashboard requests the browser adds up: the
 * combining rule is coverage, and coverage recomputed in a second place is a
 * second answer. What arrives is already combined, and already says what it
 * would not combine.
 */
export interface AnalyticsPortfolioProject {
  /** The backends that answered here, which is what a mixed portfolio needs. */
  adapters: string[]
  attempts: number
  blocked: number
  completed: number
  cycle_observed: number
  cycle_seconds: number | null
  delivered: number
  ended: number
  inventory: number
  observed_attempts: number
  project_id: string
  space_key: string
  space_name: string
  /**
   * Lane counts, kept per project and never summed: two spaces may declare
   * different lanes, and a column meaning `review` in one and nothing in the
   * other is a column nobody can read.
   */
  states: Array<{ items: number; key: string }>
  tokens: number | null
  tokens_coverage: AggregateCoverage
  wall_coverage: AggregateCoverage
  wall_observed: number
  wall_seconds: number | null
}

export interface AnalyticsPortfolio {
  interface_version: 'dashboard-portfolio'
  projects: AnalyticsPortfolioProject[]
  totals: {
    adapters: string[]
    attempts: number
    blocked: number
    completed: number
    cycle_observed: number
    cycle_seconds: number | null
    delivered: number
    ended: number
    inventory: number
    projects: number
    tokens: number | null
    tokens_coverage: AggregateCoverage
    wall_coverage: AggregateCoverage
    wall_seconds: number | null
  }
  truncated: boolean
}

type AggregateCoverage = 'confirmed' | 'partial' | 'unknown'

export async function fetchAnalyticsPortfolio(): Promise<AnalyticsPortfolio> {
  const response = await fetch('/api/dashboard/portfolio')
  if (!response.ok) throw responseFailure(response)
  return validateAnalyticsPortfolio(await response.json())
}
