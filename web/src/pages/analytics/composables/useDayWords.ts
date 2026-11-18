/**
 * The words of a chart of the page's periods in one measure (`PeriodColumns`), and how its scale
 * and its axis read. The section's days (`SpendingDays`) and a value's days in its side panel
 * (`ValueDays`) say them alike. Time is always counted; tokens and a price can be absent from a
 * period that spent, which the chart then says in the measure's words.
 */
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageStep } from '@/shared/api/analyticsApi.ts'

export function useDayWords() {
  const { t } = useI18n()
  const words = useSpendingWords()
  return (measure: Measure, step: UsageStep) => ({
    words: {
      absent: measure === 'time' ? undefined : t(`analytics.days.absent.${measure}`),
      before: t('analytics.overview.before.word'),
      empty: t('analytics.days.empty'),
      incomplete: t('analytics.days.soFar'),
      hatch: t('analytics.days.hatch'),
      note: t('analytics.days.note'),
      pending: t('analytics.time.notYet'),
      period: t(`analytics.time.steps.${step}.name`),
      total: t('analytics.days.total'),
    },
    formatValue: (amount: number) => words.scale(measure, amount),
    valueAxis: words.axis(measure),
  })
}
