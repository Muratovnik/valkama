/**
 * The read behind a crossed table: the answer on show again, broken down by its own dimension and
 * a second one, for exactly the period and the filters that answer was read with — the period by
 * its moments as the answer wrote them, so the two never disagree about where a day starts.
 *
 * It is asked whenever the answer on show is replaced or the second dimension changes, and drops
 * the read it replaces, so a slow one never draws over a later one. While it asks, the last crossed
 * answer of the same two dimensions stays on screen; a read that fails says so and may be asked
 * again (`retry`). With no second dimension, or one the section already breaks down by, nothing is
 * asked. It goes through the page's shared reads (`useSharedUsage`), so a crossing chosen again
 * for the same view takes the answer it had.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'

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
  usage: () => Usage
}) {
  const shared = useSharedUsage()
  const state = shallowRef<CrossRead>({ status: 'off' })
  let reading: AbortController | null = null

  async function read() {
    reading?.abort()
    reading = null
    const usage = options.usage()
    const across = options.across()
    const by = pageDimensionOf(usage)
    if (!across || !by || across === by) {
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
    const { from, to, utc_offset: utcOffset } = usage.period
    try {
      const crossedUsage = await shared.read(
        { from, to, utcOffset, groupBy: [by, across], filters: options.filters(), compare: false },
        controller.signal,
      )
      if (!controller.signal.aborted) state.value = { status: 'ready', usage: crossedUsage }
    } catch {
      if (!controller.signal.aborted) state.value = { status: 'failed' }
    }
  }

  watch([options.usage, options.across], () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { state, retry: read }
}
