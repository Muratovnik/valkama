/**
 * The value axis of a chart of time names round steps in one unit chosen by the largest value:
 * minutes up to two hours, hours up to four days, days past that, never «4 d 4 h». The steps
 * are counted by hand from that rule and «about four steps of 1, 2, 2.5 or 5 times a power of
 * ten, a whole number of the unit», and read through each locale's own catalog of span words.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import { timeMessages } from '@/shared/i18n/timeMessages.ts'
import { spanWordsOf } from '@/shared/lib/timeSpan.ts'
import { durationAxis } from '@/shared/ui/durationAxis.ts'

/** The axis of a chart in hours, in a locale's words. */
function axisIn(locale: 'en' | 'ru') {
  const i18n = createI18n({ legacy: false, locale, messages: timeMessages })
  return durationAxis(spanWordsOf(i18n.global.t), 3600)
}

/** What the steps say, with the space that keeps a number with its unit read as a space. */
const said = (locale: 'en' | 'ru', largestHours: number) =>
  axisIn(locale)(largestHours).map((step) => step.text.replaceAll('\u{A0}', ' '))

const values = (largestHours: number) => axisIn('en')(largestHours).map((step) => step.value)

describe('the value axis of a chart of time', () => {
  it.each([
    ['50 min', 50 / 60, ['0', '20 min', '40 min', '60 min'], ['0', '20 мин', '40 мин', '60 мин']],
    ['5 h', 5, ['0', '2 h', '4 h', '6 h'], ['0', '2 ч', '4 ч', '6 ч']],
    ['30 h', 30, ['0', '10 h', '20 h', '30 h'], ['0', '10 ч', '20 ч', '30 ч']],
    ['95 h', 95, ['0', '25 h', '50 h', '75 h', '100 h'], ['0', '25 ч', '50 ч', '75 ч', '100 ч']],
    [
      '400 h',
      400,
      ['0', '5 d', '10 d', '15 d', '20 d'],
      ['0', '5 дн.', '10 дн.', '15 дн.', '20 дн.'],
    ],
  ])('at most %s reads in one unit', (_, largest, english, russian) => {
    expect(said('en', largest)).toEqual(english)
    expect(said('ru', largest)).toEqual(russian)
  })

  it('stands each step where its span is, in the chart’s hours', () => {
    expect(values(50 / 60)).toEqual([0, 1 / 3, 2 / 3, 1])
    expect(values(95)).toEqual([0, 25, 50, 75, 100])
    expect(values(400)).toEqual([0, 120, 240, 360, 480])
  })

  it('switches unit at two hours and at four days, by the largest value', () => {
    expect(said('en', 2).at(-1)).toBe('150 min')
    expect(said('en', 2.01).at(-1)).toBe('3 h')
    expect(said('en', 96).at(-1)).toBe('100 h')
    expect(said('en', 96.5).at(-1)).toBe('6 d')
  })

  it('counts whole units even under one step of each', () => {
    expect(said('en', 0.5 / 60)).toEqual(['0', '1 min'])
    expect(said('en', 0)).toEqual(['0'])
  })
})
