/**
 * The keys of the layers a chart draws beside its data, pressed in the legend. The oracle is the
 * owner's decision (DESIGN, Analytics, the legend's rule): the mark of the period compared with,
 * the line of a change, and on a step line its pace and its forecast are layers, each key a
 * toggle that a press turns off and on for every chart at once, pressed for assistive technology
 * while its layer shows; a layer turned off is not drawn and no hint, name or step of the scale
 * counts it, while its key stays and the data — the stacked series, the readings — is unchanged.
 * The hatch of a period still running, a step line's readings and its now are no layer, and their
 * keys do not act.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { PeriodColumn, PeriodMark, PeriodWords } from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import type { StepAhead } from '@/shared/ui/windowGeometry.ts'

import { HOUR, openLine, point, START } from '../support/stepLineMount.ts'

const words: PeriodWords = {
  total: 'total',
  incomplete: 'so far',
  hatch: 'in progress',
  period: 'Day',
  note: 'Note',
  empty: 'Nothing in this range.',
  before: 'period before',
  change: 'account change',
}

/**
 * Three days of two series, the last still running, against a period before of 7 h a day, which
 * stands far over this one's columns of 1 h to 3 h; the accounts changed at the second.
 */
const columns: PeriodColumn[] = [
  { key: 'd1', label: '1', fullLabel: 'May 1', values: { a: 1 }, before: 7 },
  { key: 'd2', label: '2', fullLabel: 'May 2', values: { a: 1, b: 2 }, before: 7 },
  { key: 'd3', label: '3', fullLabel: 'May 3', values: { b: 1 }, before: 7, incomplete: true },
]
const marks: PeriodMark[] = [{ at: 'd2', label: 'Account change: +B' }]

const mounted: { unmount: () => void }[] = []
beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  for (const one of mounted.splice(0)) one.unmount()
})

function mountDays() {
  const chart = mount(PeriodColumns, {
    attachTo: document.body,
    props: {
      label: 'Time per day',
      columns,
      series: [
        { key: 'a', label: 'a', slot: 1 },
        { key: 'b', label: 'b', slot: 2 },
      ],
      words,
      marks,
      formatValue: (value: number) => `${value} h`,
    },
  })
  mounted.push(chart)
  return chart
}

type Chart = ReturnType<typeof mountDays>

const legendKey = (chart: Chart, mark: string) =>
  chart.get(`[data-hint-list="legend"] [data-mark="${mark}"]`)
/** The figure at the top of the value axis, in hours. */
const top = (chart: Chart) =>
  Math.max(
    ...chart
      .findAll('[data-region="scale"] [data-key]')
      .map((tick) => Number.parseFloat(tick.text())),
  )
/** What each period holds, as its segments draw it: the series and each segment's height. */
const stacks = (chart: Chart) =>
  chart.findAll('[data-tooltip-area]').map((period) =>
    period.findAll('[data-series]').map((segment) => ({
      series: segment.attributes('data-series'),
      size: segment.attributes('style'),
    })),
  )
const names = (chart: Chart) =>
  chart.findAll('[data-tooltip-area] [role="img"]').map((period) => period.attributes('aria-label'))

describe('the keys of the layers of a period chart', () => {
  it('turns the period compared with off and on: its ticks, its words and its height on the scale go with it', async () => {
    const chart = mountDays()
    const key = legendKey(chart, 'outline')
    expect(key.element.tagName).toBe('BUTTON')
    expect(key.attributes('aria-pressed')).toBe('true')
    expect(chart.findAll('[data-region="field"] [data-mark="before"]')).toHaveLength(3)
    expect(top(chart)).toBeGreaterThanOrEqual(7)
    expect(names(chart)[0]).toContain('period before 7 h')
    const drawn = stacks(chart)
    expect(drawn.flat()).toHaveLength(4)

    await key.trigger('click')
    expect(legendKey(chart, 'outline').attributes('aria-pressed')).toBe('false')
    expect(legendKey(chart, 'outline').classes()).toContain('layer-key-off')
    expect(chart.findAll('[data-region="field"] [data-mark="before"]')).toHaveLength(0)
    // The tallest column is 3 h: nothing of the 7 h before holds the scale up any longer.
    expect(top(chart)).toBeGreaterThanOrEqual(3)
    expect(top(chart)).toBeLessThan(7)
    expect(names(chart).join(' ')).not.toContain('period before')
    // The data is the same: every segment of every period, each its share of its stack.
    expect(stacks(chart)).toEqual(drawn)

    await legendKey(chart, 'outline').trigger('click')
    expect(legendKey(chart, 'outline').attributes('aria-pressed')).toBe('true')
    expect(chart.findAll('[data-region="field"] [data-mark="before"]')).toHaveLength(3)
    expect(top(chart)).toBeGreaterThanOrEqual(7)
  })

  it('turns the line of a change off on every chart that draws it, and its words leave the period', async () => {
    const one = mountDays()
    const other = mountDays()
    expect(names(one)[1]).toContain('Account change: +B')
    await legendKey(one, 'change').trigger('click')
    for (const chart of [one, other]) {
      expect(legendKey(chart, 'change').attributes('aria-pressed')).toBe('false')
      expect(chart.findAll('[data-region="field"] [data-mark="change"]')).toHaveLength(0)
      expect(names(chart).join(' ')).not.toContain('Account change')
    }
    // Only the layer pressed: the period compared with still shows on both.
    expect(other.findAll('[data-region="field"] [data-mark="before"]')).toHaveLength(3)
    await legendKey(other, 'change').trigger('click')
    expect(one.findAll('[data-region="field"] [data-mark="change"]')).toHaveLength(1)
  })

  it('leaves the hatch’s key a key that does not act', async () => {
    const chart = mountDays()
    const hatch = legendKey(chart, 'hatch')
    expect(hatch.element.tagName).toBe('SPAN')
    expect(hatch.attributes('aria-pressed')).toBeUndefined()
    await hatch.trigger('click')
    expect(chart.findAll('.hatched').length).toBeGreaterThan(0)
    expect(legendKey(chart, 'outline').attributes('aria-pressed')).toBe('true')
    expect(legendKey(chart, 'change').attributes('aria-pressed')).toBe('true')
  })
})

/** Past a reading of 50 % three hours in: «now», and a corridor to 70 %–100 % by the reset. */
const AHEAD: StepAhead = {
  value: 50,
  now: { name: 'Now', figure: '50%', notes: [] },
  forecast: {
    name: 'Forecast by the reset',
    figure: '70%–100%',
    notes: [],
    high: [
      { at: START + 3 * HOUR, value: 50 },
      { at: START + 5 * HOUR, value: 100 },
    ],
    low: [
      { at: START + 3 * HOUR, value: 50 },
      { at: START + 5 * HOUR, value: 70 },
    ],
  },
}
const READ = [point('12:00', 1, 20), point('12:30', 1.5, 50)]

function mountLine() {
  const line = openLine(READ, START + 3 * HOUR, AHEAD)
  mounted.push(line)
  return line
}

type Line = ReturnType<typeof mountLine>

const headKey = (line: Line, key: string) => line.get(`[data-region="head"] [data-key="${key}"]`)
const places = (line: Line) =>
  line.findAll('[data-target]').map((place) => place.attributes('data-target'))

describe('the keys of the layers of a step line', () => {
  it('turns the pace off and on, on every line at once, the readings as they were', async () => {
    const one = mountLine()
    const other = mountLine()
    const readings = one.get('[data-mark="line"]').attributes('d')
    expect(headKey(one, 'even').element.tagName).toBe('BUTTON')
    expect(headKey(one, 'even').attributes('aria-pressed')).toBe('true')
    expect(one.findAll('[data-mark="even"]')).toHaveLength(1)

    await headKey(one, 'even').trigger('click')
    for (const line of [one, other]) {
      expect(headKey(line, 'even').attributes('aria-pressed')).toBe('false')
      expect(headKey(line, 'even').classes()).toContain('layer-key-off')
      expect(line.findAll('[data-mark="even"]')).toHaveLength(0)
    }
    expect(one.get('[data-mark="line"]').attributes('d')).toBe(readings)
    expect(one.findAll('[data-mark="corridor"]')).toHaveLength(1)

    await headKey(other, 'even').trigger('click')
    expect(one.findAll('[data-mark="even"]')).toHaveLength(1)
  })

  it('turns the forecast off: its corridor and its place go, «now» stays, and its key stays to turn it on', async () => {
    const line = mountLine()
    expect(places(line)).toEqual(['now', 'reset'])
    await headKey(line, 'ahead').trigger('click')
    expect(headKey(line, 'ahead').attributes('aria-pressed')).toBe('false')
    expect(line.findAll('[data-mark="corridor"]')).toHaveLength(0)
    expect(places(line)).toEqual(['now'])
    // With no corridor after it, «now» takes the pointer on to the plot's end.
    expect(line.get('[data-target="now"]').attributes('style')).toContain('inset-inline-end: 0')
    expect(line.findAll('[data-mark="now"]')).toHaveLength(1)
    expect(line.findAll('[data-mark="even"]')).toHaveLength(1)

    await headKey(line, 'ahead').trigger('click')
    expect(line.findAll('[data-mark="corridor"]')).toHaveLength(1)
    expect(places(line)).toEqual(['now', 'reset'])
  })

  it('leaves the readings’ key and now’s keys that do not act', async () => {
    const line = mountLine()
    const now = headKey(line, 'now')
    expect(now.element.tagName).toBe('SPAN')
    expect(now.attributes('aria-pressed')).toBeUndefined()
    await now.trigger('click')
    expect(line.findAll('[data-mark="now"]')).toHaveLength(1)
    expect(line.findAll('[data-region="head"] button')).toHaveLength(2)
  })
})
