/**
 * How fresh the Analytics figures are, as the bar says it: the newest record the store holds, its
 * time and how old it is now, in seconds under a minute, counted on each second without a read.
 * Its clock time is the browser's own, as the time axis under the bar reads, and on an earlier day
 * its date before it, «Nov 10, 14:05».
 *
 * The sentence comes in two parts, the record with its moment (`record`) and the age after it
 * (`age`), so a line short of room can cut the first and never the age.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useIntervalFn, useNow } from '@vueuse/core'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { momentAtOffset } from '@/pages/analytics/utils/readMoments.ts'

import { agoWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'

/** Where the newest record's moment ends in the sentence: what follows it is its age. */
const MOMENT_END = '\u{0}'

/** The newest record as the answer on show names it: undefined with no answer, null with none. */
export function useFreshness(lastEventAt: () => string | null | undefined) {
  const { locale, t } = useI18n()
  const words = useSpendingWords()
  const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 1000) })

  return computed(() => {
    const newest = lastEventAt()
    if (newest === undefined) return null
    if (newest === null) {
      const none = t('analytics.frame.freshNone')
      return { at: '', ago: '', record: '', age: '', words: none, full: '' }
    }
    const at = Date.parse(newest)
    const shownAt = Math.max(now.value.getTime(), at)
    const seconds = (count: number) => t('analytics.time.seconds', { count })
    const ago = agoWords(at, shownAt, { ...spanWordsOf(t), seconds })
    // The clock time alone on the day it is seen, with its date before it on another day.
    const today = new Date(at).toDateString() === new Date(shownAt).toDateString()
    const moment = momentAtOffset(at)
    const named = today ? words.stepName(moment, 'minute').label : words.datedClock(moment)
    const sentence = t('analytics.frame.fresh', { at: `${named}${MOMENT_END}`, ago })
    const [record = '', age = ''] = sentence.split(MOMENT_END)
    return {
      at: newest,
      ago,
      record,
      age,
      words: record + age,
      full: new Intl.DateTimeFormat(locale.value, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(at),
    }
  })
}
