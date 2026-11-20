/**
 * The words a quota window's step line takes (`StepWords`): the top of its scale, the ends of its
 * axis — its start and its reset, «start 11:30» and «resets 16:30», or past the reset «reset at
 * 16:30», dated against the answer's day as every moment of the answer is — «Now», what takes a
 * frame back to the whole window, its table's columns, and what it says with no readings or a
 * reset past a frame. The current window and a past window shown in its place
 * (`QuotaPastWindow`) name theirs alike. A card's line names what the section decided it draws
 * (`line`, `quotaLine`): the start of the first window it holds; past a reset with nothing read
 * since, «no new readings since» it at the line's end; and where the line is the account's current
 * window with none of the card's readings, that window's start and reset, its empty plot saying
 * what the card's lead says, «Reset at 14:30, no new readings».
 */
import { useI18n } from 'vue-i18n'

import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import type { QuotaLine } from '@/pages/analytics/utils/quotaLine.ts'

import type { QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import { stepTop } from '@/shared/ui/windowGeometry.ts'
import type { StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

export function useQuotaStepWords() {
  const { t } = useI18n()
  const words = useQuotaWords()

  return (
    window: QuotaShareWindow,
    points: readonly StepPoint[],
    /**
     * The answer's moment at its offset, whether the window is past its reset, and what its line
     * draws where it is a card's (`sectionLines`); unset, the window alone.
     */
    read: { ended: boolean; today: string; line?: QuotaLine },
  ): StepWords => {
    const { today, line } = read
    const start = line ? line.start : window.started_at
    const reset = line ? line.reset : window.resets_at
    // The account's current window, which has not reset, stands in the card's place.
    const ended = read.ended && !line?.empty
    const quiet = line?.quietSince ?? null
    const resetWord = () => {
      if (quiet !== null && !line?.empty)
        return t('analytics.quota.readings.quietSince', { at: words.moment(quiet, today) })
      if (reset === null) return null
      return t(ended ? 'analytics.quota.readings.wasReset' : 'analytics.quota.readings.resets', {
        at: words.moment(reset, today),
      })
    }
    const said = resetWord()
    return {
      whole: t('analytics.quota.readings.whole'),
      now: t('analytics.quota.readings.now'),
      top: t('analytics.quota.readings.top', { share: words.share(stepTop(points)) }),
      time: t('analytics.quota.readings.time'),
      value: t('analytics.quota.readings.value'),
      note: t('analytics.quota.readings.note'),
      empty:
        line?.empty && quiet !== null
          ? t('analytics.quota.ended', { at: words.moment(quiet, today) })
          : t('analytics.quota.readings.empty'),
      past: t('analytics.quota.readings.past'),
      ...(start === null
        ? {}
        : { start: t('analytics.quota.readings.start', { at: words.moment(start, today) }) }),
      ...(said === null ? {} : { reset: said }),
    }
  }
}
