/**
 * The words a quota window's step line takes (`StepWords`): its span switch and the span's name, the
 * top of its scale, its table's columns, and what it says with no readings or a reset past its
 * plot, each said for the window by its name. The current window and a past window shown in its
 * place (`QuotaPastWindow`) name theirs alike.
 */
import { useI18n } from 'vue-i18n'

import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'

import type { QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import { stepTop } from '@/shared/ui/windowGeometry.ts'
import type { StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

export function useQuotaStepWords() {
  const { t } = useI18n()
  const words = useQuotaWords()

  return (window: QuotaShareWindow, points: readonly StepPoint[]): StepWords => ({
    ahead: t('analytics.quota.readings.ahead'),
    whole: t('analytics.quota.readings.whole'),
    views: t('analytics.quota.readings.views', { window: words.windowName(window) }),
    top: t('analytics.quota.readings.top', { share: words.share(stepTop(points)) }),
    time: t('analytics.quota.readings.time'),
    value: t('analytics.quota.readings.value'),
    note: t('analytics.quota.readings.note'),
    empty: t('analytics.quota.readings.empty'),
    past: t('analytics.quota.readings.past'),
  })
}
