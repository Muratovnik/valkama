/**
 * Which list columns give way to the title, and in what order, as the list
 * narrows: the goal and stage and the project first, then the state, the priority and
 * the holder, then the steps and the date; never the reference or the title. The tree by
 * goal draws no «Goal and stage», since it shows a row's goal by its place, and a list
 * draws «Project» only where its host says the rows name their projects.
 */
import { describe, expect, it } from 'vitest'

import {
  drawnColumns,
  fitFor,
  isFolded,
  LIST_COLUMNS,
  sortedRows,
} from '@/widgets/work-item-views/utils/listColumns.ts'

import { boardItem } from './fixtures/board.ts'

const standing = (width: number, columns = LIST_COLUMNS) =>
  columns.filter((column) => !isFolded(fitFor(width), column.key)).map((column) => column.key)

describe('the list columns as the list narrows', () => {
  it('stand all nine in a list 1100px wide, and when the width is not yet known', () => {
    const all = [
      'reference',
      'title',
      'goal',
      'project',
      'state',
      'priority',
      'claim',
      'checklist',
      'updated',
    ]
    expect(standing(1280)).toEqual(all)
    expect(standing(1100)).toEqual(all)
    expect(standing(0)).toEqual(all)
  })

  it('fold the goal and stage and the project first, keeping the rest down to 900px', () => {
    const rest = ['reference', 'title', 'state', 'priority', 'claim', 'checklist', 'updated']
    expect(standing(1099)).toEqual(rest)
    expect(standing(900)).toEqual(rest)
  })

  it('then fold the state, the priority and the holder, keeping the steps and the date', () => {
    expect(standing(899)).toEqual(['reference', 'title', 'checklist', 'updated'])
    expect(standing(703)).toEqual(['reference', 'title', 'checklist', 'updated'])
    expect(standing(560)).toEqual(['reference', 'title', 'checklist', 'updated'])
  })

  it('stand «Goal and stage» and «Project» together from 1240px, and fold them together', () => {
    const both = (width: number) =>
      LIST_COLUMNS.filter((column) => !isFolded(fitFor(width, true), column.key)).map(
        (column) => column.key,
      )
    expect(both(1240).slice(2, 4)).toEqual(['goal', 'project'])
    expect(both(1239)).toEqual([
      'reference',
      'title',
      'state',
      'priority',
      'claim',
      'checklist',
      'updated',
    ])
    expect(fitFor(1239, true)).toBe('wide')
    expect(fitFor(899, true)).toBe('medium')
    expect(fitFor(0, true)).toBe('full')
  })

  it('leave the reference and the title on a phone', () => {
    expect(standing(559)).toEqual(['reference', 'title'])
    expect(standing(292)).toEqual(['reference', 'title'])
  })
})

describe('the columns a list draws', () => {
  it('draws the goal and stage after the title in a flat list, and no project', () => {
    expect(drawnColumns({ goal: true, project: false }).map((column) => column.key)).toEqual([
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

  it('draws the project after the goal and stage where the rows name it', () => {
    const named = drawnColumns({ goal: true, project: true }).map((column) => column.key)
    expect(named.slice(0, 5)).toEqual(['reference', 'title', 'goal', 'project', 'state'])
    expect(drawnColumns({ goal: false, project: true }).map((column) => column.key)).toEqual([
      'reference',
      'title',
      'project',
      'state',
      'priority',
      'claim',
      'checklist',
      'updated',
    ])
  })

  it('leaves the goal and stage out of the tree by goal, at every width', () => {
    const tree = drawnColumns({ goal: false, project: false })
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

const at = (number: number, ...names: string[]) =>
  boardItem(number, 'backlog', {
    projects: names.map((name) => ({ project_id: name, display_name: name, source: 'named' })),
  })

const order = (descending: boolean) =>
  sortedRows(
    [at(1, 'Beta'), at(2), at(3, 'Alpha', 'Beta'), at(4, 'alpha'), at(5, 'Alpha')],
    { descending, key: 'project' },
    () => '',
  ).map((item) => item.number)

describe('the order by project', () => {
  it('puts work naming none first, each project by name, then work naming several', () => {
    // «alpha» and «Alpha» are one name to the order, and the smaller number goes first.
    expect(order(false)).toEqual([2, 4, 5, 1, 3])
    expect(order(true)).toEqual([3, 1, 4, 5, 2])
  })
})
