/**
 * The reads behind the rail's tiles: the period by each dimension of the rail, one read a
 * dimension, with the page's filters and within the scope's project.
 *
 * They depend on the period, the filters and the scope, and on nothing else: choosing a section
 * or a measure asks nothing again, since the tiles draw every measure from the same rows. A new
 * period or filter asks every dimension again and drops the answers to the view it replaced, so a
 * slow read never draws over a later one. While it asks, a tile keeps the answer it shows; one
 * with nothing yet waits. Each read stands alone: one that fails is that tile's, and the others
 * are read and shown as they land.
 *
 * They go through the page's shared reads (`useSharedUsage`) as of the moment the page's own read
 * takes, so a tile that asks what the page or a card asks already takes that answer.
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { SharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { periodBounds, stepOf } from '@/pages/analytics/utils/analyticsPeriod.ts'

import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

/**
 * What a tile's read stands at: waiting for its first answer, an answer (`refreshing` while the
 * next is read), a read that failed, or no period to read — a custom one with a day missing.
 */
export type RailRead =
  | { status: 'failed' }
  | { status: 'loading' }
  | { status: 'unasked' }
  | { refreshing: boolean; status: 'ready'; usage: Usage }

export function useRailReads(options: {
  shared: SharedUsage
  /** The dimensions of the rail, a read each. */
  dimensions: () => readonly UsageDimension[]
  /** The project the page is scoped to, which every read is filtered to; null at the top. */
  projectId: () => string | null
  view: () => AnalyticsView
}) {
  const { now } = options.shared
  const reads = shallowRef<Partial<Record<UsageDimension, RailRead>>>({})
  /** The moment the reads on show were asked at, which says which day is not over yet. */
  const askedAt = shallowRef<Date>(now())

  /** The filters the reads carry: the page's, and the scope's project over its own. */
  const filters = computed<UsageFilters>(() => {
    const project = options.projectId()
    return { ...options.view().filters, ...(project ? { project: [project] } : {}) }
  })

  const asked = computed(() => {
    const { period, from, to } = options.view()
    return JSON.stringify({ period, from, to, filters: filters.value, by: options.dimensions() })
  })

  let reading: AbortController | null = null

  const settle = (dimension: UsageDimension, read: RailRead) => {
    reads.value = { ...reads.value, [dimension]: read }
  }

  /** What a tile shows while its next read is asked: the answer it has, or a wait. */
  const waiting = (held: RailRead | undefined): RailRead =>
    held?.status === 'ready' ? { ...held, refreshing: true } : { status: 'loading' }

  /** Every dimension's read, asked together; each tile takes its answer as it lands. */
  async function read() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const { signal } = controller
    const at = now()
    const dimensions = options.dimensions()
    const period = periodBounds(options.view(), at)
    const step = stepOf(options.view())
    askedAt.value = at
    if (!period) {
      reads.value = Object.fromEntries(dimensions.map((one) => [one, { status: 'unasked' }]))
      return
    }
    const held = reads.value
    reads.value = Object.fromEntries(dimensions.map((one) => [one, waiting(held[one])]))
    const asking = filters.value
    await Promise.all(
      dimensions.map(async (dimension) => {
        try {
          const usage = await options.shared.read(
            { ...period, groupBy: [dimension], filters: asking, compare: false, step },
            signal,
          )
          if (!signal.aborted) settle(dimension, { status: 'ready', usage, refreshing: false })
        } catch {
          if (!signal.aborted) settle(dimension, { status: 'failed' })
        }
      }),
    )
  }

  watch(asked, () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { askedAt, reads, refresh: read }
}
