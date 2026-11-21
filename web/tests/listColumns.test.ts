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
  FITS,
  isFolded,
  LIST_COLUMNS,
  sortedRows,
  sortsChosen,
} from '@/widgets/work-item-views/utils/listColumns.ts'
import type { Fit } from '@/widgets/work-item-views/utils/listColumns.ts'

import { boardItem } from './fixtures/board.ts'

const standing = (fit: Fit, columns = LIST_COLUMNS) =>
  columns.filter((column) => !isFolded(fit, column.key)).map((column) => column.key)

describe('the list columns as the list narrows', () => {
  it('stand all nine in the full fit', () => {
    expect(standing('full')).toEqual([
      'reference',
      'title',
      'goal',
      'project',
      'state',
      'priority',
      'claim',
      'checklist',
      'updated',
    ])
  })

  it('fold the goal and stage and the project first, together', () => {
    expect(standing('wide')).toEqual([
      'reference',
      'title',
      'state',
      'priority',
      'claim',
      'checklist',
      'updated',
    ])
  })

  it('then fold the state, the priority and the holder, keeping the conditions and the date', () => {
    expect(standing('medium')).toEqual(['reference', 'title', 'checklist', 'updated'])
  })

  it('leave the reference and the title on a phone', () => {
    expect(standing('narrow')).toEqual(['reference', 'title'])
  })

  it('offer the folded sorts as one choice wherever the state, the priority and the holder fold', () => {
    // A run of five sorts after the title's took a second line of the head; of two it holds one.
    expect(FITS.map((fit) => sortsChosen(fit))).toEqual([false, false, true, true])
  })
})

describe('the fit a list stands', () => {
  // What each fit's table needed where it was drawn past the list.
  const needs = new Map<Fit, number>([
    ['full', 1260],
    ['wide', 1076],
    ['medium', 650],
  ])

  it('is the widest whose table the list holds', () => {
    expect(fitFor(1260, needs)).toBe('full')
    expect(fitFor(1259, needs)).toBe('wide')
    expect(fitFor(1076, needs)).toBe('wide')
    expect(fitFor(1075, needs)).toBe('medium')
    expect(fitFor(649, needs)).toBe('narrow')
  })

  it('tries a fit whose need is not known, the widest first', () => {
    expect(fitFor(300, new Map())).toBe('full')
    expect(fitFor(1100, new Map([['full', 1260]]))).toBe('wide')
  })

  it('is the narrowest wherever no wider one holds, whatever it needs', () => {
    expect(fitFor(200, new Map([...needs, ['narrow', 274]]))).toBe('narrow')
  })

  it('stands no fit wider than the one it is told to start from', () => {
    // New rows only give way: the list stays medium though the wide fit is not known.
    expect(fitFor(1200, new Map(), 'medium')).toBe('medium')
    expect(fitFor(600, needs, 'medium')).toBe('narrow')
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
    expect(standing('full', tree)).toEqual([
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
