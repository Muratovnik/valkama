/**
 * The totals of a dimension's table while words are looked for in it, as the side panel's «All N»
 * finds a value by its name. The oracle is the requirement, written out by hand from the fixture:
 * the total under the rows a search keeps is theirs, «Total of those found», and the period's own
 * total of every row stands as a row of its own under it, «Total for the period»; with no words
 * looked for the period's total stands alone and is named as it always was, «Total».
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'

import { noTask, task, usageAnswer } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

const ALPHA = task(1, 'Alpha')
const BETA = task(2, 'Beta')
const GAMMA = task(3, 'Gamma')

/**
 * This period: Alpha two hours, Beta an hour whose tokens have no price, work on no task an hour.
 * The period before: Alpha an hour, Gamma half an hour (it worked only then), no task an hour.
 */
const NOW: Stretch[] = [
  { day: 0, group: { work_item: ALPHA }, spend: { seconds: 7200, tokens: 2000, cost: 1.5 } },
  {
    day: 1,
    group: { work_item: BETA },
    spend: { seconds: 3600, tokens: 500, cost: null, unpriced: 500 },
  },
  { day: 1, group: { work_item: noTask }, spend: { seconds: 3600, tokens: 100, cost: 0.1 } },
]
const BEFORE: Stretch[] = [
  { day: 0, group: { work_item: ALPHA }, spend: { seconds: 3600, tokens: 1000, cost: 1 } },
  { day: 0, group: { work_item: GAMMA }, spend: { seconds: 1800, tokens: 300, cost: 0.2 } },
  { day: 1, group: { work_item: noTask }, spend: { seconds: 3600, tokens: 100, cost: 0.1 } },
]

const usage = usageAnswer({
  first: new Date(2026, 10, 9),
  days: 3,
  groupBy: ['work_item'],
  stretches: NOW,
  before: BEFORE,
}).usage

function found(find: string, locale: 'en' | 'ru' = 'en') {
  return mount(SpendingTable, {
    props: {
      across: null,
      cross: { status: 'off' } as const,
      by: 'work_item',
      filters: {},
      measure: 'time',
      usage,
      find,
    },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

const cells = (row: ReturnType<ReturnType<typeof found>['findAll']>[number]) =>
  row.findAll('th, td').map((cell) => words(cell.text()))

const rows = (wrapper: ReturnType<typeof found>) =>
  wrapper.findAll('tbody tr').map((row) => cells(row))

/** Each total row by its `data-total`, then its name and every cell. */
const totals = (wrapper: ReturnType<typeof found>) =>
  wrapper.findAll('tfoot tr').map((row) => [row.attributes('data-total'), ...cells(row)])

/** Every row of the period: 2 h + 1 h + 1 h now, 1 h + 30 min + 1 h before. */
const PERIOD = ['4 h', '2.6K', '≈ $1.60, 500 tokens without a price', '2 h 30 min', '↑ 60%']

describe('the totals of a table searched by name', () => {
  it('totals the one row a search keeps as that row, with the period’s total under it', () => {
    const alpha = found('alpha')
    expect(rows(alpha)).toEqual([['MAIN-1 Alpha', '2 h', '2K', '≈ $1.50', '1 h', '↑ 100%']])
    expect(totals(alpha)).toEqual([
      ['found', 'Total of those found', '2 h', '2K', '≈ $1.50', '1 h', '↑ 100%'],
      ['period', 'Total for the period', ...PERIOD],
    ])
    expect(alpha.get('section').attributes('data-found')).toBe('')
  })

  it('adds the rows a search keeps, a row of the period before alone among them', () => {
    // The three tasks: Alpha 2 h and Beta 1 h now; Alpha 1 h and Gamma 30 min before. Beta's
    // tokens with no price stay said under the cost.
    const tasks = found('main')
    expect(rows(tasks).map((row) => row[0])).toEqual([
      'MAIN-1 Alpha',
      'MAIN-2 Beta',
      'MAIN-3 Gamma',
    ])
    expect(totals(tasks)).toEqual([
      [
        'found',
        'Total of those found',
        '3 h',
        '2.5K',
        '≈ $1.50, 500 tokens without a price',
        '1 h 30 min',
        '↑ 100%',
      ],
      ['period', 'Total for the period', ...PERIOD],
    ])
  })

  it('names the two totals in Russian', () => {
    expect(totals(found('alpha', 'ru')).map((row) => row.slice(0, 2))).toEqual([
      ['found', 'Итого найденного'],
      ['period', 'Итого за период'],
    ])
  })

  it('keeps the period’s total alone, named «Total», with no words looked for', () => {
    for (const none of ['', '   ']) {
      const all = found(none)
      expect(rows(all)).toHaveLength(4)
      expect(totals(all)).toEqual([['period', 'Total', ...PERIOD]])
      expect(all.get('section').attributes('data-found')).toBeUndefined()
    }
  })
})
