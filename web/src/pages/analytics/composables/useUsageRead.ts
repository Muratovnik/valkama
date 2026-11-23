/**
 * The reads behind the Analytics page: the period by the chosen dimension beside the period it
 * is compared with, the period by account, and the values each filter can offer, every one of
 * them within the scope: its space, and its project. Another space is a new view.
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
 * live period's own — asks again. So does a refresh whose period before could not be read where
 * the answer on show has one: shown, it would take the comparison away and with it every change,
 * the table's columns of the period before, and push the words that say it was not read in over
 * the figures, moving the panel under them. So does a refresh whose accounts or, on the overview,
 * steps of the period before could not be read: shown, it would take the marks they draw away.
 * A new view whose read fails says it failed: the last view's answer is not its own. A new view
 * whose accounts or steps of the period before could not be read shows its answer without what
 * they mark, and the bar says the read failed as it says a refresh did (`lateFailed`): said by
 * the chart in a note of its own, the failure moved what stands under it, and held room for it
 * stood empty under every chart that read them.
 *
 * Every read goes through the page's shared reads (`useSharedUsage`), as of the moment they keep
 * for the view: another section asks only what no other part of the page has asked already.
 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import type { ColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { beforeStepsQuery } from '@/pages/analytics/composables/usePeriodBefore.ts'
import {
  providePanelParts,
  providePanelStanding,
} from '@/pages/analytics/composables/useReadStanding.ts'
import { scopeFilters } from '@/pages/analytics/composables/useSharedUsage.ts'
import type { SharedUsage, UsageScope } from '@/pages/analytics/composables/useSharedUsage.ts'
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

/** Whether `usage`, shown in place of `kept`, would take away the period before `kept` holds. */
const losesComparison = (kept: PlatformUiState<Usage>, usage: Usage) =>
  'payload' in kept && kept.payload.comparison !== null && usage.comparison === null

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

/**
 * Where an answer is shown and the read it belongs to, which a later read stops; for a refresh,
 * what stays on show if what is drawn with the answer cannot be read.
 */
interface ShowingWith {
  kept: PlatformUiState<Usage> | null
  overview: boolean
  signal: AbortSignal
}

/** A read that may fail without failing the page: its answer, or null. */
const orNull = <T>(reading: Promise<T>) => reading.catch(() => null)

/**
 * The answer beside the period it is compared with when that was read on its own
 * (`comparedPeriod`): that read's period, total, rows and the work its filter left out on no
 * account (`unplaced`), or none when it could not be read.
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
        unplaced: before.unplaced,
      }
    : null
  return { ...usage, comparison }
}

export function useUsageRead(options: {
  /** The page's colour keys, which take in each answer of the period as it lands. */
  places: ColourPlaces
  shared: SharedUsage
  /** The space and project the page is scoped to, which every read is narrowed to. */
  scope: () => UsageScope
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
  /**
   * The empty period on show and the newest record its answer named: the server names the store's
   * newest record whatever the period holds, and the empty state carries no answer to read it from.
   */
  const emptyRead = shallowRef<{ newest: string | null; shown: PlatformUiState<Usage> } | null>(
    null,
  )
  /**
   * The newest record the answer on show says the store holds, an empty period's too; undefined
   * while no answer stands on show.
   */
  const lastEventAt = computed(() => {
    const shown = state.value
    if ('payload' in shown) return shown.payload.last_event_at
    return emptyRead.value?.shown === shown ? emptyRead.value.newest : undefined
  })
  /** Whether a new view is read while the last view's answer stays on show. */
  const anew = shallowRef(false)
  /** Whether the last refresh of the view on show failed, what it showed kept on show. */
  const refreshFailed = shallowRef(false)
  /** Whether what is drawn with a new view's answer, read after it, could not be read. */
  const lateFailed = shallowRef(false)
  /** Whether a part's own read again failed, what it showed kept: a split's pairs. */
  const partFailed = providePanelParts()
  providePanelStanding({
    anew,
    failed: computed(() => refreshFailed.value || lateFailed.value || partFailed.value),
  })

  /** The scope's own filter: its project, or nothing at the top. */
  const scope = computed<UsageFilters>(() => scopeFilters(options.scope()))

  /** The filters the reads carry: the page's, and the scope's project over its own. */
  const filters = computed<UsageFilters>(() => ({ ...options.view().filters, ...scope.value }))

  /**
   * What a view asks; the moment of a preset is taken when it is asked, not here. The overview is
   * read as the breakdown it borrows, so moving between the two asks nothing again.
   */
  const asked = computed(() => {
    const view = options.view()
    const { period, from, to } = view
    const { space } = options.scope()
    return JSON.stringify({
      period,
      from,
      to,
      by: breakdownOf(view),
      filters: filters.value,
      space,
    })
  })

  /**
   * What the values a filter offers depend on: the period as the view names it and the scope.
   * Not the breakdown and not the filters, so changing those asks for no value again.
   */
  const offeredFor = computed(() => {
    const { period, from, to } = options.view()
    return JSON.stringify({ period, from, to, scope: options.scope() })
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
      lateFailed.value = false
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
      by === 'seat' ? null : orNull(ask(query(period, ['seat'], false), signal))
    let usage: Usage
    try {
      usage = compared(await asking, askingBefore ? await askingBefore : undefined)
    } catch {
      if (!signal.aborted) fail(kept)
      return
    }
    if (signal.aborted) return
    if (kept && losesComparison(kept, usage)) {
      fail(kept)
      return
    }
    options.places.take([by], usage, askedWith)
    const answer = {
      at,
      compared: comparedBounds(usage, period, before),
      filters: askedWith,
      key,
      period,
    }
    const showing = refresh ? showRefreshed : showNew
    await showing(usage, askingAccounts, answer, { kept, overview: view.by === OVERVIEW, signal })
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
    lateFailed.value = false
    const empty = nothingToShow(usage) ? uiEmpty<Usage>('analytics.empty.title') : null
    emptyRead.value = empty ? { shown: empty, newest: usage.last_event_at } : null
    state.value = empty ?? ready(usage)
  }

  /**
   * The steps of the period before an overview's answer, asked through the shared reads for the
   * part that draws them to take: whether they were read, or none were asked.
   */
  function stepsRead(usage: Usage, answer: ShownAnswer, { overview, signal }: ShowingWith) {
    if (!overview || !answer.compared) return Promise.resolve(true)
    const steps = beforeStepsQuery(answer.compared, answer.filters, usage.period.step)
    return orNull(ask(steps, signal)).then(Boolean)
  }

  /**
   * Shows a new view's answer as it lands, and its accounts as they follow it; that they or the
   * overview's steps of the period before could not be read is said as a failed read is.
   */
  async function showNew(
    usage: Usage,
    askingAccounts: Promise<Usage | null> | null,
    answer: ShownAnswer,
    showing: ShowingWith,
  ) {
    show(usage, askingAccounts ? 'loading' : usage, answer)
    const steps = stepsRead(usage, answer, showing)
    const byAccount = askingAccounts ? await askingAccounts : usage
    if (showing.signal.aborted) return
    accounts.value = byAccount ?? 'failed'
    const stepsInHand = await steps
    if (!showing.signal.aborted) lateFailed.value = !byAccount || !stepsInHand
  }

  /**
   * Shows a refreshed answer once what is drawn with it is in hand too: its accounts and, on the
   * overview, the steps of the period before, which the part that draws them takes at once. When
   * either could not be read the refresh failed, and what stood stays.
   */
  async function showRefreshed(
    usage: Usage,
    askingAccounts: Promise<Usage | null> | null,
    answer: ShownAnswer,
    showing: ShowingWith,
  ) {
    const steps = stepsRead(usage, answer, showing)
    const byAccount = askingAccounts ? await askingAccounts : usage
    const stepsInHand = await steps
    if (showing.signal.aborted) return
    if (byAccount && stepsInHand) show(usage, byAccount, answer)
    else fail(showing.kept)
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
          if (signal.aborted) return
          filterValues.value[dimension] = usage.rows
          options.places.take([dimension], usage, scope.value)
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
    lastEventAt,
    offer,
    readWith,
    retry: read,
    state,
  }
}
