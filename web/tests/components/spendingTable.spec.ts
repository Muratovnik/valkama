/**
 * The breakdown beside the period before, as one table. The oracle is the requirement, written
 * out by hand row by row: every value either period holds, none folded; this period's time,
 * tokens and estimated cost; the chosen measure before; its change by the tiles' rule — a figure
 * the read does not hold is said absent and gives no change, a period before that spent nothing
 * gives no percentage; largest first in the chosen measure, a tie by name; and a period before
 * that was not read said once, with this period alone.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'

import type { Measure } from '@/shared/api/analyticsAddress.ts'

import { noTask, task, unknownTask, usageAnswer } from '../fixtures/analytics.ts'
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

function table(measure: Measure, before: Stretch[] | null = BEFORE, locale: 'en' | 'ru' = 'en') {
  return mount(SpendingTable, {
    props: { by: 'work_item', filters: {}, measure, usage: answer(before) },
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
    expect(words(wrapper.get('h2').text())).toBe('Spending by task, beside Nov 6 – 8')
    expect(words(wrapper.get('caption').text())).toBe('Spending by task, beside Nov 6 – 8')
    expect(headings(wrapper)).toEqual([
      'Task',
      'Agent time',
      'Tokens',
      'Estimated cost at API prices',
      'Agent time, Nov 6 – 8',
      'Change',
    ])
    expect(rows(wrapper)).toEqual([
      // In both periods: twice the time.
      ['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50', '1 h', '↑ 100%'],
      // Only now, tied with work on no task at an hour and named first.
      ['MAIN-2 Beta', '1 h', '500', 'No price', '0 min', 'Nothing before'],
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
    expect(rows(table('tokens'))).toEqual([
      ['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50', '1K', '↑ 100%'],
      ['MAIN-2 Beta', '1 h', '500', 'No price', '0', 'Nothing before'],
      ['No task', '1 h', '100', '≈ $0.10', '100', 'The same'],
      ['MAIN-3 Gamma', '0 min', '0', '≈ $0.00', '300', '↓ 100%'],
      ['Unknown', '15 min', 'No tokens', 'No price', '0', 'No tokens now'],
    ])
    expect(headings(table('tokens'))[4]).toBe('Tokens, Nov 6 – 8')
  })

  it('sorts by cost, with the values that have no price last and in the order of their names', () => {
    expect(rows(table('cost'))).toEqual([
      ['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50', '≈ $1.00', '↑ 50%'],
      ['No task', '1 h', '100', '≈ $0.10', '≈ $0.10', 'The same'],
      ['MAIN-3 Gamma', '0 min', '0', '≈ $0.00', '≈ $0.20', '↓ 100%'],
      ['MAIN-2 Beta', '1 h', '500', 'No price', '≈ $0.00', 'No price now'],
      ['Unknown', '15 min', 'No tokens', 'No price', '≈ $0.00', 'No price now'],
    ])
  })

  it('says once that the period before was not read, and shows this period alone', () => {
    const wrapper = table('time', null)
    expect(words(wrapper.get('h2').text())).toBe('Spending by task')
    expect(wrapper.findAll('.spending-table-note')).toHaveLength(1)
    expect(wrapper.get('.spending-table-note').text()).toBe(
      'The period before was not read, so this table shows this period alone.',
    )
    expect(headings(wrapper)).toEqual([
      'Task',
      'Agent time',
      'Tokens',
      'Estimated cost at API prices',
    ])
    // Gamma worked only before, which was not read: it is not here.
    expect(rows(wrapper)).toEqual([
      ['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50'],
      ['MAIN-2 Beta', '1 h', '500', 'No price'],
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
