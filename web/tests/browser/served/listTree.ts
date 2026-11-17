/**
 * The records listTreePage.ts serves.
 */
import { brief, identity, longRead, stateOf } from '../longSpace.ts'
import { SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

/** The workflow's terminal state, which `stateOf` never names. */
const DONE = {
  key: 'done',
  name: 'Done',
  category: 'completed',
  is_terminal: true,
  state_id: identity(905),
} as const

const OLD = '2026-01-01T00:00:00Z'

interface Card {
  closed: boolean
  container?: boolean
  parent?: number
  updated?: string
}

/** A container is a goal, or a stage where it stands under another. */
function kindOf(container: boolean, parent: number | undefined) {
  if (!container) return 'task'
  return parent === undefined ? 'goal' : 'stage'
}

function card(number: number, { closed, container = false, parent, updated = OLD }: Card) {
  return brief(number, closed ? DONE : stateOf(number), {
    kind: kindOf(container, parent),
    parent_id: parent === undefined ? null : identity(parent),
    updated_at: updated,
  })
}

/** The four stages, one under another, between the crowded goal and the widest row. */
export const CHAIN = ['MAIN-250', 'MAIN-251', 'MAIN-252', 'MAIN-253'] as const
/** The row widest in every column, at the deepest indent, under the crowded goal. */
export const WIDEST = 'MAIN-254'

/**
 * The goal with more than twenty open. Its last five, all done, stand one under
 * another: four stages, which the rule folds as it folds the goal, and under them
 * the row widest in every column — the longest reference at the deepest indent, a
 * holder with a long name, twelve steps and a date of another year.
 */
function crowdedGoal() {
  const [head, ...kids] = goal(200, 54, 30)
  const chained = kids.map((kid) => {
    if (kid.number < 250) return kid
    const parent = kid.number === 250 ? 200 : kid.number - 1
    if (kid.number < 254) return card(kid.number, { closed: true, container: true, parent })
    return {
      ...card(kid.number, { closed: true, parent }),
      checklist: Array.from({ length: 12 }, (_, at) => ({
        id: identity(4000 + at),
        text: 'Step',
        done: false,
        claimed_by: '',
        done_by: '',
        by_previous_holder: false,
      })),
      claim_ref: 'a holder with a long name',
      priority: 'urgent',
      updated_at: '2020-08-28T20:08:00Z',
    }
  })
  return [head, ...chained]
}

/** A container and its children, `open` of them still open. */
export function goal(number: number, children: number, open: number, updated = OLD) {
  const kids = Array.from({ length: children }, (_, at) =>
    card(number + 1 + at, { closed: at >= open, parent: number, updated }),
  )
  return [card(number, { closed: open === 0, container: true, updated }), ...kids]
}

/** The goal five levels deep: each level's first row holds the next three. */
export const DEEP = ['MAIN-1', 'MAIN-2', 'MAIN-5', 'MAIN-8', 'MAIN-11'] as const
export const LARGEST = 'MAIN-100'
/** The goal with more than twenty open, which the rule folds. */
export const CROWDED = 'MAIN-200'

export function treeSpace() {
  const now = new Date().toISOString()
  const deep = [card(1, { closed: false, container: true, updated: now })]
  for (const [level, first] of [2, 5, 8, 11].entries())
    for (let at = 0; at < 3; at += 1)
      deep.push(
        card(first + at, {
          closed: false,
          // Every level's first row but the last level's holds the next level.
          container: at === 0 && level < 3,
          parent: level === 0 ? 1 : first - 3,
          updated: now,
        }),
      )
  const earlier = new Date(Date.now() - 60_000).toISOString()
  const goals = [...goal(100, 69, 15, earlier), ...crowdedGoal(), ...goal(300, 36, 10)]
  // 193 goals of five: 135 with nothing open, the rest with two open.
  for (let at = 0; at < 193; at += 1) goals.push(...goal(1000 + at * 6, 5, at < 135 ? 0 : 2))
  // The rest of the 1665 cards stand alone, seven in ten done.
  const alone = Array.from({ length: 1665 - deep.length - goals.length }, (_, at) =>
    card(3000 + at, { closed: at % 10 < 7 }),
  )
  return [...deep, ...goals, ...alone]
}

export const served: Served[] = [
  {
    name: 'served/listTree.ts treeSpace()',
    url: SPACE_READ,
    body: spaceModelWith(longRead(treeSpace())),
  },
]
