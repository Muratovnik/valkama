import { defineComponent, h } from 'vue'

/**
 * How the Analytics page says a span of agent time and a period, held to the requirement: exactly
 * nothing reads «0 min», more than nothing and under a minute «under a minute», a minute «1 min»,
 * the same in a figure (cards, table, tiles) and on the chart's scale (its readout), in both
 * languages; a period breaks only after its dash, never inside a date.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'

import { analyticsI18n } from '../support/analyticsReads.ts'

/** What the probe renders: nothing, it only holds the words. */
const blank = () => h('span')

const NBSP = '\u{A0}'

function wordsIn(locale: 'en' | 'ru') {
  let words: ReturnType<typeof useSpendingWords> | undefined
  mount(
    defineComponent({
      setup() {
        words = useSpendingWords()
        return blank
      },
    }),
    { global: { plugins: [analyticsI18n(locale)] } },
  )
  if (!words) throw new Error('no words')
  return words
}

const spent = (seconds: number) => ({ seconds, tokens: null, cost: null, unpriced: 0 })

describe('a span of agent time', () => {
  for (const [locale, zero, under, minute] of [
    ['en', `0${NBSP}min`, 'under a minute', `1${NBSP}min`],
    ['ru', `0${NBSP}мин`, 'меньше минуты', `1${NBSP}мин`],
  ] as const)
    it(`reads one way as a figure and on the chart's scale (${locale})`, () => {
      const words = wordsIn(locale)
      for (const [seconds, said] of [
        [0, zero],
        [30, under],
        [60, minute],
      ] as const) {
        expect(words.figure('time', spent(seconds)), `${seconds} s`).toBe(said)
        // The readout says a column's hours.
        expect(words.scale('time', seconds / 3600), `${seconds} s`).toBe(said)
      }
    })
})

describe('a period', () => {
  it('breaks only after its dash, never inside a date', () => {
    const range = wordsIn('ru').period('2026-09-18T00:00:00Z', '2026-10-16T00:00:00Z')
    expect(range).toBe(`18${NBSP}сент.${NBSP}– 15${NBSP}окт.`)
    const english = wordsIn('en').period('2026-11-02T00:00:00Z', '2026-11-09T00:00:00Z')
    expect(english.split(' ')).toHaveLength(2)
    expect(english).toMatch(/–$|– /u)
    expect(english.split(' ')[0]).toMatch(/–$/u)
  })
})
