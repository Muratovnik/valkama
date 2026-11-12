/**
 * The breakdown beside the period before, as one table. The oracle is the requirement, written
 * out by hand row by row: every value either period holds, none folded; this period's time,
 * tokens and estimated cost; the chosen measure before; its change by the tiles' rule — a figure
 * the read does not hold is said absent and gives no change, a period before that spent nothing
 * gives no percentage; a cost that leaves tokens out, and its change, say so in the bars' words;
 * largest first in the chosen measure, a tie by name; and a period before that was not read said
 * once, with this period alone. With the measure «tokens» each value's tokens by kind follow, as
 * the read reports them. A heading sorts by its column, the total of every column stands under
 * the rows, and a line under the table says how many rows it shows and in what order. Crossed
 * with a second dimension, each value has a column per leading value of it, «other» and the
 * total, from the read by both.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'
import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import type { CrossRead } from '@/pages/analytics/composables/useCrossRead.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'

import { noTask, task, unknownTask, usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

const ALPHA = task(1, 'Alpha')
const BETA = task(2, 'Beta')
const GAMMA = task(3, 'Gamma')

/**
 * This period: Alpha two hours, Beta an hour with no price, work on no task an hour, unknown
 * work a quarter of an hour with no token and no price. The period before: Alpha an hour, Gamma
 * half an hour (it worked only then), and work on no task the same as now.
 */
const NOW: Stretch[] = [
  { day: 0, group: { work_item: ALPHA }, spend: { seconds: 7200, tokens: 2000, cost: 1.5 } },
  {
    day: 1,
    group: { work_item: BETA },
    spend: { seconds: 3600, tokens: 500, cost: null, unpriced: 500 },
  },
  { day: 1, group: { work_item: noTask }, spend: { seconds: 3600, tokens: 100, cost: 0.1 } },
  { day: 2, group: { work_item: unknownTask }, spend: { seconds: 900 } },
]
const BEFORE: Stretch[] = [
  { day: 0, group: { work_item: ALPHA }, spend: { seconds: 3600, tokens: 1000, cost: 1 } },
  { day: 0, group: { work_item: GAMMA }, spend: { seconds: 1800, tokens: 300, cost: 0.2 } },
  { day: 1, group: { work_item: noTask }, spend: { seconds: 3600, tokens: 100, cost: 0.1 } },
]

const answer = (before: Stretch[] | null) =>
  usageAnswer({
    first: new Date(2026, 10, 9),
    days: 3,
    groupBy: ['work_item'],
    stretches: NOW,
    before,
  }).usage

/** A table that is not crossed, and may be crossed with any dimension. */
const UNCROSSED = { across: null, cross: { status: 'off' } as const, dimensions: [] }

function table(measure: Measure, before: Stretch[] | null = BEFORE, locale: 'en' | 'ru' = 'en') {
  return mount(SpendingTable, {
    props: { ...UNCROSSED, by: 'work_item', filters: {}, measure, usage: answer(before) },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** Each row as it reads: its name, then every cell in the order of the columns. */
const rows = (wrapper: ReturnType<typeof table>) =>
  wrapper.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => words(cell.text())))

const headings = (wrapper: ReturnType<typeof table>) =>
  wrapper.findAll('thead th').map((cell) => words(cell.text()))

describe('the breakdown beside the period before', () => {
  it('lists every value of both periods by time, each beside its time before', () => {
    const wrapper = table('time')
    expect(words(wrapper.get('h2').text())).toBe('Spending by task')
    expect(words(wrapper.get('caption').text())).toBe('Spending by task')
    expect(headings(wrapper)).toEqual([
      'Task',
      'Agent time',
      'Tokens',
      'Est. cost, API prices',
      'Before, Nov 6 – 8',
      'Change',
    ])
    expect(rows(wrapper)).toEqual([
      // In both periods: twice the time.
      ['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50', '1 h', '↑ 100%'],
      // Only now, tied with work on no task at an hour and named first.
      ['MAIN-2 Beta', '1 h', '500', '500 tokens without a price', '0 min', 'Nothing before'],
      ['No task', '1 h', '100', '≈ $0.10', '1 h', 'The same'],
      // Spent with no token and no price: both said absent, never zero.
      ['Unknown', '15 min', 'No tokens', 'No price', '0 min', 'Nothing before'],
      // Only before: this period's figures are nothing.
      ['MAIN-3 Gamma', '0 min', '0', '≈ $0.00', '30 min', '↓ 100%'],
    ])
    // Work with no task and work nobody can place are named apart, as the bars name them.
    expect(wrapper.findAll('tbody tr').map((row) => row.classes().includes('chart-rest'))).toEqual([
      false,
      false,
      true,
      true,
      false,
    ])
    expect(wrapper.find('.spending-table-note').exists()).toBe(false)
  })

  it('sorts by tokens and holds the tokens before, an absent figure last and with no change', () => {
    // After the change, the tokens of this period by kind: input, cache read, cache write for
    // five minutes and for an hour, output and the reasoning inside it; a kind no request
    // reported is a dash, never a zero.
    expect(rows(table('tokens'))).toEqual([
      [
        'MAIN-1 Alpha',
        '2 h',
        '2K',
        '≈ $1.50',
        '1K',
        '↑ 100%',
        '1K',
        '20K',
        '400',
        '—',
        '600',
        '200',
      ],
      [
        'MAIN-2 Beta',
        '1 h',
        '500',
        '500 tokens without a price',
        '0',
        'Nothing before',
        '250',
        '5K',
        '100',
        '—',
        '150',
        '50',
      ],
      ['No task', '1 h', '100', '≈ $0.10', '100', 'The same', '50', '1K', '20', '—', '30', '10'],
      ['MAIN-3 Gamma', '0 min', '0', '≈ $0.00', '300', '↓ 100%', '—', '—', '—', '—', '—', '—'],
      [
        'Unknown',
        '15 min',
        'No tokens',
        'No price',
        '0',
        'No tokens now',
        '—',
        '—',
        '—',
        '—',
        '—',
        '—',
      ],
    ])
    expect(headings(table('tokens')).slice(4)).toEqual([
      'Before, Nov 6 – 8',
      'Change',
      'Input',
      'Cache read',
      'Cache write, 5 min',
      'Cache write, 1 h',
      'Output',
      'Of it reasoning',
    ])
    expect(table('tokens').get('.spending-table-kinds').text()).toBe(
      'Tokens count input, output and cache writes; cache reads stand apart, and reasoning is part of output.',
    )
    expect(table('time').find('.spending-table-kinds').exists()).toBe(false)
  })

  it('totals every column under the rows, from the read’s own total', () => {
    const footer = (wrapper: ReturnType<typeof table>) =>
      wrapper.findAll('tfoot th, tfoot td').map((cell) => words(cell.text()))
    expect(footer(table('time'))).toEqual([
      'Total',
      '4 h 15 min',
      '2.6K',
      '≈ $1.60, 500 tokens without a price',
      '2 h 30 min',
      '↑ 70%',
    ])
    expect(footer(table('time', null))).toEqual([
      'Total',
      '4 h 15 min',
      '2.6K',
      '≈ $1.60, 500 tokens without a price',
    ])
  })

  it('sorts by the heading pressed, largest first and then the other way, and says how', async () => {
    const wrapper = table('time')
    // The line says how many values in a few words; its hint gives the whole account and the order.
    const line = (shown = wrapper) => shown.get('.spending-table-summary')
    const summary = () => words(line().attributes('data-tooltip') ?? '')
    const names = () => rows(wrapper).map((row) => row[0])
    // Alpha and Beta spent now, Gamma only before; work on no task and unknown work spent now.
    expect(words(line().text())).toBe('2 tasks · 1 outside the period')
    expect(summary()).toBe(
      '2 in the period · 1 only before · and «No task», «Unknown», sorted by «Agent time», largest first',
    )
    expect(wrapper.get('thead th:nth-child(2)').attributes('aria-sort')).toBe('descending')
    expect(words(line(table('time', BEFORE, 'ru')).text())).toBe('2 задачи · 1 вне периода')

    // The time before: Alpha, no task, Gamma, then the two that spent nothing before, in the
    // order the table had them.
    await wrapper.get('thead th:nth-child(5) button').trigger('click')
    expect(names()).toEqual(['MAIN-1 Alpha', 'No task', 'MAIN-3 Gamma', 'MAIN-2 Beta', 'Unknown'])
    expect(summary()).toMatch(/, sorted by «Before, Nov 6 – 8», largest first$/u)
    await wrapper.get('thead th:nth-child(5) button').trigger('click')
    expect(names()).toEqual(['MAIN-2 Beta', 'Unknown', 'MAIN-3 Gamma', 'MAIN-1 Alpha', 'No task'])
    expect(wrapper.get('thead th:nth-child(5)').attributes('aria-sort')).toBe('ascending')
    expect(wrapper.get('thead th:nth-child(2)').attributes('aria-sort')).toBeUndefined()

    // A cost with no figure sorts after every figure, whichever way the column runs.
    await wrapper.get('thead th:nth-child(4) button').trigger('click')
    expect(names().slice(-2)).toEqual(['MAIN-2 Beta', 'Unknown'])
    await wrapper.get('thead th:nth-child(4) button').trigger('click')
    expect(names().slice(-2)).toEqual(['MAIN-2 Beta', 'Unknown'])

    // The names from A, then from Z.
    await wrapper.get('thead th:nth-child(1) button').trigger('click')
    expect(names()).toEqual(['MAIN-1 Alpha', 'MAIN-2 Beta', 'MAIN-3 Gamma', 'No task', 'Unknown'])
    expect(summary()).toMatch(/^2 in the period · 1 only before · .*, sorted by «Task», A to Z$/u)
  })

  it('sorts by cost, with the values that have no price last and in the order of their names', () => {
    expect(rows(table('cost'))).toEqual([
      ['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50', '≈ $1.00', '↑ 50%'],
      ['No task', '1 h', '100', '≈ $0.10', '≈ $0.10', 'The same'],
      ['MAIN-3 Gamma', '0 min', '0', '≈ $0.00', '≈ $0.20', '↓ 100%'],
      ['MAIN-2 Beta', '1 h', '500', '500 tokens without a price', '≈ $0.00', 'No price now'],
      ['Unknown', '15 min', 'No tokens', 'No price', '≈ $0.00', 'No price now'],
    ])
  })

  it('says a cost that leaves tokens out, and its change, in the words the bars use', () => {
    // Delta: a dollar of priced work and 500 tokens with no price now, half a dollar before.
    const DELTA = task(4, 'Delta')
    const usage = usageAnswer({
      first: new Date(2026, 10, 9),
      days: 3,
      groupBy: ['work_item'],
      stretches: [
        { day: 0, group: { work_item: DELTA }, spend: { seconds: 3600, tokens: 1000, cost: 1 } },
        {
          day: 1,
          group: { work_item: DELTA },
          spend: { seconds: 600, tokens: 500, unpriced: 500 },
        },
      ],
      before: [
        { day: 0, group: { work_item: DELTA }, spend: { seconds: 1800, tokens: 500, cost: 0.5 } },
      ],
    }).usage
    const props = { by: 'work_item' as const, measure: 'cost' as const }
    const global = { plugins: [analyticsI18n()] }
    const shown = mount(SpendingTable, {
      props: { ...UNCROSSED, ...props, filters: {}, usage },
      global,
    })
    const bars = mount(SpendingBars, {
      props: { ...props, rows: usage.rows, narrow: false, slots: new Map() },
      global,
    })
    const bar = (bars.getComponent(RankedBars).props('rows') as RankedRow[])[0]

    // The bars' words, with any space in them read as one, as the table's cells are read.
    const barWords = words(bar?.valueText ?? '')
    expect(barWords).toBe('≈ $1.00, 500 tokens without a price')
    expect(rows(shown)).toEqual([
      [
        'MAIN-4 Delta',
        '1 h 10 min',
        '1.5K',
        '≈ $1.00, 500 tokens without a price',
        '≈ $0.50',
        '↑ 100%, 500 tokens without a price',
      ],
    ])
    expect(rows(shown)[0]?.[3]).toBe(barWords)
    expect(rows(shown)[0]?.[5]?.endsWith(barWords.slice(barWords.indexOf(', ')))).toBe(true)
  })

  it('says beside a change of cost the tokens both periods leave out', () => {
    const DELTA = task(4, 'Delta')
    const usage = usageAnswer({
      first: new Date(2026, 10, 9),
      days: 3,
      groupBy: ['work_item'],
      stretches: [
        { day: 0, group: { work_item: DELTA }, spend: { seconds: 3600, cost: 1, unpriced: 500 } },
      ],
      before: [
        { day: 0, group: { work_item: DELTA }, spend: { seconds: 1800, cost: 2, unpriced: 200 } },
      ],
    }).usage
    const shown = mount(SpendingTable, {
      props: { ...UNCROSSED, by: 'work_item', filters: {}, measure: 'cost', usage },
      global: { plugins: [analyticsI18n()] },
    })
    expect(rows(shown)[0]?.slice(3)).toEqual([
      '≈ $1.00, 500 tokens without a price',
      '≈ $2.00, 200 tokens without a price',
      '↓ 50%, 700 tokens without a price',
    ])
    // Time and tokens are whole whatever a price leaves out: their change says nothing of it.
    const byTime = mount(SpendingTable, {
      props: { ...UNCROSSED, by: 'work_item', filters: {}, measure: 'time', usage },
      global: { plugins: [analyticsI18n()] },
    })
    expect(rows(byTime)[0]?.slice(4)).toEqual(['30 min', '↑ 100%'])
  })

  it('says once that the period before was not read, and shows this period alone', () => {
    const wrapper = table('time', null)
    expect(words(wrapper.get('h2').text())).toBe('Spending by task')
    expect(wrapper.findAll('.spending-table-note')).toHaveLength(1)
    expect(wrapper.get('.spending-table-note').text()).toBe(
      'The period before was not read, so this table shows this period alone.',
    )
    expect(headings(wrapper)).toEqual(['Task', 'Agent time', 'Tokens', 'Est. cost, API prices'])
    // Gamma worked only before, which was not read: it is not here.
    expect(rows(wrapper)).toEqual([
      ['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50'],
      ['MAIN-2 Beta', '1 h', '500', '500 tokens without a price'],
      ['No task', '1 h', '100', '≈ $0.10'],
      ['Unknown', '15 min', 'No tokens', 'No price'],
    ])
  })

  it('says the same in Russian', () => {
    const wrapper = table('time', null, 'ru')
    expect(words(wrapper.get('h2').text())).toBe('Расход по задачам')
    expect(wrapper.get('.spending-table-note').text()).toBe(
      'Предыдущий период не прочитан, поэтому таблица показывает только этот период.',
    )
    expect(rows(table('cost', BEFORE, 'ru')).map((row) => row.at(-1))).toEqual([
      // A percentage as Russian writes it, a space before its sign.
      '↑ 50 %',
      'Столько же',
      '↓ 100 %',
      'Сейчас нет цены',
      'Сейчас нет цены',
    ])
  })

  it('stands empty in the bars’ words when neither period spent anything', () => {
    const wrapper = mount(SpendingTable, {
      props: {
        ...UNCROSSED,
        by: 'work_item',
        filters: {},
        measure: 'time',
        usage: usageAnswer({
          first: new Date(2026, 10, 9),
          days: 3,
          groupBy: ['work_item'],
          stretches: [],
          before: null,
        }).usage,
      },
      global: { plugins: [analyticsI18n()] },
    })
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('This period spent nothing to break down.')
  })
})

/** Alpha and Beta by model: two models and a third that folds into «other» beyond the fifth. */
const CROSSED: Stretch[] = [
  { day: 0, group: { work_item: ALPHA, model: value('model-a') }, spend: { seconds: 3600 } },
  { day: 0, group: { work_item: ALPHA, model: value('model-b') }, spend: { seconds: 1800 } },
  { day: 1, group: { work_item: BETA, model: value('model-b') }, spend: { seconds: 7200 } },
  { day: 1, group: { work_item: noTask, model: value('model-a') }, spend: { seconds: 900 } },
  ...['c', 'd', 'e', 'f', 'g'].map((name, index) => ({
    day: 2,
    group: { work_item: BETA, model: value(`model-${name}`) },
    spend: { seconds: 600 - index * 60 },
  })),
]

/** The table crossed with model, in the state of its crossed read. */
const crossedTable = (cross: CrossRead) =>
  mount(SpendingTable, {
    props: {
      across: 'model' as const,
      by: 'work_item' as const,
      cross,
      dimensions: ['work_item', 'model', 'role'] as const,
      filters: {},
      measure: 'time' as const,
      usage: answer(BEFORE),
    },
    global: { plugins: [analyticsI18n()] },
  })

describe('the breakdown crossed with a second dimension', () => {
  const read = usageAnswer({
    first: new Date(2026, 10, 9),
    days: 3,
    groupBy: ['work_item', 'model'],
    stretches: CROSSED,
  }).usage

  it('holds a column per leading value of the second, «other» and the total', () => {
    const wrapper = crossedTable({ status: 'ready', usage: read })
    expect(words(wrapper.get('h2').text())).toBe('Agent time by task and by model')
    expect(headings(wrapper)).toEqual([
      'Task',
      'model-b',
      'model-a',
      'model-c',
      'model-d',
      'model-e',
      'Other, 2 more',
      'Total',
    ])
    expect(rows(wrapper)).toEqual([
      // A pair that spent nothing is an empty cell, not a zero.
      ['MAIN-2 Beta', '2 h', '—', '10 min', '9 min', '8 min', '13 min', '2 h 40 min'],
      ['MAIN-1 Alpha', '30 min', '1 h', '—', '—', '—', '—', '1 h 30 min'],
      ['No task', '—', '15 min', '—', '—', '—', '—', '15 min'],
    ])
    expect(wrapper.findAll('tfoot th, tfoot td').map((cell) => words(cell.text()))).toEqual([
      'Total',
      '2 h 30 min',
      '1 h 15 min',
      '10 min',
      '9 min',
      '8 min',
      '13 min',
      '4 h 25 min',
    ])
    // The unread note is the table beside the period before: a crossed table has no period before.
    expect(wrapper.find('.spending-table-note').exists()).toBe(false)
  })

  it('says it is reading, or that the read failed with a way to ask again, in place of the table', async () => {
    const reading = crossedTable({ status: 'reading', usage: null })
    expect(reading.find('table').exists()).toBe(false)
    expect(reading.get('[role="status"]').text()).toBe('Reading the breakdown by model…')
    expect(reading.get('.spending-download').attributes('disabled')).toBeDefined()

    const failed = crossedTable({ status: 'failed' })
    expect(failed.get('[role="alert"]').text()).toBe('The breakdown by model could not be read.')
    await failed.get('.spending-table-waiting button').trigger('click')
    expect(failed.emitted('reread')).toHaveLength(1)
  })

  it('offers every dimension but its own as the second, and «none»', () => {
    const wrapper = crossedTable({ status: 'ready', usage: read })
    const choice = wrapper.getComponent({ name: 'ChoiceSelect' })
    expect((choice.props('options') as { label: string }[]).map((option) => option.label)).toEqual([
      'No second dimension',
      'Model',
      'Role',
    ])
    choice.vm.$emit('update:modelValue', 'role')
    choice.vm.$emit('update:modelValue', 'none')
    expect(wrapper.emitted('update:across')).toEqual([['role'], [null]])
  })
})
