/**
 * The words of what a goal or a stage spent, in the one way every place says them: the Volumes
 * page's tree of goals, a goal's row in the Work list and a goal's card, so the same goal reads
 * the same there.
 *
 * Spending is agent time, the sum of the stretches, and the tokens processed anew. A figure the
 * read has no data for is «—» with a hint saying why, never a zero: nothing counted while the
 * goal's tasks began before usage was counted to a card (`partly_measured`), or no usage counted
 * to any card yet. Counted with some of its tasks begun before, the figure is marked as not
 * whole. Work that was counted and spent nothing says so in words.
 */
import { useI18n } from 'vue-i18n'

import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'
import { spanWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'
import { tokensAnew } from '@/shared/lib/tokensAnew.ts'

/** What stands for a figure the read cannot give. */
export const UNKNOWN = '—'

/** A figure and, where it is «—» or not whole, the hint that says why. */
export interface Figure {
  hint: string
  text: string
}

/** One of a goal's two spend numbers, as the reads give it. */
export interface GoalSpent {
  agent_seconds: number
  partly_measured: number
  tokens: UsageTokens
}

export function useGoalSpendWords() {
  const { locale, t } = useI18n()

  const compact = (value: number) =>
    new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    )
  const span = (seconds: number) => spanWords(seconds * 1000, spanWordsOf(t))

  /** Time and tokens of a spend, joined; empty where nothing was counted. */
  function amount(seconds: number, tokens: UsageTokens): string {
    const anew = tokensAnew(tokens)
    return [seconds > 0 ? span(seconds) : '', anew ? compact(anew) : ''].filter(Boolean).join(' · ')
  }

  /**
   * What a goal spent. `measured` is false where no usage was ever counted to a card, which the
   * Volumes read says; a read that does not say it counts on the goal's own `partly_measured`.
   */
  function spent(line: GoalSpent, measured = true): Figure {
    const said = amount(line.agent_seconds, line.tokens)
    if (!measured) return { text: UNKNOWN, hint: t('volumes.goals.neverMeasured') }
    const partly = line.partly_measured
    if (!said && partly > 0) return { text: UNKNOWN, hint: t('volumes.goals.spentUnknown') }
    if (!said) return { text: t('volumes.goals.noSpend'), hint: '' }
    if (partly > 0)
      return { text: `${said}+`, hint: t('volumes.goals.partly', { count: partly }, partly) }
    return { text: said, hint: '' }
  }

  return { amount, compact, span, spent }
}
