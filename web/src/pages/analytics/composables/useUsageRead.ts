/**
 * The reads behind the Analytics page: the period by the chosen dimension beside the period it
 * is compared with, the period by account, and the values each filter can offer, every one of
 * them within the scope's project.
 *
 * A new view asks again and drops the answer to the one it replaced, so a slow read never
 * draws over a later one. While it asks, the last answer stays on screen as a refresh in flight
 * rather than blanking into a wait, and the page says a new view is being read (`anew`); only the
 * first read waits with nothing to show. A refresh of the view on show replaces its answer once
 * what is drawn with it is in hand too — its accounts and, on the overview, the steps of its
 * period before — so nothing the page draws blanks, flashes or moves between the two.
 *
 * A refresh that fails leaves what is on show as it stood, an empty period too, and says so
 * (`refreshFailed`) until an answer replaces it; the next refresh — the bar's, its retry or the
 * live period's own — asks again. A new view whose read fails says it failed: the last view's
 * answer is not its own.
 *
 * Every read goes through the page's shared reads (`useSharedUsage`), as of the moment they keep
 * for the view: another section asks only what no other part of the page has asked already.
 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { beforeStepsQuery } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { providePanelStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import type { SharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { periodBounds, stepOf } from '@/pages/analytics/utils/analyticsPeriod.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { comparedBounds, comparedPeriod } from '@/pages/analytics/utils/comparedPeriod.ts'

import { breakdownOf, OVERVIEW } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
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
 * Whether there is nothing to show: this period and the one it is compared with were both read,
 * and neither spent anything. A period before that did spend is a fall to nothing, which the
 * figures say; one that was not read leaves this period's figures to show, with words that say
 * the comparison is missing.
 */
const nothingToShow = (usage: Usage) =>
  spentNothing(usage.total) && usage.comparison !== null && spentNothing(usage.comparison.total)

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

/**
 * What an answer on show answers: what was asked (`asked`), the period it was read for and the
 * moment as of which, the filters it was read with and the period its figures are compared with.
 */
interface ShownAnswer {
  at: Date
  compared: PeriodBounds | null
  filters: UsageFilters
  key: string
  period: PeriodBounds
}

/** Where an answer is shown and the read it belongs to, which a later read stops. */
interface ShowingWith {
  overview: boolean
  signal: AbortSignal
}

/** A read that may fail without failing the page: its answer, or null. */
const orNull = <T>(reading: Promise<T>) => reading.catch(() => null)

/**
 * The answer beside the period it is compared with when that was read on its own
 * (`comparedPeriod`): that read's period, total and rows, or none when it could not be read.
 * Undefined `before` leaves the answer as the read compared it. Every read the page shows asks
 * for a comparison, so an answer here with no comparison is one whose period before was not read.
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
  shared: SharedUsage
  /** The project the page is scoped to, which every read is filtered to; null at the top. */
  projectId: () => string | null
  view: () => AnalyticsView
}) {
  const { now, read: ask } = options.shared
  const state = shallowRef<PlatformUiState<Usage>>(uiLoading())
  /** The period the shown answer was read for; null while a custom period is unfinished. */
  const bounds = shallowRef<PeriodBounds | null>(null)
  /** The moment the shown answer was asked at, which says which day is not over yet. */
  const askedAt = shallowRef<Date>(now())
  const filterValues = ref<Partial<Record<UsageDimension, FilterValues>>>({})
  const accounts = shallowRef<AccountsRead>('loading')
  /** The filters the shown answer was read with, its scope's project among them. */
  const readWith = shallowRef<UsageFilters>({})
  /**
   * The period the shown answer's figures are compared with (`comparedBounds`), for whatever else
   * stands for the period before; null when it was not read.
   */
  const comparedWith = shallowRef<PeriodBounds | null>(null)
  /** Whether a new view is read while the last view's answer stays on show. */
  const anew = shallowRef(false)
  /** Whether the last refresh of the view on show failed, what it showed kept on show. */
  const refreshFailed = shallowRef(false)
  providePanelStanding({ anew, failed: refreshFailed })

  /** The scope's own filter: its project, or nothing at the top. */
  const scope = computed<UsageFilters>(() => {
    const project = options.projectId()
    return project ? { project: [project] } : {}
  })

  /** The filters the reads carry: the page's, and the scope's project over its own. */
  const filters = computed<UsageFilters>(() => ({ ...options.view().filters, ...scope.value }))

  /**
   * What a view asks; the moment of a preset is taken when it is asked, not here. The overview is
   * read as the breakdown it borrows, so moving between the two asks nothing again.
   */
  const asked = computed(() => {
    const view = options.view()
    const { period, from, to } = view
    return JSON.stringify({ period, from, to, by: breakdownOf(view), filters: filters.value })
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
  /**
   * What the answer on show was asked for (`asked`), an empty period's too; a read of the same is
   * a refresh of it. Null while no answer read stands on show.
   */
  let shownFor: string | null = null

  function query(at: PeriodBounds, groupBy: UsageDimension[], compare: boolean): UsageQuery {
    return { ...at, groupBy, filters: filters.value, compare, step: stepOf(options.view()) }
  }

  /**
   * What stays on show if a read of `key` fails, when that read is a refresh of what is on show —
   * an answer or an empty period read for the same view: what is on show, settled. Null for a
   * new view.
   */
  function keptFor(shown: PlatformUiState<Usage>, key: string): PlatformUiState<Usage> | null {
    if (shownFor !== key) return null
    if ('payload' in shown) return ready(shown.payload)
    return shown.status === 'empty' ? shown : null
  }

  /**
   * What stands while a read is under way: the last answer, as a refresh in flight, and for a new
   * view said to be the last view's (`anew`); the empty period a refresh reads again; else a wait.
   */
  function standWhileRead(shown: PlatformUiState<Usage>, refresh: boolean) {
    const drawn = 'payload' in shown
    anew.value = !refresh && drawn
    if (drawn) state.value = refreshing(shown.payload)
    else if (!refresh) state.value = uiLoading()
  }

  /** A read that failed: a refresh leaves `kept` on show and says it failed; a new view fails. */
  function fail(kept: PlatformUiState<Usage> | null) {
    anew.value = false
    refreshFailed.value = kept !== null
    state.value = kept ?? uiError('analytics.failed')
  }

  /**
   * The view's reads, asked together: the period by its dimension beside the period it is
   * compared with — the server's own preceding period, or the one `comparedPeriod` names, read on
   * its own — and the period by account. The answer is shown when the first two land; the
   * accounts follow it, and the last answer's accounts go with the last answer. A refresh shows
   * its answer with its accounts and, on the overview, with the steps of the period before, which
   * it asks first through the shared reads for the part that draws them to take at once.
   */
  async function read() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const { signal } = controller
    const at = now()
    const view = options.view()
    const period = periodBounds(view, at)
    const shown = state.value
    const key = asked.value
    const kept = period ? keptFor(shown, key) : null
    const refresh = kept !== null
    // A refresh moves the period and its moment with its answer, not ahead of it.
    if (!refresh) {
      bounds.value = period
      askedAt.value = at
      refreshFailed.value = false
    }
    if (!period) {
      shownFor = null
      anew.value = false
      state.value = uiEmpty('analytics.period.choose')
      return
    }
    standWhileRead(shown, refresh)
    const by = breakdownOf(view)
    const askedWith = filters.value
    const before = comparedPeriod(view, at)
    const asking = ask(query(period, [by], !before), signal)
    const askingBefore = before ? orNull(ask(query(before, [by], false), signal)) : null
    const askingAccounts =
      by === 'account' ? null : orNull(ask(query(period, ['account'], false), signal))
    let usage: Usage
    try {
      usage = compared(await asking, askingBefore ? await askingBefore : undefined)
    } catch {
      if (!signal.aborted) fail(kept)
      return
    }
    if (signal.aborted) return
    const answer = {
      at,
      compared: comparedBounds(usage, period, before),
      filters: askedWith,
      key,
      period,
    }
    const showing = refresh ? showRefreshed : showNew
    await showing(usage, askingAccounts, answer, { overview: view.by === OVERVIEW, signal })
  }

  /** Shows `usage` as the answer `answer` names, beside the accounts read with it. */
  function show(usage: Usage, byAccount: AccountsRead, answer: ShownAnswer) {
    accounts.value = byAccount
    readWith.value = answer.filters
    comparedWith.value = answer.compared
    shownFor = answer.key
    bounds.value = answer.period
    askedAt.value = answer.at
    anew.value = false
    refreshFailed.value = false
    state.value = nothingToShow(usage) ? uiEmpty('analytics.empty.title') : ready(usage)
  }

  /** Shows a new view's answer as it lands, and its accounts as they follow it. */
  async function showNew(
    usage: Usage,
    askingAccounts: Promise<Usage | null> | null,
    answer: ShownAnswer,
    { signal }: ShowingWith,
  ) {
    show(usage, askingAccounts ? 'loading' : usage, answer)
    if (!askingAccounts) return
    const byAccount = await askingAccounts
    if (!signal.aborted) accounts.value = byAccount ?? 'failed'
  }

  /**
   * Shows a refreshed answer once what is drawn with it is in hand too: its accounts and, on the
   * overview, the steps of the period before, asked through the shared reads for the part that
   * draws them to take at once.
   */
  async function showRefreshed(
    usage: Usage,
    askingAccounts: Promise<Usage | null> | null,
    answer: ShownAnswer,
    { overview, signal }: ShowingWith,
  ) {
    const byAccount = askingAccounts ? await askingAccounts : usage
    if (overview && answer.compared) {
      const steps = beforeStepsQuery(answer.compared, answer.filters, usage.period.step)
      await orNull(ask(steps, signal))
    }
    if (!signal.aborted) show(usage, byAccount ?? 'failed', answer)
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
          const usage = await ask(
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

  return {
    accounts,
    askedAt,
    bounds,
    comparedWith,
    filterValues,
    offer,
    readWith,
    retry: read,
    state,
  }
}
