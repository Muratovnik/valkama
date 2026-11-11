import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  PeriodColumn,
  PeriodMark,
  PeriodSeries,
  PeriodWords,
} from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'

const words: PeriodWords = {
  total: 'total',
  incomplete: 'so far',
  period: 'Day',
  note: 'Note',
  empty: 'No sessions in this range.',
}

const series: PeriodSeries[] = [
  { key: 'ci', label: 'ci', slot: 1 },
  { key: 'work', label: 'work', slot: 2 },
]

const columns: PeriodColumn[] = [
  { key: 'd1', label: '1', fullLabel: 'May 1', values: { ci: 2, work: 1 } },
  { key: 'd2', label: '2', fullLabel: 'May 2', values: {} },
  { key: 'd3', label: '3', fullLabel: 'May 3', values: { work: 3 } },
  { key: 'd4', label: '4', fullLabel: 'May 4', values: { ci: 1 }, incomplete: true },
]

const marks: PeriodMark[] = [{ at: 'd3', label: 'Switched to work' }]

const hours = (value: number) => `${value} h`

type Props = Partial<InstanceType<typeof PeriodColumns>['$props']>

const mounted: { unmount: () => void }[] = []
afterEach(() => {
  for (const one of mounted.splice(0)) one.unmount()
})

function mountColumns(props: Props = {}) {
  const chart = mount(PeriodColumns, {
    attachTo: document.body,
    props: { label: 'Time per day', columns, series, words, marks, formatValue: hours, ...props },
  })
  mounted.push(chart)
  return chart
}

const focusedCell = () => (document.activeElement as HTMLElement | null)?.dataset.cell

/**
 * The period chart, as a reader who does not see it meets it: a figure under its label, each
 * period a named image or control whose name says the whole stack in words, and one Tab stop
 * that the arrows walk from. The still-running period and a change at a period's start are
 * said in words, not only drawn.
 */
describe('period columns that open nothing', () => {
  it('name each period with its sum and each series by name, and offer no control', () => {
    const chart = mountColumns()

    expect(chart.get('figure').attributes('aria-label')).toBe('Time per day')
    const images = chart.findAll('[role="img"]')
    expect(images.map((image) => image.attributes('aria-label'))).toEqual([
      'May 1: total 3 h; ci 2 h, work 1 h',
      'May 2: total 0 h',
      'May 3: total 3 h; work 3 h. Switched to work',
      'May 4: total 1 h; ci 1 h. so far',
    ])
    expect(chart.findAll('button')).toHaveLength(0)
    expect(chart.findAll('[tabindex]')).toHaveLength(0)
  })

  it('carries a legend for two series and none for one', () => {
    expect(
      mountColumns()
        .findAll('.chart-key')
        .map((key) => key.text()),
    ).toEqual(['ci', 'work'])
    expect(
      mountColumns({ series: [series[0] as PeriodSeries] })
        .find('.chart-legend')
        .exists(),
    ).toBe(false)
  })

  it('stacks each period in the order of its series, with nothing drawn for a series it lacks', () => {
    const chart = mountColumns()

    expect(
      chart.findAll('[data-key="d1"] .period-segment').map((one) => one.attributes('data-series')),
    ).toEqual(['ci', 'work'])
    expect(chart.findAll('[data-key="d2"] .period-segment')).toHaveLength(0)
  })

  it('hatches the running period and names it so on the axis', () => {
    const chart = mountColumns()

    expect(chart.findAll('.period-incomplete')).toHaveLength(1)
    expect(chart.get('[data-key="d4"] .period-stack').classes()).toContain('period-incomplete')
    expect(chart.get('.period-axis').text()).toContain('so far')
  })

  it('marks a change at the start of its period and says it under the chart', () => {
    const chart = mountColumns()

    expect(chart.findAll('.period-mark')).toHaveLength(1)
    expect(chart.find('[data-key="d3"] .period-mark').exists()).toBe(true)
    expect(chart.get('.period-notes').text()).toBe('1May 3Switched to work')
    expect(chart.get('.period-markers').text()).toBe('1')
  })

  it('reads out the latest period until the pointer stands on another', async () => {
    const chart = mountColumns()

    expect(chart.get('.period-readout').text()).toBe('May 4: total 1 h; ci 1 h. so far')
    await chart.get('[data-key="d1"]').trigger('pointerenter')
    expect(chart.get('.period-readout').text()).toBe('May 1: total 3 h; ci 2 h, work 1 h')
  })

  it('starts its scale at zero', () => {
    const scale = mountColumns().findAll('.period-scale .chart-tick')
    expect(scale[0]?.text()).toBe('0 h')
  })

  it('says there is nothing in one status when there are no periods or no series', () => {
    expect(mountColumns({ columns: [] }).get('[role="status"]').text()).toBe(words.empty)
    expect(mountColumns({ series: [] }).find('.period-plot').exists()).toBe(false)
  })
})

describe('period columns whose periods open', () => {
  it('make each period a named button, one of them the Tab stop: the latest', () => {
    const chart = mountColumns({ actionable: 'column' })
    const buttons = chart.findAll('button.period-column')

    expect(buttons).toHaveLength(4)
    expect(buttons[0]?.attributes('aria-label')).toBe('May 1: total 3 h; ci 2 h, work 1 h')
    expect(buttons.map((one) => one.attributes('tabindex'))).toEqual(['-1', '-1', '-1', '0'])
  })

  it('walk the periods with the arrows, Home and End, and keep the stop where the reader went', async () => {
    const chart = mountColumns({ actionable: 'column' })
    const last = chart.get('[data-cell="3:"]')
    ;(last.element as HTMLElement).focus()

    await last.trigger('keydown', { key: 'ArrowLeft' })
    await nextTick()
    expect(focusedCell()).toBe('2:')
    await chart.get('[data-cell="2:"]').trigger('keydown', { key: 'Home' })
    await nextTick()
    expect(focusedCell()).toBe('0:')
    expect(chart.get('[data-cell="0:"]').attributes('tabindex')).toBe('0')
    expect(chart.get('[data-cell="3:"]').attributes('tabindex')).toBe('-1')
    await chart.get('[data-cell="0:"]').trigger('keydown', { key: 'End' })
    await nextTick()
    expect(focusedCell()).toBe('3:')
  })

  it('send the period pressed, with no series', async () => {
    const chart = mountColumns({ actionable: 'column' })

    await chart.get('[data-cell="2:"]').trigger('click')
    expect(chart.emitted('select')).toEqual([[{ column: 'd3', series: null }]])
  })
})

describe('period columns whose series open', () => {
  it('make each segment a named button and the periods around them nothing', () => {
    const chart = mountColumns({ actionable: 'segment' })

    expect(chart.findAll('button.period-column')).toHaveLength(0)
    expect(chart.findAll('[role="img"]')).toHaveLength(0)
    const segments = chart.findAll('button.period-segment')
    expect(segments).toHaveLength(4)
    expect(segments[1]?.attributes('aria-label')).toContain('work')
    expect(segments[1]?.attributes('aria-label')).toContain('1 h')
    expect(segments.filter((one) => one.attributes('tabindex') === '0')).toHaveLength(1)
    expect(chart.get('[data-cell="3:0"]').attributes('tabindex')).toBe('0')
  })

  it('climb the stack with up and down, and step over an empty period sideways', async () => {
    const chart = mountColumns({ actionable: 'segment' })
    ;(chart.get('[data-cell="0:0"]').element as HTMLElement).focus()
    await chart.get('[data-cell="0:0"]').trigger('focus')

    await chart.get('[data-cell="0:0"]').trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(focusedCell()).toBe('0:1')
    await chart.get('[data-cell="0:1"]').trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    // May 2 holds nothing; May 3 holds work alone.
    expect(focusedCell()).toBe('2:0')
  })

  it('send the period and the series pressed', async () => {
    const chart = mountColumns({ actionable: 'segment' })

    await chart.get('[data-cell="0:1"]').trigger('click')
    expect(chart.emitted('select')).toEqual([[{ column: 'd1', series: 'work' }]])
  })
})

const mountTable = (props: Props = {}) =>
  mount(PeriodColumnsTable, {
    props: { label: 'Time per day', columns, series, words, marks, formatValue: hours, ...props },
  })

describe('the period table', () => {
  it('holds every number the chart draws, a series with nothing in a period as zero', () => {
    const table = mountTable()

    expect(table.get('caption').text()).toBe('Time per day')
    expect(table.findAll('thead th').map((cell) => cell.text())).toEqual([
      'Day',
      'ci',
      'work',
      'total',
      'Note',
    ])
    expect(
      table.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['May 1', '2 h', '1 h', '3 h', ''],
      ['May 2', '0 h', '0 h', '0 h', ''],
      ['May 3', '0 h', '3 h', '3 h', 'Switched to work'],
      ['May 4', '1 h', '0 h', '1 h', 'so far'],
    ])
  })

  it('opens from the period name where periods open', async () => {
    const table = mountTable({ actionable: 'column' })

    expect(table.findAll('button').map((one) => one.text())).toEqual([
      'May 1',
      'May 2',
      'May 3',
      'May 4',
    ])
    await table.findAll('button')[2]?.trigger('click')
    expect(table.emitted('select')).toEqual([[{ column: 'd3', series: null }]])
  })

  it('opens from a figure the chart draws where series open, and from no zero', async () => {
    const table = mountTable({ actionable: 'segment' })
    const presses = table.findAll('button')

    expect(presses.map((one) => one.attributes('data-series'))).toEqual([
      'ci',
      'work',
      'work',
      'ci',
    ])
    await presses[2]?.trigger('click')
    expect(table.emitted('select')).toEqual([[{ column: 'd3', series: 'work' }]])
  })

  it('says there is nothing in the same words as the chart', () => {
    expect(mountTable({ columns: [] }).get('[role="status"]').text()).toBe(words.empty)
  })
})

/**
 * A figure nobody has, such as the cost of work with no price, is absent and not zero: the chart
 * draws nothing for it and says so in words, and the table reads it as a dash with those words
 * for a screen reader, while a day that spent nothing still reads as a zero.
 */
describe('a period with a series absent', () => {
  const absentWords: PeriodWords = { ...words, absent: 'No price' }
  const priced: PeriodColumn[] = [
    { key: 'd1', label: '1', fullLabel: 'May 1', values: { ci: 2 }, absent: ['work'] },
    { key: 'd2', label: '2', fullLabel: 'May 2', values: {}, absent: ['ci', 'work'] },
    { key: 'd3', label: '3', fullLabel: 'May 3', values: {} },
  ]
  const props = { columns: priced, words: absentWords, marks: [] }

  it('draws nothing for it and says it in words, the sum of what is drawn beside', () => {
    const chart = mountColumns(props)
    expect(chart.findAll('[role="img"]').map((image) => image.attributes('aria-label'))).toEqual([
      'May 1: total 2 h; ci 2 h. No price: work',
      'May 2. No price: ci, work',
      'May 3: total 0 h',
    ])
    expect(
      chart.findAll('.period-slot').map((slot) => slot.findAll('.period-segment').length),
    ).toEqual([1, 0, 0])
  })

  it('reads as a dash in the table, never as a zero, and a day that spent nothing as zero', () => {
    const rows = mountTable(props).findAll('tbody tr')
    // The dash is what the eye reads; its words are for a screen reader.
    const seen = rows.map((row) =>
      row.findAll('th, td').map((cell) => {
        const dash = cell.find('[aria-hidden="true"]')
        return dash.exists() ? dash.text() : cell.text()
      }),
    )
    expect(seen).toEqual([
      ['May 1', '2 h', '—', '2 h', 'No price: work'],
      ['May 2', '—', '—', '—', 'No price: ci, work'],
      ['May 3', '0 h', '0 h', '0 h', ''],
    ])
    expect(rows[1]?.findAll('.visually-hidden').map((words) => words.text())).toEqual([
      'No price',
      'No price',
      'No price',
    ])
  })
})
