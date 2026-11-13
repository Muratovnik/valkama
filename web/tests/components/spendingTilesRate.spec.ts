/**
 * The figure per hour of agent time under the tokens and the cost. The oracle is the
 * requirement: the measure's figure over the hours of agent time it took, in the page's own
 * numbers, beside the period before's — «23,6 $/ч, было 11,4» — the cost's said to be an
 * estimate; no line where the period worked no time, and no «was» where there is no period
 * before or it worked no time. The totals are made up so that each rate comes out as one decimal
 * exactly: $23.6/h now, $11.4/h the week before.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import { perHour } from '@/pages/analytics/utils/panelAnswer.ts'

import { figuresAnswer, momentAt } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

const HOUR = 3600
const BEFORE = { from: momentAt(new Date(2026, 10, 2)), to: momentAt(new Date(2026, 10, 9)) }

/** $118 and 7 million tokens over five hours now; $228 and 13 million over twenty before. */
const NOW = { seconds: 5 * HOUR, cost: 118, tokens: 7_000_000 }
const WAS = { seconds: 20 * HOUR, cost: 228, tokens: 13_000_000 }

/** What a period spent, with no tokens left without a price. */
const spent = (spend: { cost: number | null; seconds: number; tokens: number | null }) => ({
  unpriced: 0,
  ...spend,
})

describe('a figure per hour of agent time', () => {
  it('is the figure over the hours it took, now and before', () => {
    expect(perHour('cost', spent(NOW), spent(WAS))).toEqual({ now: 23.6, was: 11.4 })
    // Other hours give the same ratios: $354 over fifteen hours, $28.50 over two and a half.
    const uneven = perHour(
      'cost',
      spent({ seconds: 15 * HOUR, cost: 354, tokens: null }),
      spent({ seconds: 2.5 * HOUR, cost: 28.5, tokens: null }),
    )
    expect(uneven?.now).toBeCloseTo(23.6, 10)
    expect(uneven?.was).toBeCloseTo(11.4, 10)
    expect(perHour('tokens', spent(NOW), spent(WAS))).toEqual({ now: 1_400_000, was: 650_000 })
  })

  it('is none without agent time, and has no «was» without a period before that worked', () => {
    const nothing = { seconds: 0, cost: 5, tokens: 1000, unpriced: 0 }
    expect(perHour('cost', nothing, { ...WAS, unpriced: 0 })).toBeNull()
    expect(perHour('cost', { ...NOW, unpriced: 0 }, null)).toEqual({ now: 23.6, was: null })
    expect(perHour('cost', { ...NOW, unpriced: 0 }, { ...nothing, cost: 3 })).toEqual({
      now: 23.6,
      was: null,
    })
    // No price is no figure to divide: no line, and no «was» from a period with none.
    expect(perHour('cost', { ...NOW, cost: null, unpriced: 40 }, null)).toBeNull()
    expect(perHour('cost', { ...NOW, unpriced: 0 }, { ...WAS, cost: null, unpriced: 40 })).toEqual({
      now: 23.6,
      was: null,
    })
  })
})

function mountTiles(
  total: Parameters<typeof figuresAnswer>[0],
  before: Parameters<typeof figuresAnswer>[0] | null,
  locale: 'en' | 'ru',
) {
  return mount(SpendingTiles, {
    props: {
      usage: figuresAnswer(total, before ? { ...BEFORE, spent: before } : undefined),
      readAt: new Date(2026, 10, 13, 15),
      measure: 'time',
    },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

/** The line per hour of a measure's cell, its words as a reader sees them, and its hint. */
function rateOf(tiles: ReturnType<typeof mountTiles>, measure: 'cost' | 'time' | 'tokens') {
  const cell = tiles
    .get(`.tile-figure[data-measure="${measure}"]`)
    .element.closest('[role="radio"]')
  const line = cell?.querySelector<HTMLElement>('.tile-rate')
  return {
    place: Boolean(line),
    text: (line?.textContent ?? '').replaceAll(/\s/gu, ' ').trim(),
    hint: line?.dataset.tooltip ?? '',
  }
}

describe('the line per hour under the tokens and the cost', () => {
  it('says the cost an hour beside the period before’s, as an estimate', () => {
    const ru = rateOf(mountTiles(NOW, WAS, 'ru'), 'cost')
    expect(ru.text).toBe('23,6 $/ч, было 11,4')
    expect(ru.hint).toMatch(/оценка/iu)
    const en = rateOf(mountTiles(NOW, WAS, 'en'), 'cost')
    expect(en.text).toBe('$23.6/h, was 11.4')
    expect(en.hint).toMatch(/estimate/iu)
  })

  it('says the tokens an hour the same way, and nothing an hour of time', () => {
    const tiles = mountTiles(NOW, WAS, 'ru')
    expect(rateOf(tiles, 'tokens').text).toBe('1,4 млн/ч, было 650 тыс.')
    expect(rateOf(mountTiles(NOW, WAS, 'en'), 'tokens').text).toBe('1.4M/h, was 650K')
    expect(rateOf(tiles, 'time').place).toBe(false)
  })

  it('has no «was» without a period before, or one that worked no time', () => {
    expect(rateOf(mountTiles(NOW, null, 'ru'), 'cost').text).toBe('23,6 $/ч')
    expect(rateOf(mountTiles(NOW, { seconds: 0, cost: 2 }, 'ru'), 'cost').text).toBe('23,6 $/ч')
  })

  it('keeps its place empty where the period worked no time', () => {
    const tiles = mountTiles({ seconds: 0, cost: 0, tokens: 0 }, WAS, 'ru')
    for (const measure of ['tokens', 'cost'] as const) {
      expect(rateOf(tiles, measure)).toEqual({ place: true, text: '', hint: '' })
    }
  })
})
