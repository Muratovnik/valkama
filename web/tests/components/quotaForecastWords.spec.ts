import { defineComponent, h } from 'vue'

/**
 * How a quota window's forecast is said in its facts line, held to the requirement rather than to
 * the code: a quota cannot pass 100 %, so a week's range is never said past it. A range whose low
 * end reaches 100 % says the window runs out before the reset, and about when, where the slower
 * pace gives a time; a range that crosses 100 % says it may run out before the reset; a range whose
 * ends are said alike says one value; any other range is said as a range, in both languages.
 *
 * The time is the contract's own arithmetic: the slower pace runs from the window's share at the
 * answer's moment to the low end at its reset, so it reaches 100 % that share of the way along. A
 * week says it by its day and the part of the day (DESIGN.md § Analytics): night from 0 to 6,
 * morning to 12, day to 18, evening to midnight, at the answer's offset; five hours keep the clock
 * time.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'

import type { QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { analyticsI18n } from '../support/analyticsReads.ts'

const HOUR = 3_600_000
/** What the probe renders: nothing, it only holds the words. */
const blank = () => h('span')
/** The answer's moment, written at Moscow's offset as the read writes it. */
const TODAY = '2026-11-11T10:00:00.000+03:00'

function wordsIn(locale: 'en' | 'ru') {
  let words: ReturnType<typeof useQuotaWords> | undefined
  mount(
    defineComponent({
      setup() {
        words = useQuotaWords()
        return blank
      },
    }),
    { global: { plugins: [analyticsI18n(locale)] } },
  )
  if (!words) throw new Error('no words')
  return words
}

/** An instant as the read writes it, at the answer's offset. */
const at = (ms: number) => `${new Date(ms + 3 * HOUR).toISOString().slice(0, 23)}+03:00`

/** A week with `used` % spent at the answer's moment, its reset `left` ms on, and its range. */
function week(used: number, left: number, low: number, high: number): QuotaShareWindow {
  const now = Date.parse(TODAY)
  return {
    kind: 'week',
    model: null,
    state: 'fresh',
    resets_at: at(now + left),
    latest: { at: TODAY, used_percent: used, source: 'statusline' },
    started_at: at(now + left - 168 * HOUR),
    even_percent: null,
    readings: [],
    restarts: [],
    forecast: { low_percent: low, high_percent: high },
  }
}

/** Words as a reader reads them: a figure and its unit are kept together with a no-break space. */
const plain = (text: string) => text.replaceAll('\u{A0}', ' ')
const said = (locale: 'en' | 'ru', window: QuotaShareWindow) =>
  plain(wordsIn(locale).forecast(window, TODAY))

describe('a week’s forecast that reaches 100 %', () => {
  it('says the window runs out before the reset, and about when at the slower pace', () => {
    // 80 % now, 180 % by a reset ten hours on: the slower pace adds 10 % an hour, so 100 % at 12:00,
    // the first minute of the day's afternoon.
    const window = week(80, 10 * HOUR, 180, 200)
    expect(said('en', window)).toBe('Limit runs out before the reset, by the afternoon of Nov 11')
    expect(said('ru', window)).toBe('Лимит закончится до сброса, примерно к середине дня 11 нояб.')
  })

  it('names the day of a time on another day, and never a share past 100 %', () => {
    // The review's account: 79 % used, 4 d 14 h left, 212 % to 229 % by the reset. The slower pace
    // spends 21 of its 133 points by 21/133 of 110 hours: 17 h 22 min on, 03:22 on 12 November.
    // That is the night before the 12th, said with no minute.
    const window = week(79, (4 * 24 + 14) * HOUR, 212, 229)
    expect(said('en', window)).toBe('Limit runs out before the reset, by the night before Nov 12')
    expect(said('ru', window)).toBe('Лимит закончится до сброса, примерно к ночи на 12 нояб.')
  })

  it('says only that it runs out before the reset where the pace gives no time', () => {
    // The reset is already behind the answer's moment, so no stretch is left to place a time in.
    const window = week(80, -HOUR, 120, 140)
    expect(said('en', window)).toBe('Limit runs out before the reset')
    expect(said('ru', window)).toBe('Лимит закончится до сброса')
  })

  it('says a window already spent is spent, as the five hours do', () => {
    const window = week(100, 48 * HOUR, 100, 100)
    expect(said('en', window)).toBe('Spent')
    expect(said('ru', window)).toBe('Израсходовано')
  })
})

describe('a week’s forecast that crosses 100 %', () => {
  it('says the window may run out before the reset, with no share past 100 %', () => {
    const window = week(60, 48 * HOUR, 97.5, 104.2)
    expect(said('en', window)).toBe('By the reset: 98% or more — the limit may run out')
    expect(said('ru', window)).toBe('К сбросу: 98 % и больше — лимит может закончиться')
  })
})

describe('a week’s forecast whose ends are alike', () => {
  it('says one value, for ends equal and for ends said alike', () => {
    expect(said('en', week(0, 48 * HOUR, 0, 0))).toBe('By the reset: 0%')
    expect(said('ru', week(0, 48 * HOUR, 0, 0))).toBe('К сбросу: 0 %')
    expect(said('en', week(40, 48 * HOUR, 56.93, 57.2))).toBe('By the reset: 57%')
  })
})

describe('a week’s forecast below 100 %', () => {
  it('is said as a range', () => {
    const window = week(41, 48 * HOUR, 56.93, 61.2)
    expect(said('en', window)).toBe('By the reset: 57% to 61%')
    expect(said('ru', window)).toBe('К сбросу: от 57 % до 61 %')
  })
})

describe('a restart of a window’s count', () => {
  it('is said as the fact, with its moment and the reset that did not move, in both languages', () => {
    // A week resetting in two days, its count restarted at 09:00 on the answer's day.
    const restarted = { ...week(5, 48 * HOUR, 20, 30), restarts: ['2026-11-11T09:00:00.000+03:00'] }
    for (const [locale, name, reset] of [
      ['en', 'Counter zeroed', 'Window reset time unchanged: '],
      ['ru', 'Счётчик обнулён', 'Время сброса окна не изменилось: '],
    ] as const) {
      const [restart, ...more] = wordsIn(locale).restarts(restarted, TODAY)
      expect(more).toHaveLength(0)
      expect(restart).toMatchObject({ name, figure: '09:00', timeText: '09:00', key: 'restart-0' })
      expect(restart?.at).toBe(Date.parse('2026-11-11T06:00:00.000Z'))
      expect(restart?.notes).toHaveLength(1)
      // The reset two days on, said with its day as every moment off the answer's day is.
      expect(restart?.notes[0]?.startsWith(reset)).toBe(true)
      expect(restart?.notes[0]).toMatch(/13.*10:00$/u)
    }
    expect(wordsIn('en').restarts(week(5, 48 * HOUR, 20, 30), TODAY)).toEqual([])
  })
})

/** When a window of `kind` runs out at `moment`, said against the answer's moment; `short` for a tile. */
const runOut = (
  locale: 'en' | 'ru',
  kind: QuotaShareWindow['kind'],
  moment: string,
  short = false,
) =>
  plain(
    wordsIn(locale).runOutWords(
      { ...week(50, 48 * HOUR, 120, 130), kind },
      Date.parse(moment),
      TODAY,
      short,
    ),
  )

describe('when a window runs out', () => {
  it('says a week by its day and the part of the day it falls in, at each edge of a part', () => {
    const cases = [
      ['2026-11-24T00:00:00.000+03:00', 'by the night before Nov 24', 'к ночи на 24 нояб.'],
      ['2026-11-24T05:59:00.000+03:00', 'by the night before Nov 24', 'к ночи на 24 нояб.'],
      ['2026-11-24T06:00:00.000+03:00', 'by the morning of Nov 24', 'к утру 24 нояб.'],
      ['2026-11-24T11:59:00.000+03:00', 'by the morning of Nov 24', 'к утру 24 нояб.'],
      ['2026-11-24T12:00:00.000+03:00', 'by the afternoon of Nov 24', 'к середине дня 24 нояб.'],
      ['2026-11-24T17:59:00.000+03:00', 'by the afternoon of Nov 24', 'к середине дня 24 нояб.'],
      ['2026-11-24T18:00:00.000+03:00', 'by the evening of Nov 24', 'к вечеру 24 нояб.'],
      ['2026-11-24T23:59:00.000+03:00', 'by the evening of Nov 24', 'к вечеру 24 нояб.'],
    ] as const
    for (const [moment, en, ru] of cases) {
      expect(runOut('en', 'week', moment), moment).toBe(en)
      expect(runOut('ru', 'week', moment), moment).toBe(ru)
      expect(runOut('ru', 'week_model', moment), moment).toBe(ru)
    }
  })

  it('takes the part of the day at the answer’s offset, not at the moment’s own', () => {
    // 15:30 UTC is 18:30 at the answer's +03:00: its evening, though UTC's afternoon.
    expect(runOut('en', 'week', '2026-11-24T15:30:00.000Z')).toBe('by the evening of Nov 24')
  })

  it('says a week by its day alone where a tile has no room for the part of the day', () => {
    expect(runOut('en', 'week', '2026-11-24T23:59:00.000+03:00', true)).toBe('~Nov 24')
    expect(runOut('ru', 'week_model', '2026-11-24T00:00:00.000+03:00', true)).toBe('~24 нояб.')
    // Five hours keep their clock time, which is short already.
    expect(runOut('en', 'five_hour', '2026-11-11T14:05:00.000+03:00', true)).toBe('at 14:05')
  })

  it('keeps the clock time of five hours, with the date on another day than the answer’s', () => {
    expect(runOut('en', 'five_hour', '2026-11-11T14:05:00.000+03:00')).toBe('at 14:05')
    expect(runOut('ru', 'five_hour', '2026-11-11T14:05:00.000+03:00')).toBe('в 14:05')
    expect(runOut('en', 'five_hour', '2026-11-12T01:50:00.000+03:00')).toMatch(
      /^at Nov 12, 01:50$/u,
    )
  })
})
