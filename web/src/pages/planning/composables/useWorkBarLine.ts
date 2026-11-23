import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { CensusExclusion } from '@/pages/planning/composables/usePlanningCensus.ts'
import type { ViewGrouping } from '@/pages/planning/composables/usePlanningChainScope.ts'

/** What the Work bar's line counts, read fresh on every change. */
type LineInput = () => {
  /** The space's own work; `elsewhere`, the cards of other spaces that name its project. */
  counts: {
    elsewhere: number
    matchedClosed: number
    matchedOpen: number
    open: number
    total: number
  }
  /** What the graph leaves out of its own counts. */
  exclusion: CensusExclusion | null
  /** The filter differs from the empty one. */
  filtered: boolean
  /** How the view on the stage is grouped; null for a view with no grouping. */
  grouping: ViewGrouping | null
}

/**
 * The facts of the line under the Work bar's row, each its own words: how much of the open work
 * the filter lets through, the other spaces' cards, the closed items a filter let through alone
 * and the goals a grouped board draws as rows.
 */
export function useWorkBarLine(input: LineInput) {
  const { t } = useI18n()

  /** «319 открытых из 1267», or what the filter let through of the open work. */
  const counts = computed(() => {
    const {
      counts: { matchedOpen, open, total },
      filtered,
    } = input()
    return filtered
      ? t('workItem.filter.matched', { matched: matchedOpen, open }, open)
      : t('workItem.filter.open', { open, total }, open)
  })
  /**
   * Named apart as not this space's work, «и 3 из других пространств»: a fact of its own, so the
   * line breaks before it where both do not fit. Held to the count in one fact, the line ran
   * 15px past a phone's screen and its end was cut.
   */
  const elsewhere = computed(() => {
    const count = input().counts.elsewhere
    return count ? t('workItem.filter.elsewhere', { count }) : ''
  })
  /**
   * The closed items a filter let through, said only when it let through no open
   * one: beside open matches they are the views' own extra items and the line
   * does not carry them.
   */
  const closed = computed(() => {
    const {
      counts: { matchedClosed, matchedOpen },
      filtered,
    } = input()
    return filtered && matchedOpen === 0 && matchedClosed
      ? t('workItem.filter.closedToo', { closed: matchedClosed }, matchedClosed)
      : ''
  })
  /**
   * The goals the grouped board draws as rows, counted by the census exclusion the
   * counts already use: the board's columns do not hold them.
   */
  const rows = computed(() => {
    const { exclusion: left, grouping } = input()
    // Only a board in lanes by goal or by stage draws its containers as rows.
    const lanes = grouping === 'goal' || grouping === 'stage'
    return lanes && left?.kind === 'lane-heads'
      ? t('workItem.countsExclude.laneHeads', { goals: left.count }, left.count)
      : ''
  })
  return { closed, counts, elsewhere, rows }
}
