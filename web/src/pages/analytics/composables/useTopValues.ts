/**
 * The values each of a few dimensions spent in the period of an answer, for the overview's cards
 * of first values: the same usage read, one a dimension, over the period the answer was asked for
 * and with the filters it was read with, so a card adds up to the figures above it.
 *
 * A dimension the answer itself was read by takes the answer's rows and asks nothing. The rest
 * are asked again for each new answer, the reads for the one before dropped; while they read, a
 * card keeps what it showed, so a refresh moves nothing, and only a card with nothing yet waits.
 * They go through the page's shared reads (`useSharedUsage`), so a card asks nothing a tile of the
 * rail asked already.
 */
import { onScopeDispose, ref, watch } from 'vue'

import { useSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'

import type { Usage, UsageDimension, UsageFilters, UsageRow } from '@/shared/api/analyticsApi.ts'

/** What a card has to show: the dimension's rows, or that they are being read or could not be. */
export type TopRead = UsageRow[] | 'failed' | 'loading'

export function useTopValues(options: {
  dimensions: () => readonly UsageDimension[]
  /** The filters the answer was read with, its scope's project among them. */
  filters: () => UsageFilters
  /** The period the answer was asked for, as it was asked. */
  period: () => PeriodBounds | null
  usage: () => Usage
}) {
  const shared = useSharedUsage()
  const reads = ref<Partial<Record<UsageDimension, TopRead>>>({})
  let reading: AbortController | null = null

  async function readOne(
    dimension: UsageDimension,
    asked: { period: PeriodBounds; usage: Usage },
    signal: AbortSignal,
  ) {
    const held = reads.value[dimension]
    if (!Array.isArray(held)) reads.value[dimension] = 'loading'
    try {
      const answer = await shared.read(
        {
          ...asked.period,
          groupBy: [dimension],
          filters: options.filters(),
          compare: false,
          step: asked.usage.period.step,
        },
        signal,
      )
      if (!signal.aborted) reads.value[dimension] = answer.rows
    } catch {
      if (!signal.aborted) reads.value[dimension] = 'failed'
    }
  }

  async function read() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const usage = options.usage()
    const period = options.period()
    const asked = options.dimensions().filter((dimension) => {
      if (usage.group_by[0] !== dimension) return true
      reads.value[dimension] = usage.rows
      return false
    })
    if (!period) return
    await Promise.all(
      asked.map((dimension) => readOne(dimension, { period, usage }, controller.signal)),
    )
  }

  watch([options.usage, options.dimensions], () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { reads, retry: read }
}
