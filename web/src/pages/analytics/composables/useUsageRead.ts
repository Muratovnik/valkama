/**
 * The reads behind the Analytics page: the period by the chosen dimension beside the period it
 * is compared with, the period by account, and the values each filter can offer, every one of
 * them within the scope's project.
 *
 * A new view asks again and drops the answer to the one it replaced, so a slow read never
 * draws over a later one. While it asks, the last answer stays on screen as a refresh in flight
 * rather than blanking into a wait; only the first read waits with nothing to show.
 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { periodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { comparedPeriod } from '@/pages/analytics/utils/comparedPeriod.ts'

import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
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
function spentNothing(total: Usage['total']) {
  return (
    total.agent_seconds === 0 &&
    total.estimated_api_cost_usd === null &&
    total.unpriced_tokens === 0 &&
    Object.values(total.tokens).every((count) => count === null)
  )
}

/**
 * Whether there is nothing to show: this period spent nothing, and neither did the one it is
 * compared with. A period before that did spend is a fall to nothing, which the figures say.
 */
const nothingToShow = (usage: Usage) =>
  spentNothing(usage.total) && (!usage.comparison || spentNothing(usage.comparison.total))

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

/**
 * The period by account behind the answer on screen, for where the accounts that worked changed:
 * the answer itself when that is by account, `loading` until its own read lands, `failed` when it
 * could not be read. It belongs to the answer it was read with and goes when that answer does.
 */
export type AccountsRead = Usage | 'failed' | 'loading'

/** A read that may fail without failing the page: its answer, or null. */
const orNull = <T>(reading: Promise<T>) => reading.catch(() => null)

/**
 * The answer beside the period it is compared with when that was read on its own
 * (`comparedPeriod`): that read's period, total and rows, or none when it could not be read.
 * Undefined `before` leaves the answer as the read compared it.
 */
function compared(usage: Usage, before: Usage | null | undefined): Usage {
  if (before === undefined) return usage
  const comparison = before
    ? {
        period: { from: before.period.from, to: before.period.to },
        total: before.total,
        rows: before.rows,
      }
    : null
  return { ...usage, comparison }
}

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
  const accounts = shallowRef<AccountsRead>('loading')

  /** The scope's own filter: its project, or nothing at the top. */
  const scope = computed<UsageFilters>(() => {
    const project = options.projectId()
    return project ? { project: [project] } : {}
  })

  /** The filters the reads carry: the page's, and the scope's project over its own. */
  const filters = computed<UsageFilters>(() => ({ ...options.view().filters, ...scope.value }))

  /** What a view asks; the moment of a preset is taken when it is asked, not here. */
  const asked = computed(() => {
    const { period, from, to, by } = options.view()
    return JSON.stringify({ period, from, to, by, filters: filters.value })
  })

  /**
   * What the values a filter offers depend on: the period as the view names it and the scope.
   * Not the breakdown and not the filters, so changing those asks for no value again.
   */
  const offeredFor = computed(() => {
    const { period, from, to } = options.view()
    return JSON.stringify({ period, from, to, scope: scope.value })
  })

  let reading: AbortController | null = null
  let offering: AbortController | null = null
  let offered = ''

  function query(at: PeriodBounds, groupBy: UsageDimension[], compare: boolean): UsageQuery {
    return { ...at, groupBy, filters: filters.value, compare }
  }

  /**
   * The view's reads, asked together: the period by its dimension beside the period it is
   * compared with — the server's own preceding period, or the one `comparedPeriod` names, read on
   * its own — and the period by account. The answer is shown when the first two land; the
   * accounts follow it, and the last answer's accounts go with the last answer.
   */
  async function read() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const { signal } = controller
    const at = now()
    const view = options.view()
    const period = periodBounds(view, at)
    bounds.value = period
    askedAt.value = at
    if (!period) {
      state.value = uiEmpty('analytics.period.choose')
      return
    }
    const shown = state.value
    state.value = 'payload' in shown ? refreshing(shown.payload) : uiLoading()
    const { by } = view
    const before = comparedPeriod(view, at)
    const asking = fetchUsage(query(period, [by], !before), signal)
    const askingBefore = before ? orNull(fetchUsage(query(before, [by], false), signal)) : null
    const askingAccounts =
      by === 'account' ? null : orNull(fetchUsage(query(period, ['account'], false), signal))
    let usage: Usage
    try {
      usage = compared(await asking, askingBefore ? await askingBefore : undefined)
    } catch {
      if (!signal.aborted) state.value = uiError('analytics.failed')
      return
    }
    if (signal.aborted) return
    accounts.value = askingAccounts ? 'loading' : usage
    state.value = nothingToShow(usage) ? uiEmpty('analytics.empty.title') : ready(usage)
    if (!askingAccounts) return
    const byAccount = await askingAccounts
    if (!signal.aborted) accounts.value = byAccount ?? 'failed'
  }

  /**
   * What each filter can offer, read for the dimensions asked and not yet read, or whose read
   * failed: the whole period within the scope, without the page's filters, so a value chosen does
   * not take its neighbours away. A new period or scope drops what was offered for the last one.
   */
  async function offer(dimensions: readonly UsageDimension[]) {
    if (offered !== offeredFor.value) {
      offering?.abort()
      offering = null
      filterValues.value = {}
      offered = offeredFor.value
    }
    const period = bounds.value
    const missing = dimensions.filter((dimension) => {
      const held = filterValues.value[dimension]
      return !held || held === 'failed'
    })
    if (!period || !missing.length) return
    offering ??= new AbortController()
    const { signal } = offering
    for (const dimension of missing) filterValues.value[dimension] = 'loading'
    await Promise.all(
      missing.map(async (dimension) => {
        try {
          const usage = await fetchUsage(
            { ...period, groupBy: [dimension], filters: scope.value, compare: false },
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
