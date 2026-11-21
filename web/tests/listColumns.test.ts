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
  fitOf,
  isFolded,
  levelFor,
  LEVELS,
  LIST_COLUMNS,
  sortedRows,
  sortsChosen,
} from '@/widgets/work-item-views/utils/listColumns.ts'
import type { Fit, Level } from '@/widgets/work-item-views/utils/listColumns.ts'

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
    expect(LEVELS.map((level) => sortsChosen(fitOf(level)))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ])
  })
})

describe('the level a list stands', () => {
  // What each level's table needed where it was drawn past the list.
  const needs = new Map<Level, number>([
    ['full', 1260],
    ['wide', 1076],
    ['medium', 650],
  ])

  it('is the widest whose table the list holds', () => {
    expect(levelFor(1260, needs)).toBe('full')
    expect(levelFor(1259, needs)).toBe('wide')
    expect(levelFor(1076, needs)).toBe('wide')
    expect(levelFor(1075, needs)).toBe('medium')
    expect(levelFor(649, needs)).toBe('narrow')
  })

  it('tries a level whose need is not known, the widest first', () => {
    expect(levelFor(300, new Map())).toBe('full')
    expect(levelFor(1100, new Map([['full', 1260]]))).toBe('wide')
  })

  it('bares the choice of order only where even the narrowest fit does not hold', () => {
    const phone = new Map([...needs, ['narrow', 314]] as const)
    expect(levelFor(314, phone)).toBe('narrow')
    expect(levelFor(292, phone)).toBe('bare')
  })

  it('is the last wherever no wider one holds, whatever it needs', () => {
    expect(levelFor(200, new Map([...needs, ['narrow', 274], ['bare', 240]]))).toBe('bare')
  })

  it('stands no level wider than the one it is told to start from', () => {
    // New rows only give way: the list stays medium though the wide fit is not known.
    expect(levelFor(1200, new Map(), 'medium')).toBe('medium')
    expect(levelFor(600, needs, 'medium')).toBe('narrow')
  })

  it('stands a bare level in the narrowest fit', () => {
    expect(LEVELS.map((level) => fitOf(level))).toEqual<Fit[]>([
      'full',
      'wide',
      'medium',
      'narrow',
      'narrow',
    ])
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
