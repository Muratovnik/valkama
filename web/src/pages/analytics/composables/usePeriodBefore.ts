/**
 * The period before an answer of the usage read, step by step, for the chart that outlines it.
 *
 * The read's own comparison holds the period before as one total and its rows, not its steps, so
 * this asks the same read once more for the very period the answer's figures are compared with
 * (`compared`), with the filters the answer was read with: the figures and the outline then say
 * one period before, never two. One figure a step is all an outline needs.
 *
 * Asked again for each new answer, and the read of the one before dropped. While it reads, and
 * when it fails or the answer holds no period before, there is no outline: the chart says which,
 * and never draws the last answer's outline behind a new answer's steps. It goes through the
 * page's shared reads (`useSharedUsage`), as every read of the page does.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'

import { useSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'

import type { Usage, UsageFilters } from '@/shared/api/analyticsApi.ts'

/** The steps of the period before, or that they are being read or could not be. */
export type BeforeSteps = Usage['series'] | 'failed' | 'loading'

export function usePeriodBefore(options: {
  /** The period the answer's figures are compared with; null when it was not read. */
  compared: () => PeriodBounds | null
  /** The filters the answer was read with, its scope's project among them. */
  filters: () => UsageFilters
  usage: () => Usage
}) {
  const shared = useSharedUsage()
  const steps = shallowRef<BeforeSteps>('loading')
  let reading: AbortController | null = null

  async function read() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const usage = options.usage()
    const compared = options.compared()
    if (!compared) {
      steps.value = 'failed'
      return
    }
    steps.value = 'loading'
    try {
      const before = await shared.read(
        {
          ...compared,
          groupBy: [],
          filters: options.filters(),
          compare: false,
          step: usage.period.step,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) steps.value = before.series
    } catch {
      if (!controller.signal.aborted) steps.value = 'failed'
    }
  }

  watch([options.usage, options.compared], () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return steps
}
