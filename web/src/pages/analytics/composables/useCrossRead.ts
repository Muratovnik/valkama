/**
 * The read behind a split section: the answer on show again, broken down by its own dimension and
 * the one it is split by, for exactly the period and the filters that answer was read with — the
 * period by its moments as the answer wrote them, so the two never disagree about where a day
 * starts, and by the answer's steps, so its days, hours or minutes stand as the answer's do. Where the answer on show is compared with a period before, that period is read by both
 * as well, by the moments the answer names for it, and stands in the crossed answer as its
 * comparison; its pairs are what the table sets beside each pair now.
 *
 * It is asked whenever the answer on show is replaced or the second dimension changes, and drops
 * the read it replaces, so a slow one never draws over a later one. While it asks, the last crossed
 * answer of the same two dimensions stays on screen; a read that fails says so and may be asked
 * again (`retry`). With no answer on show, no second dimension, or one the section already breaks
 * down by, nothing is asked. It goes through the page's shared reads (`useSharedUsage`), so a split chosen again for
 * the same view takes the answer it had.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'

import { useColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { useSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'

import { pageDimensionOf } from '@/shared/api/analyticsApi.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

export type CrossRead =
  | { status: 'failed' }
  | { status: 'off' }
  | { status: 'reading'; usage: Usage | null }
  | { status: 'ready'; usage: Usage }

/** The two dimensions a crossed answer was read by, in order. */
const pairOf = (usage: Usage) => usage.group_by.join(',')

export function useCrossRead(options: {
  across: () => UsageDimension | null
  /** The filters the answer on show was read with, its scope's project among them. */
  filters: () => UsageFilters
  /** The answer on show; null while there is none. */
  usage: () => Usage | null
}) {
  const shared = useSharedUsage()
  const places = useColourPlaces()
  const state = shallowRef<CrossRead>({ status: 'off' })
  let reading: AbortController | null = null

  async function read() {
    reading?.abort()
    reading = null
    const usage = options.usage()
    const across = options.across()
    const by = usage && pageDimensionOf(usage)
    if (!usage || !across || !by || across === by) {
      state.value = { status: 'off' }
      return
    }
    const controller = new AbortController()
    reading = controller
    const shown = state.value
    const pair = `${by},${across}`
    state.value = {
      status: 'reading',
      usage: 'usage' in shown && shown.usage && pairOf(shown.usage) === pair ? shown.usage : null,
    }
    const { utc_offset: utcOffset, step } = usage.period
    const filters = options.filters()
    const ask = ({ from, to }: { from: string; to: string }) =>
      shared.read(
        {
          from,
          to,
          utcOffset,
          step,
          groupBy: [by, across],
          filters,
          compare: false,
        },
        controller.signal,
      )
    const { comparison } = usage
    try {
      const [now, before] = await Promise.all([
        ask(usage.period),
        comparison ? ask(comparison.period) : null,
      ])
      const crossed: Usage = {
        ...now,
        comparison: before
          ? {
              period: comparison?.period ?? before.period,
              total: before.total,
              rows: before.rows,
              unplaced: before.unplaced,
            }
          : null,
      }
      if (controller.signal.aborted) return
      places.take([by, across], now, filters)
      state.value = { status: 'ready', usage: crossed }
    } catch {
      if (!controller.signal.aborted) state.value = { status: 'failed' }
    }
  }

  watch([options.usage, options.across], () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { state, retry: read }
}
