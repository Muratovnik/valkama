/**
 * The reads behind a value's side panel: the page's answer again, for exactly its period by the
 * moments the answer wrote, its steps and the filters it was read with, the value's own filter
 * added (`valueFilters`), broken down by model and, apart, by account. Each is read by the value's
 * dimension first, so every row names the value as the answer gives it — a task's title and
 * number — and a value of the models or the accounts is read by the other alone. Either answer's
 * steps are the value's days; the period before them is read through the period the page's answer
 * is compared with (`usePeriodBefore`).
 *
 * It is asked whenever the page's answer is replaced or another value opens, and drops the read it
 * replaces, so a slow one never draws over a later one. While the same value is read again, what it
 * showed stays (`refreshing`), and a read again that fails keeps it and says so (`failedAgain`);
 * a first read that fails says it could not be read, and may be asked again (`retry`). It goes
 * through the page's shared reads (`useSharedUsage`), so a value opened again takes the answers it
 * had.
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { useSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'

import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

/** The dimensions a value's panel breaks it down by, each read apart. */
const VALUE_BREAKDOWNS = ['model', 'seat'] as const
export type ValueBreakdown = (typeof VALUE_BREAKDOWNS)[number]

/** The answers of a value, by the dimension each breaks it down by; its own has none. */
export type ValueAnswers = Partial<Record<ValueBreakdown, Usage>>

export type ValueRead =
  | { status: 'failed' }
  | { status: 'loading' }
  | { answers: ValueAnswers; failedAgain: boolean; refreshing: boolean; status: 'ready' }

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
      if (controller.signal.aborted) return
      const answers: ValueAnswers = Object.fromEntries(
        breakdowns.map((breakdown, index) => [breakdown, read[index]]),
      )
      shownFor = value
      state.value = { status: 'ready', answers, refreshing: false, failedAgain: false }
    } catch {
      if (controller.signal.aborted) return
      state.value = kept ? { ...kept, refreshing: false, failedAgain: true } : { status: 'failed' }
    }
  }

  watch([options.page, asked, options.filters], () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { state, retry: read }
}
