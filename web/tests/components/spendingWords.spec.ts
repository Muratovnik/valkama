import { defineComponent, h } from 'vue'

/**
 * How the Analytics page says a span of agent time and a period, held to the requirement: exactly
 * nothing reads «0 min», more than nothing and under a minute «under a minute», a minute «1 min»,
 * the same in a figure (cards, table, tiles) and on the chart's scale and in its hints, in both
 * languages; a period breaks only after its dash, never inside a date.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'

import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'

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
        // The chart's scale and hints say a column's hours.
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

/** Holds the clock at a moment, for what the words say of today. */
function at(moment: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(moment))
}

describe('a period shorter than a day', () => {
  // «Today» at 15:59 on 11 November at +03:00, and the same hours of yesterday it is compared with.
  const TODAY = ['2026-11-11T00:00:00+03:00', '2026-11-11T16:00:00+03:00'] as const
  const YESTERDAY = ['2026-11-10T00:00:00+03:00', '2026-11-10T16:00:00+03:00'] as const
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const [locale, today, yesterday] of [
    ['en', `00:00${NBSP}– 15:59`, `Nov${NBSP}10,${NBSP}00:00${NBSP}– 15:59`],
    ['ru', '00:00–15:59', `10${NBSP}нояб.,${NBSP}00:00–15:59`],
  ] as const)
    it(`is named by its clock times today, and by its day too on another (${locale})`, () => {
      at('2026-11-11T15:59:30+03:00')
      const words = wordsIn(locale)
      expect(words.period(...TODAY)).toBe(today)
      expect(words.period(...YESTERDAY)).toBe(yesterday)
    })

  it('takes today at its own offset, not the browser’s day in UTC', () => {
    // Half past midnight at +03:00 is still the evening before in UTC.
    at('2026-11-11T00:30:00+03:00')
    expect(wordsIn('en').period(TODAY[0], '2026-11-11T00:31:00+03:00')).toBe(`00:00${NBSP}– 00:30`)
  })

  it('names both days of an hour across midnight', () => {
    at('2026-11-11T00:30:00+03:00')
    expect(wordsIn('ru').period('2026-11-10T23:30:00+03:00', '2026-11-11T00:30:00+03:00')).toBe(
      `10${NBSP}нояб.,${NBSP}23:30${NBSP}– 11${NBSP}нояб.,${NBSP}00:29`,
    )
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

  it('leaves the hints and the table their day in full', () => {
    expect(wordsIn('ru').stepName(WEDNESDAY, 'day').fullLabel).toBe('среда, 11 ноября')
  })

  // Every chart that names its days by `stepName` can say on its axis where a month starts.
  it('gives a day its date with the month and which month that is; an hour none', () => {
    expect(wordsIn('en').stepName(WEDNESDAY, 'day').dated).toEqual({
      label: 'Nov 11',
      month: '2026-11',
    })
    expect(wordsIn('ru').stepName(WEDNESDAY, 'day').dated).toEqual({
      label: '11 нояб.',
      month: '2026-11',
    })
    expect(wordsIn('en').stepName('2026-11-11T14:00:00+03:00', 'hour')).not.toHaveProperty('dated')
  })

  // The bar's newest record of an earlier day: as short as a period names that day's hours.
  it('names a moment of another day by its date with the month and its clock time', () => {
    expect(wordsIn('en').datedClock('2026-11-10T20:05:00+03:00')).toBe('Nov 10, 20:05')
    expect(wordsIn('ru').datedClock('2026-11-10T20:05:00+03:00')).toBe('10 нояб., 20:05')
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
/** An account of that organization, by its id and the time of week its week resets. */
const seat = (tail: string, weekly_reset: string | null, shared = false) => ({
  id: `${account.id}/${tail}`,
  unknown: false,
  organization: account.id,
  account_uuid: tail.startsWith('weekly:') || tail === '' ? null : tail,
  weekly_reset,
  shared,
})
const UUID = 'a1a1a1a1-2222-4333-8444-555566667777'

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

  it('names an organization by the owner’s name for it, and leaves its whole id out of any hint', () => {
    const words = wordsIn('ru')
    expect(words.valueLabel('account', account)).toBe('f0f0f0f0')
    useAccountNamesStore().names = { [account.id]: 'Основной' }
    expect(words.valueLabel('account', account)).toBe('Основной')
    // The whole id is copied from the account's menu in the quota panel, never read in a hint.
    expect(words.valueDetail('account', account)).toBeUndefined()
  })

  it('names an account by its own name, else its weekly reset’s, else its organization and its UUID’s start', () => {
    const words = wordsIn('en')
    const known = seat(UUID, '4T09:00Z')
    expect(words.valueLabel('seat', known)).toBe('a1a1a1a1')
    useAccountNamesStore().names = { [account.id]: 'Lab' }
    expect(words.valueLabel('seat', known)).toBe('Lab · a1a1a1a1')
    // The name its weekly reset was given before its UUID was known carries over to it.
    useAccountNamesStore().names = {
      [account.id]: 'Lab',
      [`${account.id}/weekly:4T09:00Z`]: 'Desk',
    }
    expect(words.valueLabel('seat', known)).toBe('Desk')
    useAccountNamesStore().names = {
      [`${account.id}/weekly:4T09:00Z`]: 'Desk',
      [known.id]: 'Own',
    }
    expect(words.valueLabel('seat', known)).toBe('Own')
    expect(words.valueDetail('seat', known)).toBeUndefined()
  })

  it('names an account known by its weekly reset by its organization and when its week resets, in local time', () => {
    vi.stubEnv('TZ', 'Europe/Berlin')
    try {
      useAccountNamesStore().names = { [account.id]: 'Lab' }
      const weekly = seat('weekly:4T09:00Z', '4T09:00Z')
      expect(wordsIn('en').valueLabel('seat', weekly)).toBe('Lab · resets Thu 10:00')
      expect(wordsIn('ru').valueLabel('seat', weekly)).toBe('Lab · сброс чт 10:00')
      // Past midnight local time its week resets on the next day.
      expect(wordsIn('en').valueLabel('seat', seat('weekly:7T23:30Z', '7T23:30Z'))).toBe(
        'Lab · resets Mon 00:30',
      )
      useAccountNamesStore().names = { [weekly.id]: 'Desk' }
      expect(wordsIn('en').valueLabel('seat', weekly)).toBe('Desk')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('names work on no known account by its organization, and says an account may be two', () => {
    const words = wordsIn('en')
    expect(words.valueLabel('seat', seat('', null))).toBe('f0f0f0f0 · account not known')
    expect(words.valueLabel('seat', { id: null, unknown: true })).toBe('Unknown')
    useAccountNamesStore().names = { [`${account.id}/weekly:4T09:00Z`]: 'Desk' }
    expect(words.valueLabel('seat', seat('weekly:4T09:00Z', '4T09:00Z', true))).toBe(
      'Desk · may be two accounts',
    )
  })

  it('says a change of accounts by their names', () => {
    const words = wordsIn('ru')
    useAccountNamesStore().names = { [`${account.id}/${UUID}`]: 'Основной' }
    const known = seat(UUID, '4T09:00Z')
    const other = seat('b7b7b7b7-0000-4000-8000-000000000000', '1T09:00Z')
    expect(words.accounts([known], [known, other])).toBe(
      'Смена аккаунта: Основной → Основной, b7b7b7b7',
    )
  })

  it('names an account the owner left unnamed by the start of its id', () => {
    useAccountNamesStore().names = { other: 'Other' }
    const words = wordsIn('en')
    expect(words.valueLabel('account', account)).toBe('f0f0f0f0')
    expect(words.valueDetail('account', account)).toBeUndefined()
  })
})
