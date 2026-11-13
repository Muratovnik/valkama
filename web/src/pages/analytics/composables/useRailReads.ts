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
 * A tile whose read again of the view it shows fails keeps its figures, and the rail says a read
 * again failed until a later round of every tile lands (`useReadStanding`); a tile with no figures
 * of that view says its read failed. While a new view is read the rail says so too, until every
 * tile has its answer.
 *
 * They go through the page's shared reads (`useSharedUsage`) as of the moment the page's own read
 * takes, so a tile that asks what the page or a card asks already takes that answer.
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { ColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { provideRailStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import { scopeFilters } from '@/pages/analytics/composables/useSharedUsage.ts'
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
  /** The page's colour keys, which take in each tile's answer as it lands. */
  places: ColourPlaces
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
  /** Whether a new view is read while tiles still show the last view's figures. */
  const anew = shallowRef(false)
  /** Whether a tile's read again failed in the last round, its figures kept. */
  const failed = shallowRef(false)
  provideRailStanding({ anew, failed })
  /** What each tile's figures on show were asked for (`asked`). */
  let shownFor: Partial<Record<UsageDimension, string>> = {}

  /** The filters the reads carry: the page's, and the scope's project over its own. */
  const filters = computed<UsageFilters>(() => ({
    ...options.view().filters,
    ...scopeFilters(options.projectId()),
  }))

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

  /**
   * Every dimension's read, asked together; each tile takes its answer as it lands. A tile whose
   * read fails keeps the figures it shows of the same view, or says the read failed.
   */
  async function read() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const { signal } = controller
    const at = now()
    const dimensions = options.dimensions()
    const period = periodBounds(options.view(), at)
    const step = stepOf(options.view())
    const key = asked.value
    askedAt.value = at
    if (!period) {
      reads.value = Object.fromEntries(dimensions.map((one) => [one, { status: 'unasked' }]))
      shownFor = {}
      anew.value = false
      failed.value = false
      return
    }
    const held = reads.value
    /** The figures a tile keeps if its read fails: those it shows of this same view. */
    const keeps = (one: UsageDimension) => {
      const shown = held[one]
      return shown?.status === 'ready' && shownFor[one] === key ? shown : null
    }
    if (dimensions.some((one) => held[one]?.status === 'ready' && !keeps(one))) anew.value = true
    if (!dimensions.some((one) => keeps(one))) failed.value = false
    reads.value = Object.fromEntries(dimensions.map((one) => [one, waiting(held[one])]))
    const asking = filters.value
    let kept = false
    await Promise.all(
      dimensions.map(async (dimension) => {
        const keeping = keeps(dimension)
        try {
          const usage = await options.shared.read(
            { ...period, groupBy: [dimension], filters: asking, compare: false, step },
            signal,
          )
          if (signal.aborted) return
          options.places.take([dimension], usage, asking)
          shownFor[dimension] = key
          settle(dimension, { status: 'ready', usage, refreshing: false })
        } catch {
          if (signal.aborted) return
          kept ||= Boolean(keeping)
          settle(dimension, keeping ? { ...keeping, refreshing: false } : { status: 'failed' })
        }
      }),
    )
    if (signal.aborted) return
    anew.value = false
    failed.value = kept
  }

  watch(asked, () => void read(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { askedAt, reads, refresh: read }
}
