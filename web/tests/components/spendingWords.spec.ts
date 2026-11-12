import { defineComponent, h } from 'vue'

/**
 * How the Analytics page says a span of agent time and a period, held to the requirement: exactly
 * nothing reads «0 min», more than nothing and under a minute «under a minute», a minute «1 min»,
 * the same in a figure (cards, table, tiles) and on the chart's scale (its readout), in both
 * languages; a period breaks only after its dash, never inside a date.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'

import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

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

describe('a day in a sentence', () => {
  // A day said in a sentence: Wednesday, 11 November, at the read's own offset.
  const WEDNESDAY = '2026-11-11T00:00:00+03:00'

  it('is its date first in Russian, so «за» takes no weekday in the nominative', () => {
    expect(wordsIn('ru').fullDay(WEDNESDAY)).toBe('11 ноября, ср')
  })

  it('reads in full in English', () => {
    expect(wordsIn('en').fullDay(WEDNESDAY)).toBe('Wednesday, November 11')
  })

  it('leaves the readout and the table their day in full', () => {
    expect(wordsIn('ru').stepName(WEDNESDAY, 'day').fullLabel).toBe('среда, 11 ноября')
  })
})

describe('a share of the whole', () => {
  for (const [locale, space] of [
    ['en', ''],
    ['ru', NBSP],
  ] as const)
    it(`says «100 %» for all of it only, and «0 %» for none only (${locale})`, () => {
      const words = wordsIn(locale)
      const said = (ratio: number) => words.share(ratio)
      expect(said(1)).toBe(`100${space}%`)
      // A share just short of the whole must not read «100 %».
      expect(said(0.997)).toBe(`>99${space}%`)
      expect(said(0.995)).toBe(`>99${space}%`)
      expect(said(0.994)).toBe(`99${space}%`)
      expect(said(0.5)).toBe(`50${space}%`)
      expect(said(0.005)).toBe(`1${space}%`)
      expect(said(0.003)).toBe(`<1${space}%`)
      expect(said(0)).toBe(`0${space}%`)
    })
})

/** A session of Claude Code as the read gives one, with the title its client gave it or none. */
const session = (title: string | null) => ({
  id: '1a2b3c4d-0000-4000-8000-000000000001',
  unknown: false,
  family: 'claude',
  opened_in: '',
  opened_host: '',
  title,
})
const account = { id: 'f0f0f0f0-1111-4222-8333-444455556666', unknown: false }

describe('the name of an executor and an account', () => {
  afterEach(() => localStorage.clear())

  it('names a session by its title and says its client and id start in the hint', () => {
    const words = wordsIn('en')
    expect(words.valueLabel('executor', session('Fix the rail'))).toBe('Fix the rail')
    expect(words.valueDetail('executor', session('Fix the rail'))).toBe('claude · 1a2b3c4d')
  })

  it('names a session with no title as before, with nothing left for the hint', () => {
    const words = wordsIn('en')
    expect(words.valueLabel('executor', session(null))).toBe('claude · 1a2b3c4d')
    expect(words.valueDetail('executor', session(null))).toBeUndefined()
  })

  it('names an account by the owner’s name for it, with its whole id in the hint', () => {
    const words = wordsIn('ru')
    expect(words.valueLabel('account', account)).toBe('f0f0f0f0')
    useSettingsStore().settings.accountAliases = { [account.id]: 'Основной' }
    expect(words.valueLabel('account', account)).toBe('Основной')
    expect(words.valueDetail('account', account)).toBe(account.id)
    expect(words.accounts([account], [account, { id: 'b7', unknown: false }])).toContain(
      'Основной → Основной, b7',
    )
  })

  it('names an account the owner left unnamed by the start of its id', () => {
    useSettingsStore().settings.accountAliases = { other: 'Other' }
    const words = wordsIn('en')
    expect(words.valueLabel('account', account)).toBe('f0f0f0f0')
    expect(words.valueDetail('account', account)).toBe(account.id)
    expect(words.valueDetail('account', { id: 'b7', unknown: false })).toBeUndefined()
  })
})
