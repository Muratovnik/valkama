/**
 * How the overview of the Analytics page says what it adds to the rest of the page: an amount a
 * value moved by in the measure's own units, a rise from a base too little for a share, and the
 * name of each card of first values.
 */
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'

/** The dimensions the overview gives a card of first values, in the cards' order. */
export const OVERVIEW_CARDS = ['work_item', 'model', 'role', 'project'] as const
export type OverviewCard = (typeof OVERVIEW_CARDS)[number]

export function useOverviewWords() {
  const { t } = useI18n()
  const words = useSpendingWords()

  /** By how much a value moved, in the measure's own units, with its sign: «+6 h 11 min». */
  const movedBy = (measure: Measure, by: number) =>
    `${by > 0 ? '+' : '−'}\u{2009}${words.scale(measure, Math.abs(by))}`

  /** A rise from a base too little for a share: «↑ from 2 min in 2 – 8 Nov». */
  const risenFrom = (measure: Measure, before: Spent, period: string) =>
    t('analytics.overview.risenFrom', { before: words.figure(measure, before), period })

  const cardTitle = (card: OverviewCard) => t(`analytics.overview.cards.${card}`)

  return { cardTitle, movedBy, risenFrom }
}
