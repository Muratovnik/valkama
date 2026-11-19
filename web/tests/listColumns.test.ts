/**
 * Which list columns give way to the title, and in what order, as the list
 * narrows: the goal and stage first, then the state, the priority and the
 * holder, then the steps and the date; never the reference or the title. The tree by
 * goal draws no «Goal and stage», since it shows a row's goal by its place.
 */
import { describe, expect, it } from 'vitest'

import {
  drawnColumns,
  fitFor,
  isFolded,
  LIST_COLUMNS,
} from '@/widgets/work-item-views/utils/listColumns.ts'

const standing = (width: number, columns = LIST_COLUMNS) =>
  columns.filter((column) => !isFolded(fitFor(width), column.key)).map((column) => column.key)

describe('the list columns as the list narrows', () => {
  it('stand all eight in a list 1100px wide, and when the width is not yet known', () => {
    const all = ['reference', 'title', 'goal', 'state', 'priority', 'claim', 'checklist', 'updated']
    expect(standing(1280)).toEqual(all)
    expect(standing(1100)).toEqual(all)
    expect(standing(0)).toEqual(all)
  })

  it('fold the goal and stage first, keeping the rest down to 900px', () => {
    const rest = ['reference', 'title', 'state', 'priority', 'claim', 'checklist', 'updated']
    expect(standing(1099)).toEqual(rest)
    expect(standing(900)).toEqual(rest)
  })

  it('then fold the state, the priority and the holder, keeping the steps and the date', () => {
    expect(standing(899)).toEqual(['reference', 'title', 'checklist', 'updated'])
    expect(standing(703)).toEqual(['reference', 'title', 'checklist', 'updated'])
    expect(standing(560)).toEqual(['reference', 'title', 'checklist', 'updated'])
  })

  it('leave the reference and the title on a phone', () => {
    expect(standing(559)).toEqual(['reference', 'title'])
    expect(standing(292)).toEqual(['reference', 'title'])
  })
})

describe('the columns a list draws', () => {
  it('draws the goal and stage after the title in a flat list', () => {
    expect(drawnColumns(false).map((column) => column.key)).toEqual([
      'reference',
      'title',
      'goal',
      'state',
      'priority',
      'claim',
      'checklist',
      'updated',
    ])
  })

  it('leaves it out of the tree by goal, at every width', () => {
    const tree = drawnColumns(true)
    expect(tree.map((column) => column.key)).not.toContain('goal')
    expect(standing(1280, tree)).toEqual([
      'reference',
      'title',
      'state',
      'priority',
      'claim',
      'checklist',
      'updated',
    ])
  })
})
