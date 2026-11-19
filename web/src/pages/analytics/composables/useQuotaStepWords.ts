/**
 * The words a quota window's step line takes (`StepWords`): the top of its scale, the ends of its
 * axis — its start and its reset, «start 11:30» and «resets 16:30», or past the reset «reset at
 * 16:30», dated against the answer's day as every moment of the answer is — «Now», what takes a
 * frame back to the whole window, its table's columns, and what it says with no readings or a
 * reset past a frame. The current window and a past window shown in its place
 * (`QuotaPastWindow`) name theirs alike.
 */
import { useI18n } from 'vue-i18n'

import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'

import type { QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import { stepTop } from '@/shared/ui/windowGeometry.ts'
import type { StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

export function useQuotaStepWords() {
  const { t } = useI18n()
  const words = useQuotaWords()

  return (
    window: QuotaShareWindow,
    points: readonly StepPoint[],
    /** The answer's moment at its offset, and whether the window is past its reset. */
    read: { ended: boolean; today: string },
  ): StepWords => {
    const { today, ended } = read
    const start = window.started_at
    const reset = window.resets_at
    return {
      whole: t('analytics.quota.readings.whole'),
      now: t('analytics.quota.readings.now'),
      top: t('analytics.quota.readings.top', { share: words.share(stepTop(points)) }),
      time: t('analytics.quota.readings.time'),
      value: t('analytics.quota.readings.value'),
      note: t('analytics.quota.readings.note'),
      empty: t('analytics.quota.readings.empty'),
      past: t('analytics.quota.readings.past'),
      ...(start === null
        ? {}
        : { start: t('analytics.quota.readings.start', { at: words.moment(start, today) }) }),
      ...(reset === null
        ? {}
        : {
            reset: t(
              ended ? 'analytics.quota.readings.wasReset' : 'analytics.quota.readings.resets',
              { at: words.moment(reset, today) },
            ),
          }),
    }
  }
}
