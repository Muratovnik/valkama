/**
 * The board's columns: finished states stand last whatever the workflow lists,
 * and the columns that fit share the visible width so none is cut at its edge.
 */
import { describe, expect, it } from 'vitest'

import {
  COLUMN_FLOOR,
  columnWidth,
  terminalLast,
} from '@/widgets/work-item-views/utils/boardColumns.ts'

const column = (key: string, is_terminal = false) => ({ key, state: { is_terminal } })

describe('the order of the columns', () => {
  it('moves the terminal states last and keeps the workflow order on both sides', () => {
    const order = terminalLast([
      column('backlog'),
      column('todo'),
      column('dev'),
      column('review'),
      column('done', true),
      column('blocked'),
      column('cancelled', true),
    ]).map((entry) => entry.key)
    expect(order).toEqual(['backlog', 'todo', 'dev', 'review', 'blocked', 'done', 'cancelled'])
  })

  it('leaves a workflow that already ends in its terminal states as it is', () => {
    const keys = ['a', 'b', 'c']
    const columns = [column('a'), column('b'), column('c', true)]
    expect(terminalLast(columns).map((entry) => entry.key)).toEqual(keys)
  })
})

describe('the width of a column', () => {
  it('fits as many whole columns as the floor allows and shares the width between them', () => {
    // A 1440px window leaves the board 1116px: five columns, the sixth starts at the edge.
    const width = columnWidth(1116, 7, 8)
    expect(width).toBeCloseTo((1116 - 4 * 8) / 5)
    expect(5 * (width ?? 0) + 4 * 8).toBeCloseTo(1116)
  })

  it('shares all of the width when every column fits', () => {
    expect(columnWidth(1600, 4, 8)).toBeCloseTo((1600 - 3 * 8) / 4)
  })

  it('never draws a column narrower than the floor, and says nothing when nothing was measured', () => {
    expect(columnWidth(390 - 76, 7, 8)).toBe(314)
    expect(columnWidth(120, 7, 8)).toBe(COLUMN_FLOOR)
    expect(columnWidth(0, 7, 8)).toBeNull()
    expect(columnWidth(1116, 0, 8)).toBeNull()
  })
})
