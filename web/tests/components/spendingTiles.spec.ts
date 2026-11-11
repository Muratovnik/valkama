/**
 * The period's three figures and how each moved from the period before. The oracle is the
 * requirement: time, tokens and a cost said to be an estimate at API prices and not a bill; a
 * change up, down, or nothing to compare with; tokens without a price said in words and never
 * drawn as a zero cost; and the tile pressed is the measure the charts below show.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'

import { task, usageAnswer } from '../fixtures/analytics.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

const NOW: Spent = { seconds: 5400, tokens: 1_200_000, cost: 12.5, unpriced: 0 }
const BEFORE = {
  from: new Date(2026, 10, 2).toISOString(),
  to: new Date(2026, 10, 9).toISOString(),
}

function mountTiles(
  total: Spent,
  before: Spent | null,
  measure: Measure = 'time',
  locale: 'en' | 'ru' = 'en',
) {
  return mount(SpendingTiles, {
    props: { total, before: before ? { ...BEFORE, spent: before } : null, measure },
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
    const notRead = mountTiles(NOW, null)
    expect(tile(notRead, 'time').text).toContain('Nothing spent in the period before')
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

describe('the tiles on the page', () => {
  it('read their figures from the total and the period before, and write the measure chosen', async () => {
    const monday = new Date(2026, 10, 9)
    stubAnalyticsReads(() =>
      usageAnswer({
        first: monday,
        days: 7,
        groupBy: ['work_item'],
        stretches: [
          {
            day: 0,
            group: { work_item: task(1, 'One') },
            spend: { seconds: 3600, tokens: 500, cost: 1 },
          },
          {
            day: 2,
            group: { work_item: task(2, 'Two') },
            spend: { seconds: 1800, tokens: 500, cost: 1 },
          },
        ],
        before: [
          { day: 0, group: { work_item: task(1, 'One') }, spend: { seconds: 3600, tokens: 2000 } },
        ],
      }),
    )
    const page = await mountAnalytics()
    await flushPromises()
    expect(page.get('.tile-figure[data-measure="time"]').text()).toBe('1\u{A0}h\u{A0}30\u{A0}min')
    expect(page.get('.tile-figure[data-measure="tokens"]').text()).toBe('1K')
    const radios = page.findAll('.spending-tiles [role="radio"]')
    expect(radios.map((radio) => radio.text())).toEqual([
      expect.stringContaining('↑ 50%'),
      expect.stringContaining('↓ 50%'),
      expect.stringContaining('Nothing spent in'),
    ])
    await page.get('.tile-figure[data-measure="tokens"]').trigger('click')
    expect(page.emitted('state')?.at(-1)).toEqual([{ measure: 'tokens' }])
  })
})
