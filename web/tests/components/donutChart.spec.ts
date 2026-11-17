/**
 * The ring of shares as a reader and a keyboard meet it. The oracle is the chart's contract: a
 * figure named by its label; a sector a part, in the hue its page gave the value, and past five
 * the smaller parts in one rest in the folded tail's neutral; a legend naming every part in the
 * ring's order, each with its figure and bare share at the end of its line, and no words on any
 * sector; the rows apart listed by name and figure outside the ring; one hint a sector, giving its
 * figure and share, and for the rest each part it holds; one Tab stop walked round the ring with
 * the arrows; a sector that opens something pressed with the pointer, Enter or Space; and a
 * legend entry pointed at or focused lifting its sector.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import DonutChart from '@/shared/ui/DonutChart.vue'
import type { DonutWords } from '@/shared/ui/DonutChart.vue'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

import { seriesEntries, seriesNames } from '../support/legend.ts'

const words: DonutWords = {
  empty: 'Nothing spent in this period.',
  rest: (count) => `Other, ${count} more`,
}

/** Agent time by effort in a made-up week: four levels, work with none, and a tail. */
const rows: RankedRow[] = [
  { key: 'low', label: 'low', value: 60, valueText: '60 min', slot: 3, actionable: true },
  { key: 'high', label: 'high', value: 250, valueText: '250 min', slot: 1, actionable: true },
  { key: 'medium', label: 'medium', value: 120, valueText: '120 min', slot: 2, actionable: true },
  { key: 'none', label: 'No effort', value: 20, valueText: '20 min', kind: 'none', slot: 'apart' },
  { key: 'max', label: 'max', value: 40, valueText: '40 min', slot: 4 },
  { key: 'xhigh', label: 'xhigh', value: 10, valueText: '10 min', slot: 5 },
]

const share = (ratio: number) => `${Math.round(ratio * 100)}% of the total`
const part = (ratio: number) => `${Math.round(ratio * 100)}%`
const minutes = (value: number) => `${value} min`

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const one of mounted.splice(0)) one.unmount()
})

function mountRing(given: readonly RankedRow[] = rows, attach = false) {
  const chart = mount(DonutChart, {
    props: {
      label: 'Agent time by effort',
      rows: given,
      words,
      formatValue: minutes,
      formatPart: part,
      formatShare: share,
    },
    ...(attach ? { attachTo: document.body } : {}),
  })
  mounted.push(chart)
  return chart
}

const sectors = (chart: ReturnType<typeof mountRing>) => chart.findAll('.donut-sector')
/** The key of the sector focus stands on. */
const focusedKey = () => (document.activeElement as SVGElement | null)?.dataset.key

describe('the ring of shares', () => {
  it('draws five sectors at most, largest first, the smaller past them one rest in the neutral', () => {
    const chart = mountRing()

    expect(chart.get('figure').attributes('aria-label')).toBe('Agent time by effort')
    // Six parts of 500 minutes: the four largest named, the rest of «No effort» and «xhigh».
    expect(
      sectors(chart).map((one) => [one.attributes('data-key'), one.attributes('data-slot')]),
    ).toEqual([
      ['high', '1'],
      ['medium', '2'],
      ['low', '3'],
      ['max', '4'],
      [' rest', 'other'],
    ])
    expect(seriesNames(chart)).toEqual(['high', 'medium', 'low', 'max', 'Other, 2 more'])
  })

  it('keeps each value in the hue its page gave it, a swatch in the legend the same', () => {
    const chart = mountRing(rows.slice(0, 3))

    expect(chart.get('[data-key="low"]').attributes('data-slot')).toBe('3')
    expect(chart.get('[data-series="low"] .chart-swatch').attributes('data-slot')).toBe('3')
  })

  it('gives each sector one hint: its name beside its hue, figure and share, and the rest’s parts', () => {
    const chart = mountRing()
    const high = tooltipOf(sectors(chart)[0]?.element as Element)
    const rest = tooltipOf(sectors(chart)[4]?.element as Element)

    expect(high?.kind).toBe('detail')
    expect(high?.text).toBe('250 min, 50% of the total')
    expect(high?.body).toEqual({
      head: { name: 'high', figure: '250 min', slot: 1 },
      rows: [],
      notes: ['50% of the total'],
    })
    // The rest's figure is no row's: it is the sum of its parts, 20 + 10, as the caller formats it.
    expect(rest?.body).toEqual({
      head: { name: 'Other, 2 more', figure: '30 min', slot: 'other' },
      rows: [
        { key: 'none', name: 'No effort', figure: '20 min', share: '4%' },
        { key: 'xhigh', name: 'xhigh', figure: '10 min', share: '2%' },
      ],
      notes: ['6% of the total'],
    })
  })

  it('gives each part its figure and bare share in the legend, and writes nothing on a sector', () => {
    const chart = mountRing()

    expect(
      seriesEntries(chart).map((one) => [
        one.get('[data-series]').text(),
        one.get('.chart-figure').text(),
      ]),
    ).toEqual([
      ['high', '250 min · 50%'],
      ['medium', '120 min · 24%'],
      ['low', '60 min · 12%'],
      ['max', '40 min · 8%'],
      // The rest's figure is the sum of its parts, as the caller formats it.
      ['Other, 2 more', '30 min · 6%'],
    ])
    // The legend prints them, so an entry's one hint is its name, whole while it is cut.
    expect(chart.get('[data-series="high"]').attributes('data-tooltip')).toBe('high')
    expect(chart.get('.donut-ring').text()).toBe('')
    expect(chart.find('text').exists()).toBe(false)
  })

  it('lifts the sector of a legend entry the pointer or the keyboard stands on', async () => {
    const chart = mountRing()
    const lifted = () =>
      sectors(chart)
        .filter((one) => one.attributes('data-lifted') !== undefined)
        .map((one) => one.attributes('data-key'))

    expect(lifted()).toEqual([])
    const medium = seriesEntries(chart)[1]
    await medium?.trigger('pointerenter')
    expect(lifted()).toEqual(['medium'])
    await medium?.trigger('pointerleave')
    expect(lifted()).toEqual([])
    await seriesEntries(chart)[4]?.trigger('focusin')
    expect(lifted()).toEqual([' rest'])
    await seriesEntries(chart)[4]?.trigger('focusout')
    expect(lifted()).toEqual([])
  })

  it('lists the rows apart under its legend by name and figure, and no sector for them', () => {
    const chart = mountRing([
      { key: 'input', label: 'Input', value: 3, valueText: '3M', slot: 1 },
      { key: 'output', label: 'Output', value: 1, valueText: '1M', slot: 4 },
      { key: 'cached_read', label: 'Cache read', value: 60, valueText: '60M', kind: 'other' },
    ])

    expect(sectors(chart).map((one) => one.attributes('data-key'))).toEqual(['input', 'output'])
    expect(chart.findAll('.donut-note').map((one) => one.text())).toEqual(['Cache read60M'])
    // The whole is the parts': the cache reads, twenty times it, set no share.
    expect(tooltipOf(sectors(chart)[0]?.element as Element)?.text).toBe('3M, 75% of the total')
  })

  it('is one stop for Tab, walked round the ring with the arrows, Home and End', async () => {
    const chart = mountRing(rows, true)
    const tabs = () => sectors(chart).map((one) => one.attributes('tabindex'))

    expect(tabs()).toEqual(['0', '-1', '-1', '-1', '-1'])
    await sectors(chart)[0]?.trigger('keydown', { key: 'ArrowLeft' })
    // Back past the first is the last: the ring has no end.
    expect(focusedKey()).toBe(' rest')
    expect(tabs()).toEqual(['-1', '-1', '-1', '-1', '0'])
    await sectors(chart)[4]?.trigger('keydown', { key: 'ArrowRight' })
    expect(focusedKey()).toBe('high')
    await sectors(chart)[0]?.trigger('keydown', { key: 'End' })
    expect(focusedKey()).toBe(' rest')
    await sectors(chart)[4]?.trigger('keydown', { key: 'Home' })
    expect(focusedKey()).toBe('high')
  })

  it('makes a sector that opens something a button, pressed by the pointer, Enter and Space', async () => {
    const chart = mountRing()
    const all = sectors(chart)
    const [high, max, rest] = [all[0], all[3], all[4]]

    expect(high?.attributes('role')).toBe('button')
    expect(high?.attributes('aria-label')).toBe('high')
    expect(max?.attributes('role')).toBe('img')
    expect(rest?.attributes('aria-label')).toBe('Other, 2 more')
    await high?.trigger('click')
    await high?.trigger('keydown', { key: 'Enter' })
    await high?.trigger('keydown', { key: ' ' })
    // A sector that only shows, and the rest, do nothing when pressed.
    await max?.trigger('click')
    await rest?.trigger('keydown', { key: 'Enter' })
    expect(chart.emitted('select')).toEqual([['high'], ['high'], ['high']])
    // Its legend entry opens it as well.
    await chart.get('[data-series="medium"]').trigger('click')
    expect(chart.emitted('select')?.at(-1)).toEqual(['medium'])
  })

  it('draws one value as the whole ring', () => {
    const chart = mountRing([rows[0] as RankedRow])

    expect(sectors(chart)).toHaveLength(1)
    expect(tooltipOf(sectors(chart)[0]?.element as Element)?.text).toBe('60 min, 100% of the total')
    expect(seriesNames(chart)).toEqual(['low'])
  })

  it('says there is nothing to split where no part is above zero', () => {
    const chart = mountRing([
      { key: 'low', label: 'low', value: 0, valueText: '0 min' },
      { key: 'high', label: 'high', value: Number.NaN, valueText: '—' },
    ])

    expect(chart.find('.donut-ring').exists()).toBe(false)
    expect(chart.get('[role="status"]').text()).toBe(words.empty)
    expect(mountRing([]).get('[role="status"]').text()).toBe(words.empty)
  })
})
