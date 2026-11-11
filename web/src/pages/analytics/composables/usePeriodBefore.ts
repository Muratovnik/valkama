/**
 * The period before an answer of the usage read, step by step, for the chart that outlines it.
 *
 * The read's own comparison holds the period before as one total and its rows, not its steps, so
 * this asks the same read once more for that period (`periodBefore`), with the filters the answer
 * was read with and nothing to group by: one figure a step is all an outline needs.
 *
 * Asked again for each new answer, and the read of the one before dropped. While it reads, and
 * when it fails, there is no outline: the chart says which, and never draws the last answer's
 * outline behind a new answer's steps.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'

import { periodBefore } from '@/pages/analytics/utils/overviewFigures.ts'

import { fetchUsage } from '@/shared/api/analyticsApi.ts'
import type { Usage, UsageFilters } from '@/shared/api/analyticsApi.ts'

/** The steps of the period before, or that they are being read or could not be. */
export type BeforeSteps = Usage['series'] | 'failed' | 'loading'

export function usePeriodBefore(options: {
  /** The filters the answer was read with, its scope's project among them. */
  filters: () => UsageFilters
  usage: () => Usage
  /** Whether the answer is of this week, which is held against the same days of the week before. */
  weekly: () => boolean
}) {
  const steps = shallowRef<BeforeSteps>('loading')
  let reading: AbortController | null = null

  async function read() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const usage = options.usage()
    steps.value = 'loading'
    try {
      const before = await fetchUsage(
        {
          ...periodBefore(usage, options.weekly()),
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

  watch(options.usage, () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return steps
}
