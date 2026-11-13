/**
 * How a dimension's table counts its rows (`tableCounts`): the values of the dimension with a
 * figure in the measure in this period, as the rail's tile counts them; the values that spent in
 * it only in another measure; the rows that spent only in the period before; and, by name, the
 * rows of no value that spent in this period, in the measure or not. A row that spent in neither
 * period is none of them.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { tableCounts } from '@/pages/analytics/composables/useTableModel.ts'
import type { TableLine } from '@/pages/analytics/composables/useTableModel.ts'

const line = (name: string, when: TableLine['when'], rest = false): TableLine => ({
  cells: [],
  key: name,
  name,
  rest,
  value: { id: name, unknown: false },
  valueName: name,
  when,
})

describe('the count of a dimension’s table', () => {
  test('counts the values of the period apart from those only before and the rows of no value', () => {
    const lines = [
      line('MAIN-1', 'now'),
      line('MAIN-2', 'now'),
      line('MAIN-3', 'before'),
      line('MAIN-4', 'neither'),
      line('No task', 'now', true),
      line('Unknown', 'before', true),
    ]
    assert.deepEqual(tableCounts(lines), { now: 2, elsewhere: 0, before: 2, apart: ['No task'] })
  })

  test('counts nothing only before where every row spent in this period', () => {
    assert.deepEqual(tableCounts([line('MAIN-1', 'now'), line('Unknown', 'now', true)]), {
      now: 1,
      elsewhere: 0,
      before: 0,
      apart: ['Unknown'],
    })
  })

  test('counts a value that spent only in another measure apart from the values in this one', () => {
    // Under agent time: two roles worked, the adviser spent only tokens, and work with no value
    // there spent only tokens too, which still names it.
    const lines = [
      line('main', 'now'),
      line('worker', 'now'),
      line('adviser', 'elsewhere'),
      line('No value', 'elsewhere', true),
    ]
    assert.deepEqual(tableCounts(lines), {
      now: 2,
      elsewhere: 1,
      before: 0,
      apart: ['No value'],
    })
  })
})
