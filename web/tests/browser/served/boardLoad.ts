/**
 * The records production-board-load.spec.ts serves.
 */
import { brief, identity, longRead, stateOf } from '../longSpace.ts'
import { SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

const POOL = ['agent-packets', 'coordinator', 'decision-review', 'ui', 'runtime-state', 'docs']

/** The fullest row of this space, drawn with nothing to spare. */
export const LIST_ROW_NODES = 43

/**
 * Sixty tiles, each with four labels, a glyph or two, a holder and steps, so
 * every run a tile draws is there; the control is the same space unlabelled.
 */
export function space(labelled: boolean) {
  return Array.from({ length: 60 }, (_, index) =>
    brief(100 + index, stateOf(index), {
      labels: labelled
        ? Array.from({ length: 4 }, (_, at) => POOL[(index + at) % POOL.length])
        : [],
      priority: index % 3 ? 'high' : 'urgent',
      kind: index % 2 ? 'bug' : 'improvement',
      claim_ref: 'codex',
      checklist: [
        {
          id: identity(3000 + index),
          text: 'Step',
          done: false,
          claimed_by: '',
          done_by: '',
          by_previous_holder: false,
        },
      ],
    }),
  )
}

/** Rows that make each column wider in the last of them, far below the fold. */
export function longRows(updated_at: string) {
  const rows = Array.from({ length: 299 }, (_, index) =>
    brief(1000 + index, stateOf(0), { updated_at }),
  )
  rows[280] = brief(9280, stateOf(2), {
    reference: 'MAIN-99280',
    claim_ref: 'a holder with a long name',
    priority: 'urgent',
    checklist: Array.from({ length: 12 }, (_, at) => ({
      id: identity(3000 + at),
      text: 'Step',
      done: false,
      claimed_by: '',
      done_by: '',
      by_previous_holder: false,
    })),
    updated_at: '2020-08-28T20:08:00Z',
  })
  return rows
}

export const served: Served[] = [
  {
    name: 'served/boardLoad.ts space(true)',
    url: SPACE_READ,
    body: spaceModelWith(longRead(space(true))),
  },
  {
    name: 'served/boardLoad.ts space(false)',
    url: SPACE_READ,
    body: spaceModelWith(longRead(space(false))),
  },
  {
    name: 'served/boardLoad.ts longRows()',
    url: SPACE_READ,
    body: spaceModelWith(longRead(longRows(new Date().toISOString()))),
  },
]
