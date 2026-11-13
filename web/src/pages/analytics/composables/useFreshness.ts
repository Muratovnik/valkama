/**
 * How fresh the Analytics figures are, as the bar says it: the newest record the store holds, its
 * time and how old it is now, in seconds under a minute, counted on each second without a read.
 * Its clock time is the browser's own, as the time axis under the bar reads, and on an earlier day
 * its date before it, «Nov 10, 14:05».
 *
 * The bar shows the age alone, «15 s ago», and the sentence whole is its hint and what a screen
 * reader hears: `lead` is the words before the age. The age comes in three parts, so a line short
 * of room can drop the word around its span and never the span: `span`, «15 s», with the words
 * before it (`before`) and after it (`after`), «ago». `widest` is every form the age takes at its
 * widest, two figures in each unit, and the words of a store with nothing recorded, one a line,
 * with the word around the span and without it (`bare`), so the bar keeps the room of the widest
 * from the first frame and the age counting up moves nothing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useIntervalFn, useNow } from '@vueuse/core'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { momentAtOffset } from '@/pages/analytics/utils/readMoments.ts'

import { agoWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'

/** Where the age and its span start and end in the sentence. */
const AGE_START = '\u{1}'
const SPAN_START = '\u{2}'
const SPAN_END = '\u{3}'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The widest age of each unit: two figures in each, which tabular figures draw at one width. An
 * age of a hundred days or more is wider still, and the only one.
 */
const WIDEST_AGES = [59 * SECOND, 59 * MINUTE, 23 * HOUR + 59 * MINUTE, 99 * DAY + 23 * HOUR]

/** An age in its parts; «just now» has no span apart from its words, and is all span. */
function parts(age: string) {
  const [before = '', rest = ''] = age.includes(SPAN_START) ? age.split(SPAN_START) : ['', age]
  const [span = '', after = ''] = rest.split(SPAN_END)
  return { before, span, after }
}

/** The newest record as the answer on show names it: undefined with no answer, null with none. */
export function useFreshness(lastEventAt: () => string | null | undefined) {
  const { t } = useI18n()
  const words = useSpendingWords()
  const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 1000) })

  /** How long ago `at` was at `shownAt`, its span marked off from the words around it. */
  const marked = (at: number, shownAt: number) =>
    agoWords(at, shownAt, {
      ...spanWordsOf(t),
      ago: (time) => t('time.ago', { time: `${SPAN_START}${time}${SPAN_END}` }),
      seconds: (count) => t('analytics.time.seconds', { count }),
    })
  const widest = computed(() => {
    const none = t('analytics.frame.freshNone')
    const ages = [...WIDEST_AGES.map((span) => parts(marked(0, span))), parts(t('time.justNow'))]
    return {
      whole: [...ages.map(({ before, span, after }) => before + span + after), none].join('\n'),
      bare: [...ages.map(({ span }) => span), none].join('\n'),
    }
  })

  const fresh = computed(() => {
    const newest = lastEventAt()
    if (newest === undefined) return null
    if (newest === null) {
      const none = t('analytics.frame.freshNone')
      return { at: '', lead: '', before: '', span: '', after: '', words: none }
    }
    const at = Date.parse(newest)
    const shownAt = Math.max(now.value.getTime(), at)
    const age = marked(at, shownAt)
    // The clock time alone on the day it is seen, with its date before it on another day.
    const today = new Date(at).toDateString() === new Date(shownAt).toDateString()
    const moment = momentAtOffset(at)
    const named = today ? words.stepName(moment, 'minute').label : words.datedClock(moment)
    const sentence = t('analytics.frame.fresh', { at: named, ago: `${AGE_START}${age}` })
    const [lead = ''] = sentence.split(AGE_START)
    return {
      at: newest,
      lead,
      ...parts(age),
      words: sentence.replaceAll(/[\u{1}-\u{3}]/gu, ''),
    }
  })

  return { fresh, widest }
}
