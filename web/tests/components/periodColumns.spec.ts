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
  hatch: 'in progress',
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

/** The same periods once the last is over: nothing on the plot is hatched. */
const finished = columns.map((column) => ({ ...column, incomplete: false }))

/** Each period a control that narrows to itself, as a chart of days is. */
const acting = columns.map((column) => ({ ...column, action: `Show ${column.fullLabel}` }))
/** `work` narrows the view to itself, `ci` is a task that leads to its card. */
const pressed: PeriodSeries[] = [
  { key: 'ci', label: 'ci', slot: 1, href: '/open/MAIN-1' },
  { key: 'work', label: 'work', slot: 2, actionable: true, action: 'Show the tasks of work' },
]

const marks: PeriodMark[] = [{ at: 'd3', label: 'Switched to work' }]

const hours = (value: number) => `${value} h`
const share = (ratio: number) => `${Math.round(ratio * 100)}% of the total`

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
  it('name each period with its sum and each series by name, one of them the Tab stop', () => {
    const chart = mountColumns()

    expect(chart.get('figure').attributes('aria-label')).toBe('Time per day')
    const images = chart.findAll('[role="img"]')
    expect(images.map((image) => image.attributes('aria-label'))).toEqual([
      'May 1: total 3 h; ci 2 h, work 1 h',
      'May 2: total 0 h',
      'May 3: total 3 h; work 3 h. Switched to work',
      'May 4: total 1 h so far; ci 1 h',
    ])
    expect(chart.findAll('button, a')).toHaveLength(0)
    // The keyboard stands on a period to read its hint: one stop, the latest period.
    expect(images.map((image) => image.attributes('tabindex'))).toEqual(['-1', '-1', '-1', '0'])
  })

  it('carries a legend for two series and none for one', () => {
    expect(
      mountColumns({ columns: finished })
        .findAll('.chart-key')
        .map((key) => key.text()),
    ).toEqual(['ci', 'work'])
    expect(
      mountColumns({ columns: finished, series: [series[0] as PeriodSeries] })
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

  it('hatches the running period, and the axis names it with no word under its name', () => {
    const chart = mountColumns()

    expect(chart.findAll('.period-incomplete')).toHaveLength(1)
    expect(chart.get('[data-key="d4"] .period-stack').classes()).toContain('period-incomplete')
    // Its segments are hatched, and only its: the hatch is a figure not final yet.
    expect(
      chart.findAll('.period-segment.hatched').map((one) => one.attributes('data-series')),
    ).toEqual(['ci'])
    expect(chart.get('.period-axis').text()).not.toContain('so far')
  })

  it('names the hatch in the legend while a running period is drawn, and only then', () => {
    const running = mountColumns()
    const key = running.get('.chart-key[data-series="hatch"]')
    expect(key.text()).toBe('in progress')
    expect(key.get('.chart-hatch').classes()).toContain('hatched')
    // The key only shows: no link, no button, no focus.
    expect(key.element.tagName).toBe('SPAN')
    expect(key.attributes('tabindex')).toBeUndefined()

    const over = mountColumns({ columns: finished })
    expect(over.find('.chart-key[data-series="hatch"]').exists()).toBe(false)
    expect(over.findAll('.hatched')).toHaveLength(0)
    // The legend is still there for its two series: the key is gone, not the legend.
    expect(over.findAll('.chart-key')).toHaveLength(2)
  })

  it('gives a single series a legend for the hatch alone while its period runs', () => {
    const one = [series[0] as PeriodSeries]
    expect(
      mountColumns({ series: one })
        .findAll('.chart-key')
        .map((key) => key.text()),
    ).toEqual(['ci', 'in progress'])
    const over = mountColumns({
      series: one,
      columns: finished,
    })
    expect(over.find('.chart-legend').exists()).toBe(false)
  })

  it('marks a change by a line in its period, says it in its hint and keeps no row for it', () => {
    const chart = mountColumns()

    expect(chart.findAll('.period-mark')).toHaveLength(1)
    expect(chart.find('[data-key="d3"] .period-mark').exists()).toBe(true)
    // No footnote under the chart, and no row of numbers over the plot.
    expect(chart.find('.period-notes').exists()).toBe(false)
    expect(chart.find('.period-markers').exists()).toBe(false)
    expect(chart.findAll('.period-plot > .chart-ticks')).toHaveLength(2)
    expect(chart.get('[data-cell="2:"]').attributes('data-tooltip')).toBe(
      'May 3: total 3 h\nSwitched to work\nwork 3 h',
    )
  })

  // A line over the plot cut a period of several series to an ellipsis and named no segment.
  it('stands no line of words over the plot', () => {
    const chart = mountColumns()

    expect(chart.find('.period-readout').exists()).toBe(false)
    expect(chart.findAll('figure > p')).toHaveLength(0)
    expect(chart.get('figure').element.children[1]?.classList.contains('period-frame')).toBe(true)
  })

  it('gives each period a hint of its sum, the period before and its series largest first', () => {
    const before = columns.map((column, index) => ({ ...column, before: index + 1 }))
    const chart = mountColumns({ columns: before, words: { ...words, before: 'before' } })
    const hint = chart.get('[data-cell="0:"]')

    expect(hint.attributes('data-tooltip-kind')).toBe('detail')
    expect(hint.attributes('data-tooltip')).toBe('May 1: total 3 h, before 1 h\nci 2 h\nwork 1 h')
    expect(chart.get('[data-cell="3:"]').attributes('data-tooltip')).toBe(
      'May 4: total 1 h so far, before 4 h\nci 1 h',
    )
  })

  // Each segment once had a hint of its own, and crossing a period swapped the period's for it.
  it('gives a period one hint, with each series’ share of it, and its segments none', () => {
    const chart = mountColumns({ formatShare: share })
    const slot = chart.get('[data-key="d1"]')
    const segments = slot.findAll('.period-segment')

    // The period's slot is one place for the pointer and the focus, its column the one hint.
    expect(slot.attributes()).toHaveProperty('data-tooltip-area')
    expect(slot.findAll('[data-tooltip]').map((one) => one.classes())).toEqual([['period-column']])
    expect(slot.get('.period-column').attributes('data-tooltip')).toBe(
      'May 1: total 3 h\nci 2 h, 67% of the total\nwork 1 h, 33% of the total',
    )
    expect(chart.get('[data-cell="3:"]').attributes('data-tooltip')).toBe(
      'May 4: total 1 h so far\nci 1 h, 100% of the total',
    )
    // A segment that leads nowhere is a block of hue, out of the reader's way.
    expect(segments.map((one) => one.attributes('aria-hidden'))).toEqual(['true', 'true'])
  })

  // What the segment's own hint said to a screen reader, its name now says.
  it('names a segment that acts with its share of the period, and gives it no hint', () => {
    const chart = mountColumns({ series: pressed, formatShare: share })
    const link = chart.get('[data-cell="0:0"]')

    expect(link.attributes('aria-label')).toBe('May 1: ci 2 h, 67% of the total, total 3 h')
    expect(chart.findAll('.period-segment[data-tooltip]')).toHaveLength(0)
  })

  it('gives each legend entry a hint of its series over the span and its share', () => {
    const chart = mountColumns({ columns: finished, formatShare: share })

    expect(chart.findAll('.chart-key').map((key) => key.attributes('data-tooltip'))).toEqual([
      '3 h, 43% of the total',
      '4 h, 57% of the total',
    ])
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
  it('make each period a button named by what it does, one of them the Tab stop: the latest', () => {
    const chart = mountColumns({ columns: acting })
    const buttons = chart.findAll('button.period-column')

    expect(buttons).toHaveLength(4)
    expect(buttons[0]?.attributes('aria-label')).toBe('Show May 1')
    expect(buttons.map((one) => one.attributes('tabindex'))).toEqual(['-1', '-1', '-1', '0'])
  })

  it('stop Tab on the period under way, not on a later one still to come', () => {
    // A day read by its hours at 15:30: the hour under way is the third, the fourth is to come.
    const under = acting.map((column, index) => ({ ...column, incomplete: index === 2 }))
    const chart = mountColumns({ columns: under })

    expect(chart.get('[data-cell="2:"]').attributes('tabindex')).toBe('0')
    expect(chart.findAll('[tabindex="0"]')).toHaveLength(1)
  })

  it('walk the periods with the arrows, Home and End, and keep the stop where the reader went', async () => {
    const chart = mountColumns({ columns: acting })
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

  it('send the period pressed, and nothing for a segment that leads nowhere', async () => {
    const chart = mountColumns({ columns: acting })

    await chart.get('[data-cell="2:"]').trigger('click')
    await chart.get('[data-key="d1"] .period-segment').trigger('click')
    expect(chart.emitted('period')).toEqual([['d3']])
    expect(chart.emitted('series')).toBeUndefined()
  })
})

describe('period columns whose series act', () => {
  it('make each segment of a series that acts its link or button, and the period apart', () => {
    const chart = mountColumns({ series: pressed })

    expect(chart.findAll('a.period-segment').map((one) => one.attributes('href'))).toEqual([
      '/open/MAIN-1',
      '/open/MAIN-1',
    ])
    const buttons = chart.findAll('button.period-segment')
    expect(buttons.map((one) => one.attributes('aria-label'))).toEqual([
      'Show the tasks of work',
      'Show the tasks of work',
    ])
    // The period is no control of its own, and no ancestor of one.
    expect(chart.findAll('[role="img"] a, [role="img"] button')).toHaveLength(0)
    expect(chart.findAll('[tabindex="0"]')).toHaveLength(1)
    expect(chart.get('[data-cell="3:"]').attributes('tabindex')).toBe('0')
  })

  it('climb from a period into its segments, and keep to the series sideways', async () => {
    const chart = mountColumns({ series: pressed })
    ;(chart.get('[data-cell="0:"]').element as HTMLElement).focus()
    await chart.get('[data-cell="0:"]').trigger('focus')

    await chart.get('[data-cell="0:"]').trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(focusedCell()).toBe('0:0')
    await chart.get('[data-cell="0:0"]').trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(focusedCell()).toBe('0:1')
    await chart.get('[data-cell="0:1"]').trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    // May 2 holds nothing, so the keyboard stands on the period itself.
    expect(focusedCell()).toBe('1:')
  })

  it('keep to the nearest segment that acts where the series is not in the next period', async () => {
    const chart = mountColumns({ series: pressed })
    ;(chart.get('[data-cell="0:1"]').element as HTMLElement).focus()
    await chart.get('[data-cell="0:1"]').trigger('focus')

    await chart.get('[data-cell="0:1"]').trigger('keydown', { key: 'End' })
    await nextTick()
    // May 4 holds ci alone, the segment below work's place.
    expect(focusedCell()).toBe('3:0')
    await chart.get('[data-cell="3:0"]').trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(focusedCell()).toBe('3:')
  })

  it('send the series pressed, on its segment or its legend entry, and follow a link', async () => {
    const chart = mountColumns({ series: pressed })

    await chart.get('[data-cell="0:1"]').trigger('click')
    await chart.get('button.chart-key[data-series="work"]').trigger('click')
    expect(chart.emitted('series')).toEqual([['work'], ['work']])
    await chart.get('[data-cell="0:0"]').trigger('click')
    await chart.get('a.chart-key[data-series="ci"]').trigger('click')
    expect(chart.emitted('follow')?.map(([key]) => key)).toEqual(['ci', 'ci'])
    expect(chart.emitted('period')).toBeUndefined()
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
    expect(table.findAll('button, a')).toHaveLength(0)
  })

  it('opens from the period name where periods open', async () => {
    const table = mountTable({ columns: acting })

    expect(table.findAll('button').map((one) => one.text())).toEqual([
      'May 1',
      'May 2',
      'May 3',
      'May 4',
    ])
    await table.findAll('button')[2]?.trigger('click')
    expect(table.emitted('period')).toEqual([['d3']])
  })

  it('acts from a figure the chart draws where its series acts, and from no zero', async () => {
    const table = mountTable({ series: pressed })
    const presses = table.findAll('.chart-press')

    expect(presses.map((one) => [one.element.tagName, one.attributes('data-series')])).toEqual([
      ['A', 'ci'],
      ['BUTTON', 'work'],
      ['BUTTON', 'work'],
      ['A', 'ci'],
    ])
    await presses[2]?.trigger('click')
    await presses[0]?.trigger('click')
    expect(table.emitted('series')).toEqual([['work']])
    expect(table.emitted('follow')?.map(([key]) => key)).toEqual(['ci'])
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
    expect(chart.get('[data-cell="1:"]').attributes('data-tooltip')).toBe(
      'May 2\nNo price: ci, work',
    )
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
