/**
 * The tree model: rows by depth and place, path rows under a filter, a group
 * row the consumer adds, the fold rule, and what a tree's table and rows say to
 * a reader. The expected rows are written out by hand from each small set.
 */
import { describe, expect, it } from 'vitest'

import {
  FOLD_ABOVE,
  foldedByRule,
  treeGridAttrs,
  treeRowAttrs,
  treeRows,
} from '@/shared/lib/treeRows.ts'
import type { FoldFacts, TreeInput, TreeRow } from '@/shared/lib/treeRows.ts'

interface Thing {
  id: string
  parent: string | null
  /** Its place among the things beside it. */
  rank: number
  done?: boolean
  holds?: boolean
}

const source = {
  id: (thing: Thing) => thing.id,
  isContainer: (thing: Thing) => thing.holds === true,
  isOpen: (thing: Thing) => thing.done !== true,
  parentId: (thing: Thing) => thing.parent,
}

const thing = (id: string, parent: string | null, rank: number, extra: Partial<Thing> = {}) => ({
  id,
  parent,
  rank,
  ...extra,
})

/** Nothing folded and nothing filtered unless a test says so. */
function lay(items: Thing[], input: Partial<TreeInput<Thing>> = {}) {
  return treeRows(source, {
    folded: () => false,
    items,
    matches: null,
    order: (left, right) => left.rank - right.rank,
    ...input,
  })
}

/** A row as the tests read it: the id with the facts in question. */
const shape = (row: TreeRow<Thing>) => [row.id, row.depth, row.posInSet, row.setSize, row.expanded]

/**
 * A goal of two stages, one of two tasks and one of one, and a lone task at
 * the top; listed out of order, so only `order` puts them in place.
 */
const SPACE = [
  thing('t-lone', null, 2),
  thing('s-2', 'goal', 2, { holds: true }),
  thing('t-2a', 's-2', 1, { done: true }),
  thing('goal', null, 1, { holds: true }),
  thing('t-1b', 's-1', 2),
  thing('t-1a', 's-1', 1),
  thing('s-1', 'goal', 1, { holds: true }),
]

describe('treeRows', () => {
  it('lays rows out by depth, each in its place among the rows beside it', () => {
    const tree = lay(SPACE)
    expect(tree.rows.map((row) => shape(row))).toEqual([
      ['goal', 0, 1, 2, true],
      ['s-1', 1, 1, 2, true],
      ['t-1a', 2, 1, 2, null],
      ['t-1b', 2, 2, 2, null],
      ['s-2', 1, 2, 2, true],
      ['t-2a', 2, 1, 1, null],
      ['t-lone', 0, 2, 2, null],
    ])
    expect(tree.rows.map((row) => row.parentId)).toEqual([
      null,
      'goal',
      's-1',
      's-1',
      'goal',
      's-2',
      null,
    ])
    expect(tree.population).toBe(7)
    expect(tree.parentOf('t-1b')).toBe('s-1')
    expect(tree.parentOf('goal')).toBeNull()
    expect(tree.parentOf('nobody')).toBeNull()
    // Nothing filtered: no path rows, nothing counted as matching.
    expect(tree.rows.every((row) => !row.context && row.matchesInside === 0)).toBe(true)
  })

  it('leaves out what is under a folded row and keeps it in the population', () => {
    const tree = lay(SPACE, { folded: (id) => id === 's-1' })
    expect(tree.rows.map((row) => shape(row))).toEqual([
      ['goal', 0, 1, 2, true],
      ['s-1', 1, 1, 2, false],
      ['s-2', 1, 2, 2, true],
      ['t-2a', 2, 1, 1, null],
      ['t-lone', 0, 2, 2, null],
    ])
    expect(tree.population).toBe(7)
  })

  it('stands a thing whose parent is outside the set at the top, and walks a cycle once', () => {
    const outside = lay([thing('t-1', 'elsewhere', 1), thing('t-2', null, 2)])
    expect(outside.rows.map((row) => shape(row))).toEqual([
      ['t-1', 0, 1, 2, null],
      ['t-2', 0, 2, 2, null],
    ])
    const cycle = lay([
      thing('a', 'b', 1, { holds: true }),
      thing('b', 'a', 2, { holds: true }),
      thing('c', 'c', 3),
    ])
    expect(cycle.rows.map((row) => shape(row))).toEqual([
      ['a', 0, 1, 2, true],
      ['b', 1, 1, 1, null],
      ['c', 0, 2, 2, null],
    ])
    expect(cycle.parentOf('a')).toBeNull()
  })

  it('shows what matched and its path, and counts the matches under each row', () => {
    const tree = lay(
      [
        ...SPACE,
        thing('goal-2', null, 3, { holds: true }),
        thing('t-other', 'goal-2', 1),
        thing('goal-3', null, 4, { holds: true }),
        thing('t-3a', 'goal-3', 1),
      ],
      { matches: new Set(['t-1b', 't-2a', 'goal-3']) },
    )
    const read = tree.rows.map((row) => [row.id, row.depth, row.context, row.matchesInside])
    expect(read).toEqual([
      // Neither the goal nor its stages match: they stand as the path to what did.
      ['goal', 0, true, 2],
      ['s-1', 1, true, 1],
      ['t-1b', 2, false, 0],
      ['s-2', 1, true, 1],
      ['t-2a', 2, false, 0],
      // A container that matched, with nothing under it that did: no arrow, no children.
      ['goal-3', 0, false, 0],
    ])
    // t-1b is the only row left beside it, and goal-2, with no match, is not drawn.
    expect(tree.rows.find((row) => row.id === 't-1b')).toMatchObject({ posInSet: 1, setSize: 1 })
    expect(tree.rows.find((row) => row.id === 'goal')).toMatchObject({ posInSet: 1, setSize: 2 })
    expect(tree.rows.find((row) => row.id === 'goal-3')?.expanded).toBeNull()
    expect(tree.population).toBe(6)
  })

  it("draws a group row the consumer adds, with another space's cards under it", () => {
    const tree = lay([
      thing('goal', null, 1, { holds: true }),
      thing('t-1', 'goal', 1),
      thing('space:ROVER', null, 9, { holds: true }),
      thing('rover-1', 'space:ROVER', 1),
      thing('rover-2', 'space:ROVER', 2),
    ])
    expect(tree.rows.map((row) => shape(row))).toEqual([
      ['goal', 0, 1, 2, true],
      ['t-1', 1, 1, 1, null],
      ['space:ROVER', 0, 2, 2, true],
      ['rover-1', 1, 1, 2, null],
      ['rover-2', 1, 2, 2, null],
    ])
    expect(tree.parentOf('rover-2')).toBe('space:ROVER')
  })

  it('hands the fold rule the open work under a container at any depth and what it can draw', () => {
    const seen = new Map<string, FoldFacts>()
    lay(SPACE, {
      folded: (id, facts) => {
        seen.set(id, facts)
        return false
      },
    })
    // Under the goal: two stages and three tasks, one of them done.
    expect(seen.get('goal')).toEqual({ drawable: 5, filtered: false, open: 4 })
    expect(seen.get('s-2')).toEqual({ drawable: 1, filtered: false, open: 0 })
    // A row that cannot fold is never asked about.
    expect(seen.has('t-lone')).toBe(false)
  })

  it('folds by the rule a container with no open work or more than twenty, and none under a filter', () => {
    expect(FOLD_ABOVE).toBe(20)
    expect(foldedByRule(facts(0))).toBe(true)
    expect(foldedByRule(facts(1))).toBe(false)
    expect(foldedByRule(facts(20))).toBe(false)
    expect(foldedByRule(facts(21))).toBe(true)
    expect(foldedByRule(facts(0, true))).toBe(false)
    expect(foldedByRule(facts(21, true))).toBe(false)

    // Through the model: a stage of finished work starts folded, the goal over it open.
    const tree = lay(SPACE, { folded: (_, given) => foldedByRule(given) })
    expect(tree.rows.find((row) => row.id === 's-2')?.expanded).toBe(false)
    expect(tree.rows.find((row) => row.id === 'goal')?.expanded).toBe(true)
  })
})

/** Facts of a container that could draw thirty rows. */
const facts = (open: number, filtered = false) => ({ drawable: 30, filtered, open })

/** A row three levels down, the third of four. */
const row = (expanded: boolean | null): TreeRow<unknown> => ({
  context: false,
  depth: 2,
  expanded,
  id: 'x',
  item: null,
  matchesInside: 0,
  parentId: 'p',
  posInSet: 3,
  setSize: 4,
})

describe('the attributes of a tree', () => {
  it('says a row level, place and, where it has something to open, whether it is open', () => {
    expect(treeRowAttrs(row(true))).toEqual({
      'aria-expanded': true,
      'aria-level': 3,
      'aria-posinset': 3,
      'aria-setsize': 4,
    })
    expect(treeRowAttrs(row(false))).toMatchObject({ 'aria-expanded': false })
    expect(treeRowAttrs(row(null))).not.toHaveProperty('aria-expanded')
    expect(treeRowAttrs(row(null), 7)).toEqual({
      'aria-level': 3,
      'aria-posinset': 3,
      'aria-rowindex': 7,
      'aria-setsize': 4,
    })
  })

  it('names the table a tree grid, and counts its rows only where it draws a window', () => {
    expect(treeGridAttrs({ rowCount: 1666, windowed: true })).toEqual({
      'aria-rowcount': 1666,
      'role': 'treegrid',
    })
    expect(treeGridAttrs({ rowCount: 12, windowed: false })).toEqual({ role: 'treegrid' })
  })
})
