/**
 * The period's three figures and how each moved from the period before. The oracle is the
 * requirement: time, tokens and a cost said to be an estimate at API prices and not a bill; a
 * change up, down, or nothing to compare with; tokens without a price said in words and never
 * drawn as a zero cost; and the tile pressed is the measure the charts below show.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'

import { momentAt, serveUsage, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

const NOW: Spent = { seconds: 5400, tokens: 1_200_000, cost: 12.5, unpriced: 0 }
const BEFORE = {
  from: momentAt(new Date(2026, 10, 2)),
  to: momentAt(new Date(2026, 10, 9)),
}

/** The 1.2M tokens of `NOW` by kind, beside ten times as many cache reads, which are apart. */
const SPLIT = {
  input: 600_000,
  output: 360_000,
  reasoning: 120_000,
  cache_write_5m: 200_000,
  cache_write_1h: 40_000,
  cached_read: 12_000_000,
}

function mountTiles(
  total: Spent,
  before: Spent | null,
  measure: Measure = 'time',
  locale: 'en' | 'ru' = 'en',
) {
  return mount(SpendingTiles, {
    props: { total, split: SPLIT, before: before ? { ...BEFORE, spent: before } : null, measure },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

const tile = (tiles: ReturnType<typeof mountTiles>, measure: Measure) => {
  const figure = tiles.get(`.tile-figure[data-measure="${measure}"]`)
  const segment = figure.element.closest('[role="radio"]')
  if (!segment) throw new Error(`no tile for ${measure}`)
  // The dates' range is set with the locale's own thin spaces; words are compared as words.
  const text = (segment.textContent ?? '').replaceAll(/\s/gu, ' ')
  return { figure: figure.text(), text, segment }
}

describe('the tiles', () => {
  it('show the agent time, the tokens and the cost as an estimate, not a bill', () => {
    const tiles = mountTiles(NOW, NOW)
    expect(tile(tiles, 'time').figure).toBe('1\u{A0}h\u{A0}30\u{A0}min')
    expect(tile(tiles, 'tokens').figure).toBe('1.2M')
    expect(tile(tiles, 'cost').figure).toBe('≈\u{A0}$12.50')
    expect(tile(tiles, 'cost').text).toContain('Estimated cost at API prices')
    expect(tile(tiles, 'cost').text).toContain('An estimate at API list prices, not a bill')
  })

  it('say how each figure moved: up, down, or the same, against the period before', () => {
    const tiles = mountTiles(NOW, { seconds: 3600, tokens: 2_400_000, cost: 12.5, unpriced: 0 })
    expect(tile(tiles, 'time').text).toContain('↑ 50% against Nov 2 – 8')
    expect(tile(tiles, 'tokens').text).toContain('↓ 50% against Nov 2 – 8')
    expect(tile(tiles, 'cost').text).toContain('The same as Nov 2 – 8')
  })

  it('give no percentage where the period before spent nothing or was not read', () => {
    const nothingBefore = mountTiles(NOW, { seconds: 0, tokens: null, cost: null, unpriced: 0 })
    for (const measure of ['time', 'tokens', 'cost'] as const) {
      expect(tile(nothingBefore, measure).text).toContain(
        'Nothing spent in Nov 2 – 8 to compare with',
      )
      expect(tile(nothingBefore, measure).text).not.toMatch(/%/)
    }
    // Not read is not nothing spent: the words say which.
    const notRead = mountTiles(NOW, null)
    expect(tile(notRead, 'time').text).toContain('The period before was not read')
    expect(tile(notRead, 'time').text).not.toContain('Nothing spent')
  })

  // Absent is not zero: work with no price, or no token counted, has no figure to compare.
  it('give no change where a figure is absent, and say which period has none', () => {
    const SPENT = { seconds: 3600, tokens: 1000, cost: 10, unpriced: 0 }
    const UNPRICED = { seconds: 3600, tokens: null, cost: null, unpriced: 500 }
    const noneNow = mountTiles(UNPRICED, SPENT)
    expect(tile(noneNow, 'cost').text).toContain(
      'No price for this period to compare with Nov 2 – 8',
    )
    expect(tile(noneNow, 'tokens').text).toContain(
      'No tokens counted in this period to compare with Nov 2 – 8',
    )
    const noneThen = mountTiles(SPENT, UNPRICED)
    expect(tile(noneThen, 'cost').text).toContain('No price for Nov 2 – 8 to compare with')
    expect(tile(noneThen, 'tokens').text).toContain(
      'No tokens counted in Nov 2 – 8 to compare with',
    )
    expect(tile(mountTiles(UNPRICED, UNPRICED), 'cost').text).toContain(
      'No price for this period or for Nov 2 – 8',
    )
    for (const tiles of [noneNow, noneThen])
      for (const measure of ['tokens', 'cost'] as const) {
        expect(tile(tiles, measure).text).not.toMatch(/%|Nothing spent/u)
        const change = tile(tiles, measure).segment.querySelector<HTMLElement>('.tile-change')
        expect(change?.dataset.direction).toBe('absent')
      }
    // Time is always counted: the same periods still compare.
    expect(tile(noneNow, 'time').text).toContain('The same as Nov 2 – 8')
    const ru = mountTiles(UNPRICED, SPENT, 'time', 'ru')
    expect(tile(ru, 'cost').text).toContain(
      'Для этого периода нет цены, сравнить с периодом 2–8 нояб. нельзя',
    )
  })

  // Each change names the period it is compared with in the case its preposition takes.
  it('say each change in Russian in the case its words take', () => {
    const moved = mountTiles(
      NOW,
      { seconds: 3600, tokens: 2_400_000, cost: 12.5, unpriced: 0 },
      'time',
      'ru',
    )
    expect(tile(moved, 'time').text).toContain('↑ 50 % к периоду 2–8 нояб.')
    expect(tile(moved, 'tokens').text).toContain('↓ 50 % к периоду 2–8 нояб.')
    expect(tile(moved, 'cost').text).toContain('Столько же, сколько за период 2–8 нояб.')
    const nothing = mountTiles(
      NOW,
      { seconds: 0, tokens: null, cost: null, unpriced: 0 },
      'time',
      'ru',
    )
    expect(tile(nothing, 'time').text).toContain(
      'За период 2–8 нояб. ничего не потрачено, сравнивать не с чем',
    )
    const notRead = mountTiles(NOW, null, 'time', 'ru')
    expect(tile(notRead, 'time').text).toContain(
      'Предыдущий период не прочитан, сравнивать не с чем',
    )
  })

  // What a token figure counts is not obvious: the tile says it, kind by kind.
  it('say what the tokens count, by kind, and the cache reads they leave apart', () => {
    const tokens = tile(mountTiles(NOW, NOW), 'tokens')
    expect(tokens.figure).toBe('1.2M')
    expect(tokens.text).toContain('Processed anew: input 600K, output 360K, cache writes 240K')
    expect(tokens.text).toContain('Cache reads, not counted: 12M')
    const ru = tile(mountTiles(NOW, NOW, 'time', 'ru'), 'tokens')
    expect(ru.text).toContain(
      'Обработано заново: ввод 600 тыс., вывод 360 тыс., запись в кэш 240 тыс.',
    )
    expect(ru.text).toContain('Чтение из кэша, не учтено: 12 млн')
  })

  // A period that spent nothing has a figure in every measure, and it is zero: what the words
  // for an absent figure say — no price, no tokens counted — is not true of it.
  it('show a period that spent nothing as zeros in their units, fallen from the period before', () => {
    const NOTHING = { seconds: 0, tokens: null, cost: null, unpriced: 0 }
    const tiles = mountTiles(NOTHING, { seconds: 3600, tokens: 1000, cost: 2, unpriced: 0 })
    expect(tile(tiles, 'time').figure).toBe('0\u{A0}min')
    expect(tile(tiles, 'tokens').figure).toBe('0')
    expect(tile(tiles, 'cost').figure).toBe('≈\u{A0}$0.00')
    for (const measure of ['time', 'tokens', 'cost'] as const) {
      expect(tile(tiles, measure).text).toContain('↓ 100% against Nov 2 – 8')
      expect(tile(tiles, measure).text).not.toMatch(/No time|No tokens|No price/u)
    }
    const ru = mountTiles(NOTHING, NOW, 'time', 'ru')
    expect(tile(ru, 'time').figure).toBe('0\u{A0}мин')
    expect(tile(ru, 'tokens').figure).toBe('0')
  })

  // A figure the read does not hold is named absent, and gives no change.
  it('name an absent price and absent tokens in words, with no change', () => {
    const tiles = mountTiles({ seconds: 3600, tokens: null, cost: null, unpriced: 500 }, NOW)
    expect(tile(tiles, 'tokens').figure).toBe('No tokens')
    expect(tile(tiles, 'cost').figure).toBe('No price')
    for (const measure of ['tokens', 'cost'] as const) {
      expect(tile(tiles, measure).text).not.toMatch(/%/u)
      const change = tile(tiles, measure).segment.querySelector<HTMLElement>('.tile-change')
      expect(change?.dataset.direction).toBe('absent')
    }
    expect(tile(tiles, 'time').figure).toBe('1\u{A0}h')
  })

  it('say tokens without a price in words, and never a zero cost', () => {
    const unpriced = mountTiles({ seconds: 60, tokens: 900, cost: null, unpriced: 57 }, null)
    const cost = tile(unpriced, 'cost')
    expect(cost.figure).toBe('No price')
    expect(cost.text).toContain('57 tokens without a price')
    expect(cost.text).not.toMatch(/\$\s*0/)
    const partly = mountTiles({ ...NOW, unpriced: 1 }, null)
    expect(tile(partly, 'cost').text).toContain('1 token without a price')
    expect(tile(mountTiles(NOW, null), 'cost').text).not.toContain('without a price')
  })

  it('are one choice of what the charts show: the pressed tile is the measure', async () => {
    const tiles = mountTiles(NOW, NOW, 'time')
    expect(tiles.get('[role="radiogroup"]').attributes('aria-label')).toBe('What the charts show')
    expect(tile(tiles, 'time').segment.getAttribute('aria-checked')).toBe('true')
    await tiles.get('.tile-figure[data-measure="cost"]').trigger('click')
    expect(tiles.emitted('update:measure')).toEqual([['cost']])
  })

  it('say the same in Russian', () => {
    const tiles = mountTiles(
      { seconds: 60, tokens: 900, cost: null, unpriced: 57 },
      NOW,
      'time',
      'ru',
    )
    const cost = tile(tiles, 'cost').text
    expect(cost).toContain('Оценка стоимости по ценам API')
    expect(cost).toContain('не счёт')
    expect(cost).toContain('57 токенов без цены')
    expect(tile(tiles, 'time').text).toContain('↓')
  })
})

const serve = (stretches: TimedStretch[]) =>
  stubAnalyticsReads((query) => serveUsage(stretches, query))

describe('the tiles on the page', () => {
  /** Wednesday afternoon: this week is Monday to now, held against the same days a week before. */
  const NOW = new Date(2026, 10, 11, 14, 30)
  const on = (day: number) => new Date(2026, 10, day, 10)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('read their figures from the total and the period before, and write the measure chosen', async () => {
    serve([
      {
        at: on(9),
        group: { work_item: task(1, 'One') },
        spend: { seconds: 3600, tokens: 500, cost: 1 },
      },
      {
        at: on(11),
        group: { work_item: task(2, 'Two') },
        spend: { seconds: 1800, tokens: 500, cost: 1 },
      },
      // The same days a week before: time and tokens, no price.
      { at: on(2), group: { work_item: task(1, 'One') }, spend: { seconds: 3600, tokens: 2000 } },
      // Later that week: not the same days, so not compared.
      { at: on(6), group: { work_item: task(1, 'One') }, spend: { seconds: 36_000, cost: 50 } },
    ])
    const page = await mountAnalytics()
    expect(page.get('.tile-figure[data-measure="time"]').text()).toBe('1\u{A0}h\u{A0}30\u{A0}min')
    expect(page.get('.tile-figure[data-measure="tokens"]').text()).toBe('1K')
    const radios = page.findAll('.spending-tiles [role="radio"]')
    expect(radios.map((radio) => radio.text().replaceAll(/\s/gu, ' '))).toEqual([
      expect.stringContaining('↑ 50% against Nov 2 – 4'),
      expect.stringContaining('↓ 50% against Nov 2 – 4'),
      // The week before had time and tokens but no price: no cost to compare, not nothing spent.
      expect.stringContaining('No price for Nov 2 – 4 to compare with'),
    ])
    await page.get('.tile-figure[data-measure="tokens"]').trigger('click')
    expect(page.emitted('state')?.at(-1)).toEqual([{ measure: 'tokens' }, 'replace'])
  })

  it('say what the period before spent when this one spent nothing, instead of standing empty', async () => {
    serve([{ at: on(2), group: { work_item: task(1, 'One') }, spend: { seconds: 3600, cost: 2 } }])
    const page = await mountAnalytics()
    expect(page.text()).not.toContain('Nothing was spent in this period')
    // This week's figures are real zeros, compared as such: the words for a figure the read does
    // not hold ("No time counted", "No price") are not true of them.
    const figure = (measure: Measure) => page.get(`.tile-figure[data-measure="${measure}"]`).text()
    expect(figure('time')).toBe('0\u{A0}min')
    expect(figure('tokens')).toBe('0')
    expect(figure('cost')).toBe('≈\u{A0}$0.00')
    const radios = page
      .findAll('.spending-tiles [role="radio"]')
      .map((radio) => radio.text().replaceAll(/\s/gu, ' '))
    expect(radios[0]).toContain('↓ 100% against Nov 2 – 4')
    // The week before counted no token: nothing to compare this week's zero with.
    expect(radios[1]).toContain('No tokens counted in Nov 2 – 4 to compare with')
    expect(radios[2]).toContain('↓ 100% against Nov 2 – 4')
  })
})

describe('the tiles across the spring change of time', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Europe/Berlin')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('name the period compared with by the days the read gave it', () => {
    expect(new Date(2026, 2, 23).getTimezoneOffset()).toBe(-60)
    const tiles = mount(SpendingTiles, {
      props: {
        total: NOW,
        split: SPLIT,
        before: {
          from: '2026-03-23T00:00:00+02:00',
          to: '2026-03-30T00:00:00+02:00',
          spent: NOW,
        },
        measure: 'time',
      },
      global: { plugins: [analyticsI18n()] },
    })
    expect(tile(tiles, 'time').text).toContain('The same as Mar 23 – 29')
  })
})

/**
 * The page at `now` over an hour this week and half an hour on the Tuesday of the week before:
 * the words of the first tile's change.
 */
async function tilesAt(now: string, thisWeek: string, weekBefore: string) {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(now) })
  serve([
    { at: new Date(thisWeek), group: { work_item: task(1, 'One') }, spend: { seconds: 3600 } },
    { at: new Date(weekBefore), group: { work_item: task(1, 'One') }, spend: { seconds: 1800 } },
  ])
  const page = await mountAnalytics()
  return { change: page.get('.spending-tiles .tile-change').text().replaceAll(/\s/gu, ' ') }
}

/**
 * This week against the same days of the week before, in a zone whose clock moves between the
 * two: Berlin leaves +02:00 for +01:00 on 25 October 2026 and goes back on 29 March. The zone is
 * pinned here, whatever the machine's, and each test first checks the offsets on either side.
 */
describe('the tiles on the page in the week after a change of time', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Europe/Berlin')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('name the week before by its own days after the autumn change', async () => {
    expect(new Date('2026-10-28T14:30:00+01:00').getTimezoneOffset()).toBe(-60)
    expect(new Date('2026-10-19T00:00:00+02:00').getTimezoneOffset()).toBe(-120)
    const { change } = await tilesAt(
      '2026-10-28T14:30:00+01:00',
      '2026-10-26T10:00:00+01:00',
      '2026-10-20T10:00:00+02:00',
    )
    expect(change).toBe('↑ 100% against Oct 19 – 21')
  })

  it('name the week before by its own days after the spring change, late in the evening', async () => {
    expect(new Date('2026-04-01T23:30:00+02:00').getTimezoneOffset()).toBe(-120)
    expect(new Date('2026-03-25T23:30:00+01:00').getTimezoneOffset()).toBe(-60)
    // Half past eleven: the same moment a week before is still Wednesday, an hour short of
    // Thursday at the offset of this week.
    const { change } = await tilesAt(
      '2026-04-01T23:30:00+02:00',
      '2026-03-30T10:00:00+02:00',
      '2026-03-24T10:00:00+01:00',
    )
    expect(change).toBe('↑ 100% against Mar 23 – 25')
  })
})
