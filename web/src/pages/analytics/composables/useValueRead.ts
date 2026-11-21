/**
 * The reads behind a value's side panel: the page's answer again, for exactly its period by the
 * moments the answer wrote, its steps and the filters it was read with, the value's own filter
 * added (`valueFilters`), broken down by model and, apart, by account. Each is read by the value's
 * dimension first, so every row names the value as the answer gives it — a task's title and
 * number — and a value of the models or the accounts is read by the other alone. Either answer's
 * steps are the value's days; the period before them is read step by step with them, through the
 * period the page's answer is compared with (`beforeStepsQuery`), so the days are drawn with their
 * marks and nothing lands under them once they stand.
 *
 * It is asked whenever the page's answer is replaced or another value opens, and drops the read it
 * replaces, so a slow one never draws over a later one. While the same value is read again, what it
 * showed stays (`refreshing`), and a read again that fails, its period before among it, keeps it
 * and says so (`failedAgain`); a first read that fails says it could not be read, and may be asked
 * again (`retry`), and one whose period before alone failed shows its answers with no marks and says
 * so as a read again does. It goes
 * through the page's shared reads (`useSharedUsage`), so a value opened again takes the answers it
 * had.
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { beforeStepsQuery } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { useSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'

import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

/** The dimensions a value's panel breaks it down by, each read apart. */
const VALUE_BREAKDOWNS = ['model', 'seat'] as const
export type ValueBreakdown = (typeof VALUE_BREAKDOWNS)[number]

/** The answers of a value, by the dimension each breaks it down by; its own has none. */
export type ValueAnswers = Partial<Record<ValueBreakdown, Usage>>

export type ValueRead =
  | { status: 'failed' }
  | { status: 'loading' }
  | {
      answers: ValueAnswers
      /** The steps of the period before, to mark over the days; null when not read. */
      before: Usage['series'] | null
      /** Whether the steps of the period before were asked with these answers and not read. */
      beforeFailed: boolean
      failedAgain: boolean
      refreshing: boolean
      status: 'ready'
    }

/** The filters a value is read with: the page's, the value's dimension admitting it alone. */
export const valueFilters = (
  filters: UsageFilters,
  by: UsageDimension,
  value: string | null,
): UsageFilters => ({ ...filters, [by]: [value] })

/** The breakdowns of a value: the models and the accounts, but its own dimension's. */
export const valueBreakdowns = (by: UsageDimension) =>
  VALUE_BREAKDOWNS.filter((breakdown) => breakdown !== by)

/** Either answer's steps, the value's whole figures by step: the first one read. */
export function valueSteps(answers: ValueAnswers): Usage | null {
  return VALUE_BREAKDOWNS.map((breakdown) => answers[breakdown]).find(Boolean) ?? null
}

export function useValueRead(options: {
  by: () => UsageDimension
  /** The period the page's answer is compared with; null when it was not read. */
  compared: () => PeriodBounds | null
  /** The filters the page's answer was read with. */
  filters: () => UsageFilters
  /** The page's answer the value is read for. */
  page: () => Usage | null
  value: () => string | null
}) {
  const shared = useSharedUsage()
  const state = shallowRef<ValueRead>({ status: 'loading' })
  /** The value the answers on show are of, so another value never shows the last one's. */
  let shownFor = ''
  let reading: AbortController | null = null

  const asked = computed(() => JSON.stringify([options.by(), options.value()]))

  async function read() {
    reading?.abort()
    reading = null
    const page = options.page()
    if (!page) return
    const controller = new AbortController()
    reading = controller
    const by = options.by()
    const filters = valueFilters(options.filters(), by, options.value())
    const { from, to, step, utc_offset: utcOffset } = page.period
    const value = asked.value
    const shown = state.value
    const kept = shown.status === 'ready' && shownFor === value ? shown : null
    state.value = kept ? { ...kept, refreshing: true, failedAgain: false } : { status: 'loading' }
    const compared = options.compared()
    const askingBefore = compared
      ? shared.read(beforeStepsQuery(compared, filters, step), controller.signal).then(
          (before) => before.series,
          () => null,
        )
      : null
    try {
      const breakdowns = valueBreakdowns(by)
      const read = await Promise.all(
        breakdowns.map((breakdown) =>
          shared.read(
            { from, to, utcOffset, step, groupBy: [by, breakdown], filters, compare: false },
            controller.signal,
          ),
        ),
      )
      const before = askingBefore ? await askingBefore : null
      if (controller.signal.aborted) return
      const beforeFailed = askingBefore !== null && before === null
      if (kept && beforeFailed) {
        state.value = { ...kept, refreshing: false, failedAgain: true }
        return
      }
      const answers: ValueAnswers = Object.fromEntries(
        breakdowns.map((breakdown, index) => [breakdown, read[index]]),
      )
      shownFor = value
      state.value = {
        status: 'ready',
        answers,
        before,
        beforeFailed,
        refreshing: false,
        failedAgain: beforeFailed,
      }
    } catch {
      if (controller.signal.aborted) return
      state.value = kept ? { ...kept, refreshing: false, failedAgain: true } : { status: 'failed' }
    }
  }

  watch([options.page, asked, options.filters, options.compared], () => void read(), {
    immediate: true,
  })
  onScopeDispose(() => reading?.abort())

  return { state, retry: read }
}
