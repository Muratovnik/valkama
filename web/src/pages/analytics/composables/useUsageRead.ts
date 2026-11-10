/**
 * The reads behind the Analytics page: the period by the chosen dimension beside the period
 * before it, and the values each filter can offer.
 *
 * A new view asks again and drops the answer to the one it replaced, so a slow read never
 * draws over a later one. While it asks, the last answer stays on screen as a refresh in flight
 * rather than blanking into a wait; only the first read waits with nothing to show.
 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { periodBounds } from '@/pages/analytics/utils/analyticsAddress.ts'
import type { AnalyticsView, PeriodBounds } from '@/pages/analytics/utils/analyticsAddress.ts'

import { fetchUsage, USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type {
  Usage,
  UsageDimension,
  UsageFilters,
  UsageQuery,
  UsageRow,
} from '@/shared/api/analyticsApi.ts'
import { uiEmpty, uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

/** Whether a period spent anything at all: no time, no token and no price is nothing. */
function spentNothing(usage: Usage) {
  const { total } = usage
  return (
    total.agent_seconds === 0 &&
    total.estimated_api_cost_usd === null &&
    total.unpriced_tokens === 0 &&
    Object.values(total.tokens).every((count) => count === null)
  )
}

const ready = (payload: Usage): PlatformUiState<Usage> => ({
  interface_version: 'valkama-ui-state',
  status: 'ready',
  payload,
})

/** The last answer kept on screen while the next is read: a refresh in flight, no reason. */
const refreshing = (payload: Usage): PlatformUiState<Usage> => ({
  interface_version: 'valkama-ui-state',
  status: 'degraded',
  payload,
  stale: true,
  observed_at: new Date().toISOString(),
})

/** What a filter offers for one dimension: the values that spent anything in the period. */
export type FilterValues = UsageRow[] | 'loading' | 'failed'

export function useUsageRead(options: {
  now?: () => Date
  /** The project the page is scoped to, which every read is filtered to; null at the top. */
  projectId: () => string | null
  view: () => AnalyticsView
}) {
  const now = options.now ?? (() => new Date())
  const state = shallowRef<PlatformUiState<Usage>>(uiLoading())
  /** The period the shown answer was read for; null while a custom period is unfinished. */
  const bounds = shallowRef<PeriodBounds | null>(null)
  /** The moment the shown answer was asked at, which says which day is not over yet. */
  const askedAt = shallowRef<Date>(now())
  const filterValues = ref<Partial<Record<UsageDimension, FilterValues>>>({})
  /**
   * The period by account, for where the accounts that worked changed; the page's own answer
   * when that is already by account. Null until read, or when it could not be.
   */
  const accounts = shallowRef<Usage | null>(null)

  /** The filters the reads carry: the page's, and the scope's project over its own. */
  const filters = computed<UsageFilters>(() => {
    const project = options.projectId()
    const chosen = options.view().filters
    return project ? { ...chosen, project: [project] } : chosen
  })

  /** What a view asks; the moment of a preset is taken when it is asked, not here. */
  const asked = computed(() => {
    const { period, from, to, by } = options.view()
    return JSON.stringify({ period, from, to, by, filters: filters.value })
  })

  let reading: AbortController | null = null
  let offering: AbortController | null = null

  function query(at: PeriodBounds, groupBy: UsageDimension[], compare: boolean): UsageQuery {
    return { ...at, groupBy, filters: filters.value, compare }
  }

  async function read() {
    reading?.abort()
    offering?.abort()
    offering = null
    filterValues.value = {}
    const at = now()
    const period = periodBounds(options.view(), at)
    bounds.value = period
    askedAt.value = at
    if (!period) {
      state.value = uiEmpty('analytics.period.choose')
      return
    }
    const controller = new AbortController()
    reading = controller
    const shown = state.value
    state.value = 'payload' in shown ? refreshing(shown.payload) : uiLoading()
    const { by } = options.view()
    const asking = fetchUsage(query(period, [by], true), controller.signal)
    if (by !== 'account') void readAccounts(period, controller.signal)
    try {
      const usage = await asking
      if (controller.signal.aborted) return
      if (by === 'account') accounts.value = usage
      state.value = spentNothing(usage) ? uiEmpty('analytics.empty.title') : ready(usage)
    } catch {
      if (!controller.signal.aborted) state.value = uiError('analytics.failed')
    }
  }

  /** The accounts behind each day; without them the days are drawn with no account marks. */
  async function readAccounts(period: PeriodBounds, signal: AbortSignal) {
    try {
      const usage = await fetchUsage(query(period, ['account'], false), signal)
      if (!signal.aborted) accounts.value = usage
    } catch {
      if (!signal.aborted) accounts.value = null
    }
  }

  /**
   * What each filter can offer, read for the dimensions asked and not yet read: the whole
   * period, without the page's filters, so a value chosen does not take its neighbours away.
   */
  async function offer(dimensions: readonly UsageDimension[]) {
    const period = bounds.value
    const missing = dimensions.filter((dimension) => !filterValues.value[dimension])
    if (!period || !missing.length) return
    offering ??= new AbortController()
    const { signal } = offering
    for (const dimension of missing) filterValues.value[dimension] = 'loading'
    await Promise.all(
      missing.map(async (dimension) => {
        try {
          const usage = await fetchUsage(
            { ...period, groupBy: [dimension], filters: {}, compare: false },
            signal,
          )
          if (!signal.aborted) filterValues.value[dimension] = usage.rows
        } catch {
          if (!signal.aborted) filterValues.value[dimension] = 'failed'
        }
      }),
    )
  }

  /** The dimensions a filter is set on, whose values have to be named on the page. */
  const filtered = computed(() =>
    USAGE_DIMENSIONS.filter((dimension) => options.view().filters[dimension]?.length),
  )

  watch(asked, () => void read().then(() => offer(filtered.value)), { immediate: true })
  onScopeDispose(() => {
    reading?.abort()
    offering?.abort()
  })

  return { accounts, askedAt, bounds, filterValues, offer, retry: read, state }
}
